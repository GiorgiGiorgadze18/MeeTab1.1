'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const createStore=require('../backend/auth-store');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'meetab-auth-file-'));
const filename=path.join(folder,'legacy.enc'),key=crypto.randomBytes(32);
const id='google:local-sub',hash=crypto.createHash('sha256').update('local-bearer').digest('hex');
const account={provider:'google',name:'Local User',email:'local@example.test',emailVerified:true,
  access:'local-private-access',refresh:'local-private-refresh',expires:Date.now()+3600000};
(async()=>{
  // The deployed file format must remain readable, including records without id.
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const bytes=Buffer.concat([cipher.update(JSON.stringify({accounts:{[id]:account},
    sessions:{[hash]:{accountId:id,expires:Date.now()+100000}}}),'utf8'),cipher.final()]);
  fs.writeFileSync(filename,Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64'));
  let store=await createStore({filename,key});
  assert.equal((await store.authenticate(hash,Date.now())).account.id,id);
  assert.equal(await store.authenticate('unknown',Date.now()),null);
  const updated=await store.getAccount(id);updated.refresh='rotated-private-refresh';
  await store.updateAccount(id,updated);
  store=await createStore({filename,key});
  assert.equal((await store.getAccount(id)).refresh,'rotated-private-refresh');
  const stale=await store.getAccount(id);
  await store.login(id,{...account,access:'newer-login-access'},hash,Date.now()+100000);
  stale.access='stale-refresh';
  assert.equal((await store.updateAccount(id,stale)).access,'newer-login-access','Stale refresh cannot overwrite a newer login');
  await store.login(id,account,hash,Date.now()-1);
  assert.equal(await store.authenticate(hash,Date.now()),null);
  await store.login(id,account,hash,Date.now()+100000);
  await store.logout(hash);
  store=await createStore({filename,key});
  assert.equal(await store.authenticate(hash,Date.now()),null,'Logout survives a restart');
  assert(!fs.readFileSync(filename,'utf8').includes(account.access));
  assert.equal(fs.statSync(filename).mode&0o777,0o600);
  await assert.rejects(createStore({filename,key:crypto.randomBytes(32)}));
  await assert.rejects(createStore({filename,key,mode:'unknown'}),{code:'AUTH_STORE_CONFIG'});
  const env={DATABASE_URL:'postgresql://unused-local-test',API_ORIGIN:'https://production.example.test',STAGING_PREVIEW_MODE:'1'};
  const pool={connect(){throw Error('An invalid gate must not connect');}};
  for(const patch of [{},{STAGING_PREVIEW_MODE:'0'},{DATABASE_URL:''}])
    await assert.rejects(createStore({filename,key,mode:'postgres',pool,env:{...env,...patch}}),{code:'AUTH_STORE_CONFIG'});
  console.log('AUTH_FILE_STORE=PASS (legacy encryption, persistence, expiry, logout, permissions, invalid key and staging gates)');
})().catch(error=>{console.error('AUTH_FILE_STORE=FAIL',error.message);process.exitCode=1;})
  .finally(()=>fs.rmSync(folder,{recursive:true,force:true}));
