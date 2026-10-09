// Runs isolated, local backend with mocked Google and webhook responses.
const {spawn}=require('node:child_process'),{randomBytes}=require('node:crypto'),os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const host='http://127.0.0.1:8937', origin='https://ui.example.test';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'meetab-test-'));
const env={...process.env,PORT:'8937',DATA_FILE:path.join(folder,'db.enc'),API_ORIGIN:'https://api.example.test',FRONTEND_URL:origin+'/MeeTab1.1/',DATA_ENCRYPTION_KEY:randomBytes(32).toString('hex'),GOOGLE_CLIENT_ID:'mock-id',GOOGLE_CLIENT_SECRET:'mock-secret',IT_WEBHOOK_URL:'https://test-hook.example.test/notify',IT_SUPPORT_EMAIL:'it@example.test',IT_ROOM_LABELS_JSON:JSON.stringify({'gulisqari':'გულისკარი'})};
const child=spawn(process.execPath,['-r',path.resolve(__dirname,'mock-provider.cjs'),'server.js'],{cwd:path.resolve(__dirname,'../backend'),env,stdio:['ignore','pipe','pipe']});
let output='';child.stderr.on('data',c=>output+=String(c).slice(0,200));
const request=async(p,opts={})=>fetch(host+p,{redirect:'manual',...opts});
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
 await check('unauthenticated IT help','/api/it-request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId:'gulisqari'})},401);
 const start=await check('start OAuth','/auth/google/start',{},302);
 const state=new URL(start.headers.get('location')).searchParams.get('state');assert(state);
 const cb=await check('Google callback mock',`/auth/google/callback?state=${encodeURIComponent(state)}&code=local-test`,{},302);
 const ticket=new URL(cb.headers.get('location')).searchParams.get('ticket');assert(ticket);
 const sessionResponse=await check('ticket exchange','/auth/exchange',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({ticket})},200);
 const token=(await body(sessionResponse)).session;const headers={Origin:origin,Authorization:'Bearer '+token};
 const profile=await check('authenticated profile','/api/me',{headers},200);assert.equal((await body(profile)).name,'Test Fullname');
 await check('invalid origin','/api/me',{headers:{...headers,Origin:'https://other.example.test'}},403);
 await check('invalid date range','/api/events?calendarId=test-room&from=bad&to=bad',{headers},400);
 const from=new Date(Date.now()-60000).toISOString(),to=new Date(Date.now()+3600000).toISOString();
 const res=await check('calendar list names','/api/events?'+new URLSearchParams({calendarId:'test-room',from,to}),{headers},200);
 const events=(await body(res)).events;assert.deepEqual(events.map(x=>x.author),['Test Fullname','Bob Doe','სახელი მიუწვდომელია']);
 await check('invalid IT JSON','/api/it-request',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'not-json'},400);
 await check('invalid IT room','/api/it-request',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({roomId:'unknown'})},400);
 await check('IT webhook accepted','/api/it-request',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({roomId:'gulisqari'})},202);
 await check('IT cooldown','/api/it-request',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({roomId:'gulisqari'})},429);
 const during=new Date(Date.now()+180000).toISOString(),end=new Date(Date.now()+300000).toISOString();
 await check('overlapping booking rejected','/api/events',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({calendarId:'test-room',start:during,end,title:'overlap'})},409);
 console.log('LOCAL_BACKEND_SMOKE=PASS');
})().catch(e=>{console.error('LOCAL_BACKEND_SMOKE=FAIL',e.message,output);process.exitCode=1}).finally(()=>{child.kill('SIGTERM');fs.rmSync(folder,{force:true,recursive:true})});
