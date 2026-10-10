'use strict';
// Actual PostgreSQL + backend restarts, fake Google only. Never use Render credentials.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {Client,Pool}=require('../backend/node_modules/pg');
const createStore=require('../backend/auth-store');
const {provision}=require('../backend/staging-db-admin');
const input=process.env.PG_TEST_DATABASE_URL;
if(!input)throw Error('PG_TEST_DATABASE_URL required; no production fallback');
const base=new URL(input);
if(!['127.0.0.1','localhost'].includes(base.hostname)||base.pathname!=='/meetab_ci')
  throw Error('Refusing OAuth writes outside the disposable localhost CI cluster');
const database='meetab_auth_ci',ownerUrl=new URL(base);ownerUrl.pathname='/'+database;
const runtimeUrl=new URL(ownerUrl);runtimeUrl.username='meetab_staging';runtimeUrl.password=crypto.randomBytes(24).toString('hex');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'meetab-auth-pg-')),filename=path.join(folder,'existing.enc');
const existingFile='Do not import or overwrite the previous encrypted file';fs.writeFileSync(filename,existingFile);
const key=crypto.randomBytes(32),origin='https://meetab-staging-20261010.onrender.com';
const env={DATABASE_URL:runtimeUrl.href,STAGING_PREVIEW_MODE:'1',API_ORIGIN:origin};
const account={provider:'google',name:'Local User',email:'local@example.test',emailVerified:true,
  access:'private-access-fixture',refresh:'private-refresh-fixture',expires:Date.now()+3600000};
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const id='google:local-sub',session=digest('private-bearer-fixture'),otherSession=digest('other-bearer-fixture');
const admin=new Client({connectionString:base.href});let owner,pool,child,created=false,logs='';
const makePool=()=>new Pool({connectionString:runtimeUrl.href,max:3,connectionTimeoutMillis:3000});
const makeStore=(options={})=>createStore({mode:'postgres',pool,env,filename,key,...options});
const host='http://127.0.0.1:8949';
const request=(route,options={})=>fetch(host+route,{redirect:'manual',...options});
async function stop(){
  if(child&&child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGTERM');await closed;}
  child=null;
}
async function start(extra={}){
  child=spawn(process.execPath,['-r',path.join(__dirname,'mock-provider-real-pg.cjs'),'server.js'],{
    cwd:path.join(__dirname,'../backend'),stdio:['ignore','pipe','pipe'],env:{...process.env,...env,
      PORT:'8949',FRONTEND_URL:origin+'/preview/',AUTH_STORAGE:'postgres',DATA_ENCRYPTION_KEY:key.toString('hex'),
      DATA_FILE:filename,GOOGLE_CLIENT_ID:'mock-id',GOOGLE_CLIENT_SECRET:'mock-secret',
      ROOM_ACCESS_JSON:JSON.stringify({'google:test@example.test':{calendars:['test-room'],itRooms:['gulisqari']}}),
      IT_ROOM_LABELS_JSON:JSON.stringify({gulisqari:'Local Room'}),...extra}});
  child.stdout.on('data',bytes=>{logs+=String(bytes);});child.stderr.on('data',bytes=>{logs+=String(bytes);});
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw Error('Local PostgreSQL backend terminated');
    try{if((await request('/health')).status===200)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw Error('Local PostgreSQL backend did not start');
}
async function login(code='local-test'){
  const verifier=crypto.randomBytes(32).toString('base64url'),challenge=digest(verifier);
  const start=await request('/auth/google/start?'+new URLSearchParams({client_challenge:Buffer.from(challenge,'hex').toString('base64url')}));
  assert.equal(start.status,302);
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const callback=await request('/auth/google/callback?'+new URLSearchParams({state,code}));
  assert.equal(callback.status,302);
  const ticket=new URL(callback.headers.get('location')).searchParams.get('ticket');
  const exchange=proof=>request('/auth/exchange',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({ticket,verifier:proof})});
  assert.equal((await exchange('x'.repeat(43))).status,401,'Copied ticket lacks initiating-client proof');
  const result=await exchange(verifier);assert.equal(result.status,200);
  const token=(await result.json()).session;
  assert.equal((await exchange(verifier)).status,401);
  return {Origin:origin,Authorization:'Bearer '+token};
}
(async()=>{
  await admin.connect();await admin.query('CREATE DATABASE '+database);created=true;
  owner=new Client({connectionString:ownerUrl.href});await owner.connect();
  await owner.query('CREATE TABLE public.production_sentinel(value TEXT NOT NULL)');
  await owner.query("INSERT INTO public.production_sentinel VALUES ('unchanged')");
  await provision(owner,decodeURIComponent(runtimeUrl.password),database);
  pool=makePool();let store=await makeStore();
  const expires=Date.now()+100000;
  await store.login(id,account,session,expires);
  await store.login('google:second-sub',{...account,email:'second@example.test'},otherSession,expires);
  assert.equal((await store.authenticate(session,Date.now())).account.email,account.email);
  assert.equal(await store.authenticate(digest("' OR '1'='1"),Date.now()),null);
  assert.equal(await store.authenticate(session,expires),null,'Expiry is not extended by restart');
  await assert.rejects(store.login(id,{...account,name:'Should roll back'},session,expires),{code:'AUTH_STORE_UNAVAILABLE'});
  assert.equal((await store.getAccount(id)).name,account.name,'Failed session insert must roll back account changes');
  const updated=await store.getAccount(id);updated.refresh='rotated-private-fixture';
  await store.updateAccount(id,updated);
  const stale=await store.getAccount(id),newer=await store.getAccount(id);
  newer.access='newer-access-fixture';await store.updateAccount(id,newer);
  stale.access='stale-access-fixture';
  assert.equal((await store.updateAccount(id,stale)).access,'newer-access-fixture','Stale refresh cannot overwrite newer credentials');
  await pool.end();pool=makePool();store=await makeStore();
  assert.equal((await store.authenticate(session,Date.now())).account.refresh,'rotated-private-fixture');
  const rows=(await owner.query('SELECT * FROM meetab_staging.meetab_oauth_accounts')).rows;
  const stored=JSON.stringify(rows)+JSON.stringify((await owner.query('SELECT * FROM meetab_staging.meetab_oauth_sessions')).rows);
  for(const value of [account.name,account.email,account.access,account.refresh,'local-sub','private-bearer-fixture','rotated-private-fixture'])
    assert(!stored.includes(value),'Private values must not be stored in plaintext');
  await owner.query('UPDATE meetab_staging.meetab_oauth_accounts SET ciphertext=$2 WHERE account_key=$1',[digest(id),rows.find(row=>row.account_key!==digest(id)).ciphertext]);
  await assert.rejects(store.authenticate(session,Date.now()),{code:'AUTH_STORE_UNAVAILABLE'},'Ciphertext is bound to its own account row');
  await owner.query('UPDATE meetab_staging.meetab_oauth_accounts SET ciphertext=$2 WHERE account_key=$1',[digest(id),rows.find(row=>row.account_key===digest(id)).ciphertext]);
  await owner.query('UPDATE meetab_staging.meetab_oauth_sessions SET expires_at=expires_at+1000 WHERE session_hash=$1',[session]);
  await assert.rejects(store.authenticate(session,Date.now()),{code:'AUTH_STORE_UNAVAILABLE'},'Expiry tampering must be detected');
  await owner.query('UPDATE meetab_staging.meetab_oauth_sessions SET expires_at=$2 WHERE session_hash=$1',[session,expires]);
  await assert.rejects(makeStore({key:crypto.randomBytes(32)}),{code:'AUTH_STORE_KEY_MISMATCH'});
  const ownerPool=new Pool({connectionString:ownerUrl.href,max:1});
  try{await assert.rejects(makeStore({pool:ownerPool}),{code:'AUTH_STORE_CONFIG'},'Owner-role connections must be refused');}
  finally{await ownerPool.end();}
  assert.equal((await store.getAccount(id)).refresh,'rotated-private-fixture','Wrong key must not erase stored accounts');
  await store.login('google:expired-sub',account,digest('expired-fixture'),Date.now()-1);
  await store.prune(Date.now());
  assert.equal((await owner.query('SELECT count(*)::int AS n FROM meetab_staging.meetab_oauth_sessions')).rows[0].n,2);
  await store.logout(session);assert.equal(await store.authenticate(session,Date.now()),null);
  await pool.end();pool=null;
  await start();
  assert.equal((await request('/api/me')).status,401);
  const headers=await login('expired-login');
  assert.equal((await request('/api/me',{headers})).status,200);
  assert.equal((await request('/api/me',{headers:{...headers,Origin:'https://forbidden.example.test'}})).status,403);
  const denied='/api/events?'+new URLSearchParams({calendarId:'other-room',from:new Date().toISOString(),to:new Date(Date.now()+3600000).toISOString()});
  assert.equal((await request(denied,{headers})).status,403);
  const concurrent=await Promise.all([request('/api/calendars',{headers}),request('/api/calendars',{headers})]);
  assert(concurrent.every(result=>result.status===200),'Concurrent refresh must not reuse a rotated refresh token');
  assert((await owner.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename='meetab_staging'")).rows[0].n<=3,'Auth and IT must share the role connection limit');
  await stop();await start();
  assert.equal((await request('/api/me',{headers})).status,200,'Original session must survive actual backend restart');
  assert.equal((await request('/api/calendars',{headers})).status,200,'Refreshed provider credentials must survive restart');
  await owner.query('ALTER TABLE meetab_staging.meetab_oauth_sessions RENAME TO unavailable_sessions');
  const unavailable=await request('/api/me',{headers});assert.equal(unavailable.status,503);
  assert.deepEqual(await unavailable.json(),{error:'Authentication storage unavailable'});
  assert.equal(fs.readFileSync(filename,'utf8'),existingFile,'Unavailable PG must never fall back to or overwrite the file');
  await owner.query('ALTER TABLE meetab_staging.unavailable_sessions RENAME TO meetab_oauth_sessions');
  assert.equal((await request('/api/me',{headers})).status,200);
  assert.equal((await request('/api/logout',{method:'POST',headers})).status,200);
  await stop();await start();
  assert.equal((await request('/api/me',{headers})).status,401,'Logout must survive actual restart');
  await stop();pool=makePool();store=await makeStore();
  assert.equal((await store.getAccount('google:test-user')).refresh,'test-rotated-refresh');
  assert.equal(fs.readFileSync(filename,'utf8'),existingFile);
  assert.deepEqual((await owner.query('SELECT * FROM public.production_sentinel')).rows,[{value:'unchanged'}]);
  for(const value of [runtimeUrl.href,key.toString('hex'),account.access,account.refresh,'test-local-refresh','test-rotated-refresh','test@example.test'])
    assert(!logs.includes(value),'Backend logs must not disclose private values');
  console.log('AUTH_POSTGRES=PASS (real PG, encrypted rows, atomic login, actual restart, refresh, logout, expiry, ACL, proof, outage, key mismatch, connection limit, preserved file and sentinel)');
})().catch(error=>{console.error('AUTH_POSTGRES=FAIL',error.message);process.exitCode=1;})
  .finally(async()=>{
    await stop();await pool?.end();await owner?.end();
    if(created){await admin.query('DROP DATABASE '+database);await admin.query('DROP ROLE IF EXISTS meetab_staging');}
    await admin.end();fs.rmSync(folder,{recursive:true,force:true});
  });
