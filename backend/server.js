'use strict';
/* MeeTab backend: two confidential OAuth integrations + room-specific calendar sync.
 * Node >=20. No external packages. Use HTTPS reverse proxy in deployment. */
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { URL, URLSearchParams } = require('node:url');
const PORT = +process.env.PORT || 8080;
const API_ORIGIN = process.env.API_ORIGIN || '';
const FRONTEND_URL = process.env.FRONTEND_URL || '';
const APP_ORIGIN = 'https://appassets.androidplatform.net'; // trusted AndroidX WebViewAssetLoader origin
const DATA_FILE = process.env.DATA_FILE || './meetab-private.enc';
const SECRET = process.env.DATA_ENCRYPTION_KEY || '';
const AUTH_TTL = 2 * 60 * 1000, SESSION_TTL = 8 * 3600000;
const providers = {
  microsoft: {
    id: process.env.MS_CLIENT_ID, secret: process.env.MS_CLIENT_SECRET,
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'openid profile email offline_access User.Read Calendars.ReadWrite Calendars.ReadWrite.Shared'
  },
  google: {
    id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET,
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly'
  }
};
const key = SECRET && Buffer.from(SECRET, 'hex');
if (!API_ORIGIN.startsWith('https://') || !FRONTEND_URL.startsWith('https://') || !key || key.length !== 32) {
  console.error('Required: HTTPS API_ORIGIN, HTTPS FRONTEND_URL, 64-hex DATA_ENCRYPTION_KEY'); process.exit(1);
}
const front = new URL(FRONTEND_URL), api = new URL(API_ORIGIN);
if (front.search || front.hash || api.pathname !== '/' || api.search) {
  console.error('FRONTEND_URL cannot include query/hash; API_ORIGIN must be HTTPS origin only'); process.exit(1);
}
const rand = () => crypto.randomBytes(32).toString('base64url');
const digest = s => crypto.createHash('sha256').update(s).digest('hex');
const encrypt = plain => { const iv=crypto.randomBytes(12), c=crypto.createCipheriv('aes-256-gcm',key,iv), encrypted=Buffer.concat([c.update(plain,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),encrypted]).toString('base64'); };
const decrypt = encoded => { const b=Buffer.from(encoded,'base64'), d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString(); };
let db = {accounts:{},sessions:{}};
try { db=JSON.parse(decrypt(fs.readFileSync(DATA_FILE,'utf8'))); } catch (e) { if (fs.existsSync(DATA_FILE)) throw e; }
function save() {const filename=DATA_FILE+'.tmp';fs.writeFileSync(filename,encrypt(JSON.stringify(db)),{mode:0o600}); fs.renameSync(filename,DATA_FILE);}
const pending=new Map(),tickets=new Map(),locks=new Set();
function send(res,status,obj,origin){
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer'};
  if(origin===front.origin || origin===APP_ORIGIN){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Headers']='Authorization, Content-Type';headers['Access-Control-Allow-Methods']='GET, POST, OPTIONS';headers.Vary='Origin';}
  res.writeHead(status,headers);res.end(JSON.stringify(obj));
}
function redirect(res,url){res.writeHead(302,{'Location':url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'"});res.end();}
async function parseJSON(req){let txt='';for await(const ch of req){txt+=ch;if(txt.length>10000)throw new Error('BODY_TOO_LARGE');}return JSON.parse(txt||'{}');}
async function providerRequest(url,access,options={}){
  const r=await fetch(url,{...options,headers:{Authorization:'Bearer '+access,'Content-Type':'application/json',...options.headers}});
  const txt=await r.text();let result;try{result=JSON.parse(txt);}catch{result={error:txt.slice(0,180)}};
  if(!r.ok){const e=new Error(result.error?.message||result.error_description||result.error?.description||result.error||'Calendar provider error');e.status=r.status;e.code='PROVIDER_ERROR';throw e;}
  return result;
}
async function exchangeToken(provider,body){
  const conf=providers[provider];const r=await fetch(conf.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
  const x=await r.json();if(!r.ok||!x.access_token)throw new Error('OAuth token failed: '+(x.error_description||x.error||r.status));return x;
}
async function accessToken(account){
  if(Date.now()+60000<(account.expires||0))return account.access;
  if(!account.refresh)throw Object.assign(new Error('Please sign in again'),{status:401});
  const p=providers[account.provider]; const x=await exchangeToken(account.provider,{grant_type:'refresh_token',refresh_token:account.refresh,client_id:p.id,client_secret:p.secret});
  account.access=x.access_token;account.refresh=x.refresh_token||account.refresh;account.expires=Date.now()+x.expires_in*1000;save();return account.access;
}
function authenticate(req){const match=/^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization||'');const session=match&&db.sessions[digest(match[1])];if(!session||session.expires<Date.now())throw Object.assign(new Error('Login required'),{status:401});const account=db.accounts[session.accountId];if(!account)throw Object.assign(new Error('Login expired'),{status:401});return {session,account,hash:digest(match[1])};}
function calendarRoute(provider,id,kind){
  if(typeof id!=='string'||!id.trim()||id.length>256)throw Object.assign(new Error('Choose a room calendar'),{status:400});
  const escaped=encodeURIComponent(id.trim());
  if(provider==='google')return `https://www.googleapis.com/calendar/v3/calendars/${escaped}/events`;
  // 'me' is opt-in. Other values may be calendar IDs or room mailbox addresses (shared access needed).
  if(id==='me')return 'https://graph.microsoft.com/v1.0/me/'+(kind==='list'?'calendarView':'events');
  if(id.includes('@'))return `https://graph.microsoft.com/v1.0/users/${escaped}/${kind==='list'?'calendarView':'events'}`;
  return `https://graph.microsoft.com/v1.0/me/calendars/${escaped}/${kind==='list'?'calendarView':'events'}`;
}
function graphDate(x) { const t=x?.dateTime||''; return /(?:Z|[+-]\d\d:\d\d)$/.test(t)?t:t+'Z'; }
function normalizedEvent(provider,e){
  if(provider==='google')return {id:e.id,title:e.summary||'დაკავებულია',start:e.start?.dateTime||e.start?.date,end:e.end?.dateTime||e.end?.date,author:e.organizer?.displayName||e.organizer?.email||'',kind:e.hangoutLink?'Google Meet':'Room Meeting'};
  return {id:e.id,title:e.subject||'დაკავებულია',start:graphDate(e.start),end:graphDate(e.end),author:e.organizer?.emailAddress?.name||'',kind:e.isOnlineMeeting?'Teams Meeting':'Room Meeting'};
}
async function listEvents(account,id,from,to){
  const t=await accessToken(account); const path=calendarRoute(account.provider,id,'list'); let url;
  if(account.provider==='google')url=path+'?'+new URLSearchParams({timeMin:from,timeMax:to,singleEvents:'true',orderBy:'startTime',maxResults:'250',showDeleted:'false'});
  else url=path+'?'+new URLSearchParams({startDateTime:from,endDateTime:to,'$top':'250','$select':'id,subject,start,end,organizer,isOnlineMeeting,showAs'});
  const out=[],limit=4;for(let i=0;i<limit && url;i++){
    const j=await providerRequest(url,t,account.provider==='microsoft'?{headers:{Prefer:'outlook.timezone="UTC"'}}:{});
    out.push(...(j.items||j.value||[])); url=j.nextPageToken ? (path+'?'+new URLSearchParams({timeMin:from,timeMax:to,singleEvents:'true',orderBy:'startTime',pageToken:j.nextPageToken,maxResults:'250'})) : (j['@odata.nextLink']||'');
    if(url&&!url.startsWith(account.provider==='google'?'https://www.googleapis.com/calendar/v3/':'https://graph.microsoft.com/v1.0/'))break;
  }
  return out.filter(x => x.status!=='cancelled' && x.showAs!=='free').map(e=>normalizedEvent(account.provider,e)).filter(e=>e.start&&e.end);
}
const startAuth=(provider,mode,res)=>{
  const p=providers[provider];if(!p?.id||!p.secret)return send(res,503,{error:'Provider is not configured'});
  if(!['app','web'].includes(mode))return send(res,400,{error:'Invalid mode'});
  const state=rand(),verifier=rand(),challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  pending.set(state,{provider,mode,verifier,expires:Date.now()+10*60000});
  const q=new URLSearchParams({client_id:p.id,response_type:'code',redirect_uri:`${API_ORIGIN}/auth/${provider}/callback`,response_mode:'query',scope:p.scope,state,code_challenge:challenge,code_challenge_method:'S256'});
  if(provider==='google'){q.set('access_type','offline');q.set('prompt','consent');}
  return redirect(res,p.authorize+'?'+q);
};
async function callback(provider,url,res){
  const s=url.searchParams.get('state'), entry=s&&pending.get(s);
  if(s)pending.delete(s);
  if(!entry||entry.expires<Date.now()||entry.provider!==provider)throw Object.assign(new Error('Invalid/expired OAuth state'),{status:400});
  if(url.searchParams.get('error'))throw Object.assign(new Error('Authentication denied'),{status:400});
  const code=url.searchParams.get('code');if(!code)throw Object.assign(new Error('Missing authorization code'),{status:400});
  const p=providers[provider];const t=await exchangeToken(provider,{client_id:p.id,client_secret:p.secret,code,code_verifier:entry.verifier,grant_type:'authorization_code',redirect_uri:`${API_ORIGIN}/auth/${provider}/callback`});
  const prof=await providerRequest(provider==='google'?'https://openidconnect.googleapis.com/v1/userinfo':'https://graph.microsoft.com/v1.0/me',t.access_token);
  const userId=provider==='google'?prof.sub:prof.id;
  if(!userId)throw new Error('Missing provider user id');
  const accountId=provider+':'+userId;const old=db.accounts[accountId]||{};
  db.accounts[accountId]={provider,name:prof.name||prof.displayName||'',email:prof.email||prof.mail||prof.userPrincipalName||'',access:t.access_token,refresh:t.refresh_token||old.refresh||'',expires:Date.now()+(t.expires_in||3600)*1000};
  const session=rand();db.sessions[digest(session)]={accountId,expires:Date.now()+SESSION_TTL};save();
  const ticket=rand();tickets.set(ticket,{session,mode:entry.mode,expires:Date.now()+AUTH_TTL});
  const dest=new URL('auth-return.html',FRONTEND_URL.endsWith('/')?FRONTEND_URL:FRONTEND_URL+'/');dest.searchParams.set('ticket',ticket);dest.searchParams.set('mode',entry.mode);
  redirect(res,dest.href);
}
async function handler(req,res){
  const origin=req.headers.origin||'';
  if(req.method==='OPTIONS')return send(res,204,{},origin);
  const url=new URL(req.url,API_ORIGIN);const parts=url.pathname.split('/').filter(Boolean);
  try {
    if(url.pathname==='/health')return send(res,200,{ok:true});
    if(parts[0]==='auth'&&providers[parts[1]]&&parts[2]==='start'&&req.method==='GET')return startAuth(parts[1],url.searchParams.get('mode')||'web',res);
    if(parts[0]==='auth'&&providers[parts[1]]&&parts[2]==='callback'&&req.method==='GET')return await callback(parts[1],url,res);
    if(url.pathname==='/auth/exchange'&&req.method==='POST'){
      if(origin!==front.origin && origin!==APP_ORIGIN)return send(res,403,{error:'Invalid origin'},origin);
      const b=await parseJSON(req),v=tickets.get(b.ticket);tickets.delete(b.ticket);
      if(!v||v.expires<Date.now())return send(res,401,{error:'Link expired. Sign in again.'},origin);
      return send(res,200,{session:v.session,expiresIn:SESSION_TTL/1000},origin);
    }
    if(origin&&origin!==front.origin&&origin!==APP_ORIGIN)return send(res,403,{error:'Invalid origin'},origin);
    if(parts[0]!=='api')return send(res,404,{error:'Not found'},origin);
    const {account,hash}=authenticate(req);
    if(url.pathname==='/api/me'&&req.method==='GET')return send(res,200,{provider:account.provider,name:account.name,email:account.email},origin);
    if(url.pathname==='/api/logout'&&req.method==='POST'){delete db.sessions[hash];save();return send(res,200,{ok:true},origin);}
    if(url.pathname==='/api/calendars'&&req.method==='GET'){
      const tok=await accessToken(account);let names=[];
      if(account.provider==='google'){
        const j=await providerRequest('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250',tok);
        names=(j.items||[]).map(x=>({id:x.id,name:x.summary||x.id,role:x.accessRole}));
      }else{
        const j=await providerRequest('https://graph.microsoft.com/v1.0/me/calendars?$top=100',tok);
        names=[{id:'me',name:'ჩემი მთავარი კალენდარი'}].concat((j.value||[]).map(x=>({id:x.id,name:x.name||x.id})));
      }
      return send(res,200,{calendars:names},origin);
    }
    if(url.pathname==='/api/events'&&req.method==='GET'){
      const id=url.searchParams.get('calendarId'),from=url.searchParams.get('from'),to=url.searchParams.get('to');
      if(!from||!to||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(to)-Date.parse(from)>15*864e5||Date.parse(to)<=Date.parse(from))return send(res,400,{error:'Invalid calendar date range'},origin);
      return send(res,200,{events:await listEvents(account,id,from,to)},origin);
    }
    if(url.pathname==='/api/events'&&req.method==='POST'){
      const x=await parseJSON(req);const s=Date.parse(x.start),e=Date.parse(x.end);
      if(!x.calendarId||!Number.isFinite(s)||!Number.isFinite(e)||s<Date.now()-2*60000||e<=s||e-s>8*3600000||typeof x.title!=='string'||x.title.length>100)return send(res,400,{error:'Invalid booking'},origin);
      const keyLock=account.provider+':'+x.calendarId;if(locks.has(keyLock))return send(res,409,{error:'Another booking is being processed'},origin);
      locks.add(keyLock);
      try {
        const existing=await listEvents(account,x.calendarId,new Date(s).toISOString(),new Date(e).toISOString());
        if(existing.some(y=>Date.parse(y.start)<e&&Date.parse(y.end)>s))return send(res,409,{error:'Time slot occupied; please refresh'},origin);
        const access=await accessToken(account);const body=account.provider==='google'?{summary:x.title,start:{dateTime:new Date(s).toISOString()},end:{dateTime:new Date(e).toISOString()}}:{subject:x.title,showAs:'busy',importance:x.urgent?'high':'normal',start:{dateTime:new Date(s).toISOString(),timeZone:'UTC'},end:{dateTime:new Date(e).toISOString(),timeZone:'UTC'}};
        const result=await providerRequest(calendarRoute(account.provider,x.calendarId,'create'),access,{method:'POST',body:JSON.stringify(body)});
        return send(res,201,{id:result.id,ok:true},origin);
      }finally{locks.delete(keyLock);}
    }
    return send(res,404,{error:'Unknown API path'},origin);
  }catch(e){console.error('Request:',url.pathname,e.message);return send(res,e.status>=400&&e.status<500?e.status:502,{error:e.message||'Service error'},origin);}
}
const server=http.createServer(handler);server.listen(PORT,()=>console.log(`MeeTab API listening on ${PORT}`));
setInterval(()=>{const now=Date.now();for(const [k,v] of pending)if(v.expires<now)pending.delete(k);for(const [k,v] of tickets)if(v.expires<now)tickets.delete(k);},60000).unref();
