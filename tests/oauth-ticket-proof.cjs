'use strict';
// Actual frontend + local backend with mock OAuth; no real identities or writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {spawn}=require('node:child_process'),{randomBytes,webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..'),host='http://127.0.0.1:8951',api='https://api.example.test',appOrigin='https://appassets.androidplatform.net';
const site=fs.readFileSync(path.join(root,'website/site-config.js'),'utf8'),auth=fs.readFileSync(path.join(root,'website/auth.js'),'utf8');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'meetab-proof-'));
const child=spawn(process.execPath,['-r',path.join(__dirname,'mock-provider.cjs'),'server.js'],{
  cwd:path.join(root,'backend'),stdio:'ignore',env:{PORT:'8951',API_ORIGIN:api,FRONTEND_URL:'https://ui.example.test/preview/',
    DATA_FILE:path.join(folder,'test.enc'),DATA_ENCRYPTION_KEY:randomBytes(32).toString('hex'),
    GOOGLE_CLIENT_ID:'mock-id',GOOGLE_CLIENT_SECRET:'mock-secret',STAGING_PREVIEW_MODE:'1'}});
const request=(route,options={})=>fetch(host+route,{redirect:'manual',...options});
function client(native=true){
  const nodes=new Map(),stored=new Map(),calls=[];
  const node=()=>({value:'',classList:{add(){},remove(){}},addEventListener(e,fn){this[e]=fn;},replaceChildren(){},append(){}});
  const element=k=>{if(!nodes.has(k))nodes.set(k,node());return nodes.get(k);};
  const storage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
  const window={MEETAB_API_BASE:api,MEETAB_APP_MODE:'staging'},location={hostname:native?'appassets.androidplatform.net':'ui.example.test',search:'',assign(url){this.destination=url;}};
  const context={window,location,URLSearchParams,crypto:webcrypto,TextEncoder,btoa,
    document:{querySelector:element,createElement:node},sessionStorage:storage,localStorage:{getItem(){return null;},setItem(){}},
    fetch:async(url,options)=>{assert(url.startsWith(api+'/'));calls.push({url,options});return request(url.slice(api.length),{
      ...options,headers:{...options.headers,Origin:native?appOrigin:'https://ui.example.test'}});}};
  vm.createContext(context);vm.runInContext(site,context);vm.runInContext(auth,context);
  return {window,location,stored,calls,element,init:()=>window.MeeTabAuth.init(),login:()=>element('#loginGoogle').click()};
}
async function ticketFor(c){
  const url=new URL(c.location.destination),start=await request(url.pathname+url.search);
  assert.equal(start.status,302);
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const callback=await request('/auth/google/callback?'+new URLSearchParams({state,code:'local-test'}));
  assert.equal(callback.status,302);
  return new URL(callback.headers.get('location')).searchParams.get('ticket');
}
(async()=>{
  let healthy=false;
  for(let i=0;i<40;i++){if(child.exitCode!==null)throw Error('Test backend terminated');try{healthy=(await request('/health')).status===200;}catch{}if(healthy)break;await new Promise(r=>setTimeout(r,75));}
  assert(healthy);
  for(const native of [true,false]){
    const owner=client(native),other=client(native),unsolicited=client(native);
    await owner.init();await other.init();await unsolicited.init();
    await owner.login();await other.login();
    const proof=JSON.parse(owner.stored.get('meetab_auth_attempt')),ticket=await ticketFor(owner);
    assert(!owner.location.destination.includes(proof.verifier));
    await unsolicited.window.MeeTabReceiveTicket(ticket);
    assert.equal(unsolicited.calls.length,0,'No callback exchange without a locally started attempt');
    await other.window.MeeTabReceiveTicket(ticket);
    assert.equal(other.stored.has('meetab_session'),false,'A different client proof cannot receive the session');
    assert.equal(other.stored.has('meetab_auth_attempt'),true,'A failed injected callback must preserve the legitimate attempt');
    await owner.window.MeeTabReceiveTicket(ticket);
    assert(owner.stored.get('meetab_session'));
    assert.equal(owner.window.MeeTabAuth.provider(),'google');
    assert.equal(owner.stored.has('meetab_auth_attempt'),false,'Remove successful proof');
    const replay=await request('/auth/exchange',{method:'POST',headers:{Origin:native?appOrigin:'https://ui.example.test','Content-Type':'application/json'},body:JSON.stringify({ticket,verifier:proof.verifier})});
    assert.equal(replay.status,401);
    const ownTicket=await ticketFor(other);
    await other.window.MeeTabReceiveTicket(ownTicket);
    assert(other.stored.get('meetab_session'),'Other client can finish its own flow after rejection');
    console.log('PASS '+(native?'native':'web')+' initiating proof, copied/unsolicited ticket denial, valid exchange and replay denial');
  }
  const stale=client();await stale.init();await stale.login();
  const record=JSON.parse(stale.stored.get('meetab_auth_attempt'));record.at=Date.now()-13*60*1000;
  stale.stored.set('meetab_auth_attempt',JSON.stringify(record));
  await stale.window.MeeTabReceiveTicket('a'.repeat(43));assert.equal(stale.calls.length,0,'Expired proof must not exchange');
  const cancelled=client();await cancelled.init();await cancelled.login();await cancelled.element('#disconnect').click();
  assert.equal(cancelled.stored.has('meetab_auth_attempt'),false,'Logout cancels local pending sign-in');
  for(const value of [null,[],42]){
    const r=await request('/auth/exchange',{method:'POST',headers:{Origin:appOrigin,'Content-Type':'application/json'},body:JSON.stringify(value)});
    assert.equal(r.status,400,'Malformed exchange input must be rejected explicitly');
  }
  // Execute without Web Crypto to verify no insecure fallback URL is opened.
  const noCrypto={};const tinyNodes=new Map();
  const element=k=>{if(!tinyNodes.has(k))tinyNodes.set(k,{addEventListener(e,fn){this[e]=fn;},classList:{add(){},remove(){}}});return tinyNodes.get(k);};
  const window={MEETAB_API_BASE:api},location={search:'',hostname:'ui.example.test',assign(){throw Error('Must not navigate without secure proof');}};
  const storage={getItem(){return null;},setItem(){throw Error('Must not store without secure proof');},removeItem(){}};
  const context={window,location,URLSearchParams,document:{querySelector:element},sessionStorage:storage,localStorage:storage,crypto:noCrypto};
  vm.createContext(context);vm.runInContext(site,context);vm.runInContext(auth,context);
  await window.MeeTabAuth.init();await element('#loginGoogle').click();assert(element('#authMessage').textContent);
  console.log('OAUTH_CLIENT_PROOF=PASS (CODE/TEST; real provider and physical-device validation pending)');
})().catch(e=>{console.error('OAUTH_CLIENT_PROOF=FAIL',e.message);process.exitCode=1}).finally(async()=>{
  if(child.exitCode===null&&child.signalCode===null){const done=new Promise(r=>child.once('close',r));child.kill('SIGTERM');await done;}
  fs.rmSync(folder,{recursive:true,force:true});
});
