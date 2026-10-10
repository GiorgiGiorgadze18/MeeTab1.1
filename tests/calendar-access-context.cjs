'use strict';
// Actual frontend + local backend + fake OAuth identities; never contacts Render.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {spawn}=require('node:child_process'),{randomBytes,createHash,webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..'),host='http://127.0.0.1:8953',api='https://api.example.test',origin='https://ui.example.test';
const site=fs.readFileSync(path.join(root,'website/site-config.js'),'utf8'),auth=fs.readFileSync(path.join(root,'website/auth.js'),'utf8');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'meetab-calendar-access-'));
const child=spawn(process.execPath,['-r',path.join(__dirname,'mock-provider.cjs'),'server.js'],{
  cwd:path.join(root,'backend'),stdio:'ignore',env:{PORT:'8953',API_ORIGIN:api,FRONTEND_URL:origin+'/preview/',
    DATA_FILE:path.join(folder,'test.enc'),DATA_ENCRYPTION_KEY:randomBytes(32).toString('hex'),
    GOOGLE_CLIENT_ID:'mock-id',GOOGLE_CLIENT_SECRET:'mock-secret',IT_SUPPORT_EMAIL:'it@example.test',IT_ROOM_LABELS_JSON:JSON.stringify({gulisqari:'Test Room'}),
    ROOM_ACCESS_JSON:JSON.stringify({'google:test@example.test':{calendars:['test-room','manual-shared'],itRooms:['gulisqari']},
      'google:it-only@example.test':{calendars:[],itRooms:['gulisqari']}})}});
const request=(route,options={})=>fetch(host+route,{redirect:'manual',...options});
async function session(code){
  const verifier=randomBytes(32).toString('hex'),challenge=createHash('sha256').update(verifier).digest('base64url');
  const start=await request('/auth/google/start?'+new URLSearchParams({client_challenge:challenge}));assert.equal(start.status,302);
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const callback=await request('/auth/google/callback?'+new URLSearchParams({state,code}));assert.equal(callback.status,302);
  const ticket=new URL(callback.headers.get('location')).searchParams.get('ticket');
  const exchange=await request('/auth/exchange',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({ticket,verifier})});
  assert.equal(exchange.status,200);return (await exchange.json()).session;
}
function client(token,shared){
  const nodes=new Map(),calls=[];
  const node=()=>({value:'',classList:{add(){},remove(){}},addEventListener(e,fn){this[e]=fn;},replaceChildren(){},append(){}});
  const element=k=>{if(!nodes.has(k))nodes.set(k,node());return nodes.get(k);};
  const window={MEETAB_API_BASE:api},stored=new Map([['meetab_session',token]]);
  const location={search:'?room=guliskari',hostname:'ui.example.test',assign(url){this.destination=url;}};
  const context={window,location,URLSearchParams,crypto:webcrypto,TextEncoder,btoa,
    document:{querySelector:element,createElement:node},
    sessionStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
    localStorage:{getItem:k=>shared.get(k)||null,setItem:(k,v)=>shared.set(k,v)},
    fetch:async(url,options)=>{assert(url.startsWith(api+'/'));calls.push(url.slice(api.length));return request(url.slice(api.length),{
      ...options,headers:{...options.headers,Origin:origin}});}};
  vm.createContext(context);vm.runInContext(site,context);vm.runInContext(auth,context);
  return {window,element,calls,location,init:()=>window.MeeTabAuth.init()};
}
async function signIn(c,code){
  await c.element('#loginGoogle').click();const url=new URL(c.location.destination);
  const start=await request(url.pathname+url.search);assert.equal(start.status,302);
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const callback=await request('/auth/google/callback?'+new URLSearchParams({state,code}));assert.equal(callback.status,302);
  await c.window.MeeTabReceiveTicket(new URL(callback.headers.get('location')).searchParams.get('ticket'));
}
(async()=>{
  let healthy=false;
  for(let i=0;i<40;i++){if(child.exitCode!==null)throw Error('Test backend terminated');try{healthy=(await request('/health')).status===200;}catch{}if(healthy)break;await new Promise(r=>setTimeout(r,75));}
  assert(healthy);
  const shared=new Map([['meetab_calendar_google_gulisqari','test-room']]);
  const ownerToken=await session('local-test'),itToken=await session('it-only-test');
  const owner=client(ownerToken,shared);await owner.init();
  assert(owner.window.MeeTabAuth.ready());assert.equal(owner.window.MeeTabAuth.calendar(),'test-room');
  assert((await owner.window.MeeTabAuth.listEvents()).length>0);
  const it=client(itToken,shared);await it.init();
  assert.equal(it.window.MeeTabAuth.ready(),false);assert.equal(it.window.MeeTabAuth.calendar(),'');
  assert.equal(it.element('#calendarManual').value,'');assert.equal(it.element('#calendarManual').disabled,true);
  assert.equal(it.element('#calendarList').disabled,true);assert.equal(it.element('#saveCalendar').disabled,true);
  assert(it.element('#chosenCalendar').textContent.includes('წვდომა არ აქვს'));
  assert(!it.element('#chosenCalendar').textContent.includes('test-room'));
  assert.equal(it.calls.includes('/api/calendars'),false,'Skip provider list for explicit no-calendar scope');
  assert.equal((await it.window.MeeTabAuth.listEvents()).length,0);
  assert(!it.calls.some(x=>x.startsWith('/api/events')),'No forbidden background event request');
  const config=await it.window.MeeTabAuth.getITConfig('gulisqari');assert.equal(config.recipient,'it@example.test');assert.equal(config.canEdit,false);
  it.element('#calendarManual').value='test-room';await it.element('#saveCalendar').click();
  assert.equal(it.window.MeeTabAuth.calendar(),'','Programmatic save still rejects forbidden ID');
  assert.equal(shared.get('meetab_calendar_google_gulisqari'),'test-room','Keep valid room choice for returning owner');
  const returned=client(ownerToken,shared);await returned.init();
  assert(returned.window.MeeTabAuth.ready());assert.equal(returned.window.MeeTabAuth.calendar(),'test-room');
  assert.equal(returned.element('#calendarManual').disabled,false);
  // A shared ID may be authorized but absent from the provider's calendar list.
  shared.set('meetab_calendar_google_gulisqari','manual-shared');
  const manual=client(ownerToken,shared);await manual.init();
  assert(manual.window.MeeTabAuth.ready());assert.equal(manual.element('#calendarManual').value,'manual-shared');
  manual.element('#calendarManual').value='other-company';await manual.element('#saveCalendar').click();
  assert.equal(manual.window.MeeTabAuth.calendar(),'manual-shared');
  assert.equal(shared.get('meetab_calendar_google_gulisqari'),'manual-shared');
  shared.set('meetab_calendar_google_gulisqari','other-company');
  const forbidden=client(ownerToken,shared);await forbidden.init();
  assert.equal(forbidden.window.MeeTabAuth.ready(),false);assert.equal(forbidden.element('#calendarManual').value,'');
  shared.set('meetab_calendar_google_gulisqari','test-room');
  await owner.element('#disconnect').click();await signIn(owner,'it-only-test');
  assert.equal(owner.window.MeeTabAuth.ready(),false);assert(owner.element('#authMessage').textContent.includes('წვდომა არ აქვს'));
  await owner.element('#disconnect').click();await signIn(owner,'local-test');
  assert.equal(owner.window.MeeTabAuth.calendar(),'test-room');assert.equal(owner.element('#calendarManual').disabled,false);
  assert.equal(owner.element('#authMessage').textContent,'','Returning owner must not inherit the no-access message');
  console.log('CALENDAR_ACCESS_CONTEXT=PASS: owner → IT-only → owner; no stale ID/poll, IT read-only, shared manual ID, forbidden save/restore');
})().catch(e=>{console.error('CALENDAR_ACCESS_CONTEXT=FAIL',e.message);process.exitCode=1}).finally(async()=>{
  if(child.exitCode===null&&child.signalCode===null){const done=new Promise(r=>child.once('close',r));child.kill('SIGTERM');await done;}
  fs.rmSync(folder,{recursive:true,force:true});
});
