// Runs isolated, local backend with mocked Google and webhook responses.
const {spawn}=require('node:child_process'),{randomBytes,createHash}=require('node:crypto'),os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const host='http://127.0.0.1:8937', origin='https://ui.example.test';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'meetab-test-'));
const env={...process.env,PORT:'8937',DATA_FILE:path.join(folder,'db.enc'),API_ORIGIN:'https://api.example.test',FRONTEND_URL:origin+'/MeeTab1.1/',DATA_ENCRYPTION_KEY:randomBytes(32).toString('hex'),GOOGLE_CLIENT_ID:'mock-id',GOOGLE_CLIENT_SECRET:'mock-secret',IT_WEBHOOK_URL:'https://test-hook.example.test/notify',IT_SUPPORT_EMAIL:'it@example.test',IT_WEBHOOK_TOKEN:'mock-private-webhook-token',IT_ADMIN_TOKEN:'local-test-admin-token-at-least-24-chars',IT_ADMIN_IDENTITIES_JSON:JSON.stringify(['google:test@example.test']),
IT_GLOBAL_ADMIN_IDENTITIES_JSON:JSON.stringify(['google:test@example.test']),DATABASE_URL:'postgresql://mock-local-unit-test',IT_ROOM_RECIPIENTS_JSON:JSON.stringify({'gulisqari':'it-room@example.test'}),IT_ROOM_LABELS_JSON:JSON.stringify({'gulisqari':'გულისკარი','room2':'ოთახი 2'}),ROOM_ACCESS_JSON:JSON.stringify({'google:test@example.test':{calendars:['test-room'],itRooms:['gulisqari']}}),AUTHOR_NAMES_JSON:JSON.stringify({'directory@example.test':'ლაშა გიორგაძე'})};
const child=spawn(process.execPath,['-r',path.resolve(__dirname,'mock-provider.cjs'),'server.js'],{cwd:path.resolve(__dirname,'../backend'),env,stdio:['ignore','pipe','pipe']});
let output='';child.stderr.on('data',c=>output+=String(c).slice(0,200));
const request=async(p,opts={})=>fetch(host+p,{redirect:'manual',...opts});
const verifier=randomBytes(32).toString('base64url'),clientChallenge=createHash('sha256').update(verifier).digest('base64url');
const body=async r=>r.json();
const check=async(label,p,opts,status)=>{const r=await request(p,opts);assert.equal(r.status,status,label+' HTTP '+r.status);console.log('PASS',label,status);return r;};
(async()=>{
 for(let tries=0;tries<40;tries++){
  if(child.exitCode!==null)throw Error('Backend terminated early');
  try{const r=await request('/health');if(r.status===200)break;}catch{}
  await new Promise(r=>setTimeout(r,75));
 }
 await check('health','/health',{},200);
 await check('unauthenticated profile','/api/me',{},401);
 await check('unauthenticated IT settings','/api/it-config?roomId=gulisqari',{},401);
 await check('unauthenticated IT help','/api/it-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId:'gulisqari'})},401);
 await check('reject unrecognized OAuth mode','/auth/google/start?mode=external',{},400);
 await check('reject staging OAuth mode when preview is disabled','/auth/google/start?mode=staging',{},400);
 const start=await check('start OAuth','/auth/google/start?'+new URLSearchParams({client_challenge:clientChallenge}),{},302);
 const state=new URL(start.headers.get('location')).searchParams.get('state');assert(state);
 const cb=await check('Google callback mock',`/auth/google/callback?state=${encodeURIComponent(state)}&code=local-test`,{},302);
 const ticket=new URL(cb.headers.get('location')).searchParams.get('ticket');assert(ticket);
 const sessionResponse=await check('ticket exchange','/auth/exchange',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({ticket,verifier})},200);
 const token=(await body(sessionResponse)).session;const headers={Origin:origin,Authorization:'Bearer '+token};
 const profile=await check('authenticated profile','/api/me',{headers},200);assert.equal((await body(profile)).name,'Test Fullname');
 await check('invalid origin','/api/me',{headers:{...headers,Origin:'https://other.example.test'}},403);
 await check('invalid date range','/api/events?calendarId=test-room&from=bad&to=bad',{headers},400);
 const from=new Date(Date.now()-60000).toISOString(),to=new Date(Date.now()+3600000).toISOString();
 const calendars=await check('scoped calendar options','/api/calendars',{headers},200);assert.deepEqual((await body(calendars)).calendars.map(x=>x.id),['test-room']);
 await check('cross-room read blocked','/api/events?'+new URLSearchParams({calendarId:'other-room',from,to}),{headers},403);
 await check('cross-room booking blocked','/api/events',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({calendarId:'other-room',start:new Date(Date.now()+360000).toISOString(),end:new Date(Date.now()+900000).toISOString(),title:'unauthorized'})},403);
 await check('reject malformed booking JSON','/api/events',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{bad'},400);
 await check('reject non-JSON media type','/api/events',{method:'POST',headers:{...headers,'Content-Type':'text/plain'},body:'hello'},415);
 await check('reject large booking payload','/api/events',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'x'.repeat(11000)},413);
 const res=await check('calendar list names','/api/events?'+new URLSearchParams({calendarId:'test-room',from,to}),{headers},200);
 const events=(await body(res)).events;
 assert.deepEqual(events.map(x=>x.author),['Test Fullname','Bob Doe','ლაშა გიორგაძე','სახელი მიუწვდომელია','Creator Name']);
 assert(!events.some(e=>e.author.includes('@')),'Never expose an email as the author');
 const initial=await check('read current IT recipient','/api/it-config?roomId=gulisqari',{headers},200);
 const initialSettings=await body(initial);
 assert.equal(initialSettings.recipient,'it-room@example.test');assert.equal(initialSettings.canEdit,true);
 const otherIT=await check('global administrator can view registered room2 IT config','/api/it-config?roomId=room2',{headers},200);
 assert.equal((await body(otherIT)).canEdit,true);
 await check('unregistered room settings still rejected','/api/it-config?roomId=other-company',{headers},400);
 const updateRecipient=(roomId,recipient,adminCode,extra={})=>({method:'POST',
   headers:{...headers,'Content-Type':'application/json','X-MeeTab-Admin-Code':adminCode,...extra},
   body:JSON.stringify({roomId,recipient})});
 await check('wrong admin key blocks changes','/api/it-config',updateRecipient('gulisqari','bad-it@example.test','wrong-secret'),403);
 const globalWrite=await check('global admin changes second registered IT room','/api/it-config',
   updateRecipient('room2','second-room-it@example.test','local-test-admin-token-at-least-24-chars'),200);
 assert.equal((await body(globalWrite)).recipient,'second-room-it@example.test');
 const secondRecipient=await check('global room settings persisted independently','/api/it-config?roomId=room2',{headers},200);
 assert.equal((await body(secondRecipient)).recipient,'second-room-it@example.test');
 await check('reject invalid IT email','/api/it-config',updateRecipient('gulisqari','not-an-email','local-test-admin-token-at-least-24-chars'),400);
 const updated=await check('admin saves per-room IT recipient','/api/it-config',
   updateRecipient('gulisqari','updated-it@example.test','local-test-admin-token-at-least-24-chars'),200);
 assert.equal((await body(updated)).recipient,'updated-it@example.test');
 const reread=await check('saved IT recipient is returned','/api/it-config?roomId=gulisqari',{headers},200);
 assert.equal((await body(reread)).recipient,'updated-it@example.test');
 await check('invalid IT JSON','/api/it-request',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'not-json'},400);
 await check('global admin still cannot send cross-tenant IT requests','/api/it-request',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({roomId:'room2'})},403);
 await check('invalid IT room','/api/it-request',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({roomId:'unknown'})},400);
 await check('IT webhook accepted','/api/it-request',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({roomId:'gulisqari'})},202);
 await check('IT cooldown','/api/it-request',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({roomId:'gulisqari'})},429);
 // A Google identity presenting the SAME email with email_verified:false must never
 // gain IT administration or access to a room through the email-based ACL.
 const startBad=await check('unverified Google OAuth test start','/auth/google/start?'+new URLSearchParams({client_challenge:clientChallenge}),{},302);
 const stateBad=new URL(startBad.headers.get('location')).searchParams.get('state');
 const cbBad=await check('unverified Google callback','/auth/google/callback?'+new URLSearchParams({state:stateBad,code:'unverified-test'}),{},302);
 const ticketBad=new URL(cbBad.headers.get('location')).searchParams.get('ticket');
 const resultBad=await check('unverified ticket exchange','/auth/exchange',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({ticket:ticketBad,verifier})},200);
 const badToken=(await body(resultBad)).session,badHeaders={Origin:origin,Authorization:'Bearer '+badToken};
 await check('unverified email cannot read IT config','/api/it-config?roomId=room2',{headers:badHeaders},403);
 await check('unverified email cannot edit global IT config','/api/it-config',{
   method:'POST',headers:{...badHeaders,'Content-Type':'application/json','X-MeeTab-Admin-Code':'local-test-admin-token-at-least-24-chars'},
   body:JSON.stringify({roomId:'room2',recipient:'attacker@example.test'})},403);
 await check('unverified email cannot access room calendar','/api/events?'+new URLSearchParams({calendarId:'test-room',from,to}),{headers:badHeaders},403);
 const during=new Date(Date.now()+180000).toISOString(),end=new Date(Date.now()+300000).toISOString();
 await check('overlapping booking rejected','/api/events',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({calendarId:'test-room',start:during,end,title:'overlap'})},409);
 // Verify the local write throttle without ever writing a real provider event.
 let throttled=false;
 for(let i=0;i<20;i++){
   const r=await request('/api/events',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({calendarId:'test-room',start:during,end,title:'overlap'})});
   if(r.status===429){assert.equal(r.headers.get('retry-after')!==null,true);throttled=true;break;}
   assert.equal(r.status,409);
 }
 assert(throttled,'Rate limit did not activate');console.log('PASS per-session booking rate limit 429');
 console.log('LOCAL_BACKEND_SMOKE=PASS');
})().catch(e=>{console.error('LOCAL_BACKEND_SMOKE=FAIL',e.message,output);process.exitCode=1}).finally(()=>{child.kill('SIGTERM');fs.rmSync(folder,{force:true,recursive:true})});
