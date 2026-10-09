'use strict';
/* MeeTab backend: two confidential OAuth integrations + room-specific calendar sync.
 * Node >=20. No external packages. Use HTTPS reverse proxy in deployment. */
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const {serveStagingPreview}=require('./staging-preview');
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
// IT settings live in Render PostgreSQL rather than the ephemeral Free web-service disk.
const itStore=process.env.DATABASE_URL?require('./it-store')(process.env.DATABASE_URL):null;
function save() {const filename=DATA_FILE+'.tmp';fs.writeFileSync(filename,encrypt(JSON.stringify(db)),{mode:0o600}); fs.renameSync(filename,DATA_FILE);}
const pending=new Map(),tickets=new Map(),locks=new Set();
// Server-owned IT recipient and webhook; never trust public frontend input for routing.
const IT_WEBHOOK_URL=process.env.IT_WEBHOOK_URL||'';
const IT_SUPPORT_EMAIL=process.env.IT_SUPPORT_EMAIL||'';
const IT_WEBHOOK_TOKEN=process.env.IT_WEBHOOK_TOKEN||''; // Optional private Bearer token, never sent to the browser.
// Admin changes require BOTH a signed-in allowlisted identity and a private secret.
// Admin secret must never be put in public HTML or localStorage.
const IT_ADMIN_TOKEN=process.env.IT_ADMIN_TOKEN||'';
// DATABASE_URL presence enables the PostgreSQL-backed editor; no local-file fallback.
let IT_ADMIN_IDENTITIES=new Set();
if(process.env.IT_ADMIN_IDENTITIES_JSON){
  try {
    const raw=JSON.parse(process.env.IT_ADMIN_IDENTITIES_JSON);
    if(!Array.isArray(raw)||!raw.length||raw.some(x=>typeof x!=='string'||!/^(google|microsoft):[^\s:@]+@[^\s:@]+\.[^\s:@]+$/.test(x)||x!==x.toLowerCase()))throw Error('Invalid admin identities');
    IT_ADMIN_IDENTITIES=new Set(raw);
  }catch {console.error('Invalid IT_ADMIN_IDENTITIES_JSON');process.exit(1);}
}
// A separately configured founder/platform administrator may edit recipients for
// any room REGISTERED on this backend, without gaining calendar or booking access.
let IT_GLOBAL_ADMIN_IDENTITIES=new Set();
if(process.env.IT_GLOBAL_ADMIN_IDENTITIES_JSON){
  try{
    const raw=JSON.parse(process.env.IT_GLOBAL_ADMIN_IDENTITIES_JSON);
    if(!Array.isArray(raw)||!raw.length||raw.some(x=>typeof x!=='string'||!/^(google|microsoft):[^\s:@]+@[^\s:@]+\.[^\s:@]+$/.test(x)||x!==x.toLowerCase()))
      throw Error('Invalid global admin identities');
    IT_GLOBAL_ADMIN_IDENTITIES=new Set(raw);
  }catch{console.error('Invalid IT_GLOBAL_ADMIN_IDENTITIES_JSON');process.exit(1);}
}
if(IT_ADMIN_TOKEN&&IT_ADMIN_TOKEN.length<24){console.error('IT_ADMIN_TOKEN must be at least 24 characters');process.exit(1);}
const itConfigAdminsReady=Boolean(IT_ADMIN_TOKEN&&(IT_ADMIN_IDENTITIES.size||IT_GLOBAL_ADMIN_IDENTITIES.size)&&itStore);
const validItEmail=value=>typeof value==='string'&&value.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const validItRoom=roomId=>typeof roomId==='string'&&Object.hasOwn(IT_ROOMS,roomId)&&typeof IT_ROOMS[roomId]==='string';
const savedItRecipient=async roomId=>itStore?await itStore.get(roomId):null;
const configuredItRecipient=async roomId=>(await savedItRecipient(roomId))||(IT_ROOM_RECIPIENTS?IT_ROOM_RECIPIENTS[roomId]:IT_SUPPORT_EMAIL)||null;
const itAdminIdentity=account=>account.provider+':'+String(account.email||'').trim().toLowerCase();
// Google administrators must have an identity whose email is verified by Google.
// Existing logins need to sign in again after this feature is deployed.
const verifiedItAdmin=account=>account.provider!=='google'||account.emailVerified===true;
const isItGlobalAdmin=account=>verifiedItAdmin(account)&&IT_GLOBAL_ADMIN_IDENTITIES.has(itAdminIdentity(account));
const isItConfigAdmin=account=>verifiedItAdmin(account)&&
  (IT_ADMIN_IDENTITIES.has(itAdminIdentity(account))||IT_GLOBAL_ADMIN_IDENTITIES.has(itAdminIdentity(account)));
const correctAdminToken=input=>{
  if(typeof input!=='string'||!IT_ADMIN_TOKEN||input.length>1024)return false;
  const a=crypto.createHash('sha256').update(input).digest(),b=crypto.createHash('sha256').update(IT_ADMIN_TOKEN).digest();
  return crypto.timingSafeEqual(a,b);
};
if(/[\r\n]/.test(IT_WEBHOOK_TOKEN)){console.error('Invalid IT_WEBHOOK_TOKEN');process.exit(1);}
// Explicit, provider-specific per-account ACL. Configured via private Render environment.
// Shape: {"google:person@example.com":{"calendars":["room-id"],"itRooms":["room-key"]}}
// Enabling the registry is fail-closed: unlisted accounts and rooms are denied.
let ROOM_ACCESS=null;
if(process.env.ROOM_ACCESS_JSON){
  try{
    const raw=JSON.parse(process.env.ROOM_ACCESS_JSON);
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Object.keys(raw).length)throw Error('Empty/invalid registry');
    const output=Object.create(null);
    for(const [identity,policy] of Object.entries(raw)){
      const principal=identity.trim().toLowerCase();
      if(!/^(google|microsoft):[^\s:@]+@[^\s:@]+\.[^\s:@]+$/.test(principal)||
         !policy||typeof policy!=='object'||Array.isArray(policy)||Object.hasOwn(output,principal))throw Error('Invalid principal');
      const filtered={};
      for(const field of ['calendars','itRooms']){
        const values=policy[field]||[];
        if(!Array.isArray(values)||values.length>100||values.some(x=>typeof x!=='string'||!x.trim()||x!==x.trim()||x.length>256)||new Set(values).size!==values.length)throw Error('Invalid '+field);
        filtered[field]=values;
      }
      if(!filtered.calendars.length&&!filtered.itRooms.length)throw Error('Empty policy');
      output[principal]=filtered;
    }
    ROOM_ACCESS=output;
  }catch(e){console.error('Invalid ROOM_ACCESS_JSON:',e.message);process.exit(1);}
}else console.warn('SECURITY WARNING: ROOM_ACCESS_JSON not configured; room/tenant scoping NOT enforced. Configure before multi-company rollout.');
function allowedRoom(account,scope,id){
  // Never grant email-based room access on a Google profile whose email is unverified.
  if(account.provider==='google'&&account.emailVerified!==true)return false;
  if(!ROOM_ACCESS)return true; // Legacy, single-customer compatibility only.
  const identity=account.provider+':'+String(account.email||'').trim().toLowerCase();
  return Boolean(ROOM_ACCESS[identity]?.[scope]?.includes(id));
}
function requireRoomAccess(account,scope,id){
  if(!allowedRoom(account,scope,id))throw Object.assign(new Error('Room access denied'),{status:403,public:true});
}
// Global IT administration is intentionally restricted to recipient settings only.
// Do not use this bypass in /api/events, /api/calendars or /api/it-request.
function requireItConfigAccess(account,roomId){
  if(itConfigAdminsReady&&isItGlobalAdmin(account))return;
  requireRoomAccess(account,'itRooms',roomId);
}
// Per-process throttling protects a single Render instance, not a multi-instance fleet.
// Never accept client-supplied X-Forwarded-For as an identity (spoofable without a trusted proxy boundary).
const requestCounts=new Map();
function rateLimit(req,res,origin,bucket,identity,limit,periodMs){
  const now=Date.now(),key=bucket+':'+identity;
  let state=requestCounts.get(key);
  if(!state||now>=state.reset){
    if(requestCounts.size>=12000){
      for(const [k,v] of requestCounts)if(now>=v.reset)requestCounts.delete(k);
      if(requestCounts.size>=12000)return send(res,429,{error:'Temporarily busy, please retry'},origin),true;
    }
    state={count:0,reset:now+periodMs};requestCounts.set(key,state);
  }
  if(++state.count>limit){
    res.setHeader('Retry-After',String(Math.max(1,Math.ceil((state.reset-now)/1000))));
    send(res,429,{error:'Too many requests. Please try again shortly.'},origin);
    return true;
  }
  return false;
}
let IT_ROOMS={};
try{
  IT_ROOMS=JSON.parse(process.env.IT_ROOM_LABELS_JSON||'{}');
  if(!IT_ROOMS||typeof IT_ROOMS!=='object'||Array.isArray(IT_ROOMS)||
     Object.entries(IT_ROOMS).some(([id,label])=>!id||id.length>120||typeof label!=='string'||!label.trim()||label.length>120))throw Error('Invalid labels');
}catch{console.error('Invalid IT_ROOM_LABELS_JSON');process.exit(1);}
// Per-room helpdesk address, needed for multi-company use. When configured, a missing
// room address is a configuration error, NOT a reason to mail another tenant's IT.
let IT_ROOM_RECIPIENTS=null;
if(process.env.IT_ROOM_RECIPIENTS_JSON){
  try{
    const raw=JSON.parse(process.env.IT_ROOM_RECIPIENTS_JSON), recipients=Object.create(null);
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Object.keys(raw).length)throw Error('Empty recipients');
    for(const [room,address] of Object.entries(raw)){
      if(!Object.hasOwn(IT_ROOMS,room)||typeof address!=='string'||address.length>254||
         !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))throw Error('Invalid recipient for '+room);
      recipients[room]=address;
    }
    IT_ROOM_RECIPIENTS=recipients;
  }catch(e){console.error('Invalid IT_ROOM_RECIPIENTS_JSON:',e.message);process.exit(1);}
}
// Optional, tenant-managed directory names; keep employee details off public GitHub Pages.
let AUTHOR_NAMES={};
try {
  const names=JSON.parse(process.env.AUTHOR_NAMES_JSON||'{}');
  if(!names||typeof names!=='object'||Array.isArray(names))throw Error('Invalid names');
  for(const [email,name] of Object.entries(names)){
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||typeof name!=='string'||
       !name.trim()||name.length>120||/[\r\n@<>]/.test(name))throw Error('Invalid name mapping');
    AUTHOR_NAMES[email.toLowerCase()]=name.trim();
  }
} catch {console.error('Invalid AUTHOR_NAMES_JSON');process.exit(1);}
const itThrottle=new Map(); // Per-process only; production needs shared distributed rate limiting.
const IT_COOLDOWN_MS=60_000;
function send(res,status,obj,origin){
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer'};
  if(origin===front.origin || origin===APP_ORIGIN){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Headers']='Authorization, Content-Type, X-MeeTab-Admin-Code';headers['Access-Control-Allow-Methods']='GET, POST, OPTIONS';headers.Vary='Origin';}
  res.writeHead(status,headers);res.end(JSON.stringify(obj));
}
function redirect(res,url){res.writeHead(302,{'Location':url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'"});res.end();}
async function parseJSON(req){
  if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))
    throw Object.assign(new Error('JSON content type required'),{status:415,public:true});
  const parts=[];let size=0;
  for await(const ch of req){size+=ch.length;if(size>10000)throw Object.assign(new Error('Request body too large'),{status:413,public:true});parts.push(ch);}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8')||'{}');}
  catch{throw Object.assign(new Error('Invalid JSON'),{status:400,public:true});}
}
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
function eventAuthor(account,e){
  // Google shared-room calendar: creator is often the person, organizer is the room.
  // Only render verified provider/directory names; an email is not a full name.
  const sources=account.provider==='google'?[e.creator,e.organizer]:[e.organizer?.emailAddress];
  for(const org of sources){
    if(!org||typeof org!=='object')continue;
    const display=typeof (org.displayName||org.name)==='string'?(org.displayName||org.name).trim():'';
    if(display&&!display.includes('@'))return display;
    const address=String(org.email||org.address||'').trim().toLowerCase();
    if(address&&account.email&&address===account.email.toLowerCase()&&account.name&&!account.name.includes('@'))return account.name;
    if(address&&AUTHOR_NAMES[address])return AUTHOR_NAMES[address];
  }
  return 'სახელი მიუწვდომელია';
}
function normalizedEvent(account,e){
  const author=eventAuthor(account,e);
  if(account.provider==='google')return {id:e.id,title:e.summary||'დაკავებულია',start:e.start?.dateTime||e.start?.date,end:e.end?.dateTime||e.end?.date,author,kind:e.hangoutLink?'Google Meet':'Room Meeting'};
  return {id:e.id,title:e.subject||'დაკავებულია',start:graphDate(e.start),end:graphDate(e.end),author,kind:e.isOnlineMeeting?'Teams Meeting':'Room Meeting'};
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
  return out.filter(x => x.status!=='cancelled' && x.showAs!=='free').map(e=>normalizedEvent(account,e)).filter(e=>e.start&&e.end);
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
  db.accounts[accountId]={provider,name:prof.name||prof.displayName||'',email:prof.email||prof.mail||prof.userPrincipalName||'',emailVerified:provider==='google'?prof.email_verified===true:true,access:t.access_token,refresh:t.refresh_token||old.refresh||'',expires:Date.now()+(t.expires_in||3600)*1000};
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
    // Explicitly enabled on isolated staging only; production defaults to disabled.
    if(process.env.STAGING_PREVIEW_MODE==='1'&&
       (url.pathname==='/preview'||url.pathname.startsWith('/preview/'))){
      return await serveStagingPreview(req,res,url,API_ORIGIN);
    }
    if(url.pathname==='/health')return send(res,200,{ok:true});
    if(parts[0]==='auth'&&providers[parts[1]]&&parts[2]==='start'&&req.method==='GET'){
      if(rateLimit(req,res,origin,'oauth-start',req.socket.remoteAddress||'unknown',30,5*60000))return;
      return startAuth(parts[1],url.searchParams.get('mode')||'web',res);
    }
    if(parts[0]==='auth'&&providers[parts[1]]&&parts[2]==='callback'&&req.method==='GET'){
      if(rateLimit(req,res,origin,'oauth-callback',req.socket.remoteAddress||'unknown',35,5*60000))return;
      return await callback(parts[1],url,res);
    }
    if(url.pathname==='/auth/exchange'&&req.method==='POST'){
      if(origin!==front.origin && origin!==APP_ORIGIN)return send(res,403,{error:'Invalid origin'},origin);
      if(rateLimit(req,res,origin,'oauth-exchange',req.socket.remoteAddress||'unknown',30,5*60000))return;
      const b=await parseJSON(req),v=tickets.get(b.ticket);tickets.delete(b.ticket);
      if(!v||v.expires<Date.now())return send(res,401,{error:'Link expired. Sign in again.'},origin);
      return send(res,200,{session:v.session,expiresIn:SESSION_TTL/1000},origin);
    }
    if(origin&&origin!==front.origin&&origin!==APP_ORIGIN)return send(res,403,{error:'Invalid origin'},origin);
    if(parts[0]!=='api')return send(res,404,{error:'Not found'},origin);
    const {account,hash}=authenticate(req);
    if(url.pathname==='/api/me'&&req.method==='GET')return send(res,200,{provider:account.provider,name:account.name,email:account.email},origin);
    if(url.pathname==='/api/events'&&req.method==='GET'&&rateLimit(req,res,origin,'calendar-read',hash,100,60000))return;
    if(url.pathname==='/api/events'&&req.method==='POST'&&rateLimit(req,res,origin,'calendar-write',hash,12,60000))return;
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
      if(ROOM_ACCESS)names=names.filter(x=>allowedRoom(account,'calendars',x.id));
      return send(res,200,{calendars:names},origin);
    }
    if(url.pathname==='/api/it-config'&&req.method==='GET'){
      const roomId=url.searchParams.get('roomId');
      if(!validItRoom(roomId))return send(res,400,{error:'Unknown room'},origin);
      requireItConfigAccess(account,roomId);
      return send(res,200,{roomId,recipient:await configuredItRecipient(roomId),canEdit:itConfigAdminsReady&&isItConfigAdmin(account)},origin);
    }
    if(url.pathname==='/api/it-config'&&req.method==='POST'){
      if(rateLimit(req,res,origin,'it-admin-save',hash,5,10*60000))return;
      if(!itConfigAdminsReady)return send(res,503,{error:'Admin configuration or database unavailable'},origin);
      if(!isItConfigAdmin(account))return send(res,403,{error:'Admin account required'},origin);
      if(!correctAdminToken(req.headers['x-meetab-admin-code']))return send(res,403,{error:'Invalid administrator code'},origin);
      const body=await parseJSON(req);
      if(!validItRoom(body?.roomId))return send(res,400,{error:'Unknown room'},origin);
      requireItConfigAccess(account,body.roomId);
      if(!validItEmail(body?.recipient))return send(res,400,{error:'Invalid IT email address'},origin);
      const email=body.recipient.toLowerCase();
      try { await itStore.set(body.roomId,email); }
      catch(e){console.error('IT recipient database write failed:',e.message);return send(res,503,{error:'Unable to save recipient'},origin);}
      console.info('IT recipient updated',JSON.stringify({roomId:body.roomId,adminHash:digest(itAdminIdentity(account)).slice(0,16)}));
      return send(res,200,{roomId:body.roomId,recipient:email,saved:true},origin);
    }
    if(url.pathname==='/api/it-request'&&req.method==='POST'){
      if(!IT_WEBHOOK_URL)return send(res,503,{error:'IT notifications are not configured'},origin);
      let b;try{b=await parseJSON(req);}catch{return send(res,400,{error:'Invalid request body'},origin);}
      if(!validItRoom(b?.roomId))return send(res,400,{error:'Unknown room'},origin);
      requireRoomAccess(account,'itRooms',b.roomId);
      const recipient=await configuredItRecipient(b.roomId);
      if(!recipient)return send(res,503,{error:'Room IT recipient not configured'},origin);
      const key=hash+':'+b.roomId,now=Date.now();
      if((itThrottle.get(key)||0)>now)return send(res,429,{error:'Please wait before submitting again'},origin);
      itThrottle.set(key,now+IT_COOLDOWN_MS);
      try{
        const target=new URL(IT_WEBHOOK_URL);
        if(target.protocol!=='https:')return send(res,503,{error:'IT webhook must use HTTPS'},origin);
        const alert={roomId:b.roomId,roomName:IT_ROOMS[b.roomId],to:recipient,at:new Date().toISOString(),type:'meeting-room-it-help'};
        const webhookHeaders={'Content-Type':'application/json'};
        if(IT_WEBHOOK_TOKEN)webhookHeaders.Authorization='Bearer '+IT_WEBHOOK_TOKEN;
        const result=await fetch(target,{method:'POST',headers:webhookHeaders,body:JSON.stringify(alert),redirect:'error',signal:AbortSignal.timeout(10000)});
        if(!result.ok)throw Error('IT webhook failed');
        return send(res,202,{accepted:true},origin); // Webhook accepted; email delivery itself is not confirmed.
      }catch{itThrottle.delete(key);return send(res,502,{error:'IT notification provider unavailable'},origin);}
    }
    if(url.pathname==='/api/events'&&req.method==='GET'){
      const id=url.searchParams.get('calendarId'),from=url.searchParams.get('from'),to=url.searchParams.get('to');
      if(!from||!to||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(to)-Date.parse(from)>15*864e5||Date.parse(to)<=Date.parse(from))return send(res,400,{error:'Invalid calendar date range'},origin);
      requireRoomAccess(account,'calendars',id);
      return send(res,200,{events:await listEvents(account,id,from,to)},origin);
    }
    if(url.pathname==='/api/events'&&req.method==='POST'){
      const x=await parseJSON(req);
      if(!x||typeof x!=='object'||Array.isArray(x))return send(res,400,{error:'Invalid booking'},origin);
      const s=Date.parse(x.start),e=Date.parse(x.end);
      if(!x.calendarId||typeof x.calendarId!=='string'||!Number.isFinite(s)||!Number.isFinite(e)||s<Date.now()-2*60000||e<=s||e-s>8*3600000||typeof x.title!=='string'||x.title.length>100)return send(res,400,{error:'Invalid booking'},origin);
      requireRoomAccess(account,'calendars',x.calendarId);
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
  }catch(e){
    const status=e.status>=400&&e.status<500?e.status:502;
    // Avoid leaking Google/Microsoft error descriptions, tokens, or database diagnostics to users.
    console.error('Request:',url.pathname,status,e.code||e.name||'error');
    return send(res,status,{error:e.public?e.message:status===401?'Please sign in again':status===403?'Access denied':status===502?'Upstream service unavailable':'Invalid request'},origin);
  }
}
const server=http.createServer(handler);server.listen(PORT,()=>console.log(`MeeTab API listening on ${PORT}`));
setInterval(()=>{const now=Date.now();for(const [k,v] of pending)if(v.expires<now)pending.delete(k);for(const [k,v] of tickets)if(v.expires<now)tickets.delete(k);for(const [k,v] of itThrottle)if(v<now)itThrottle.delete(k);for(const [k,v] of requestCounts)if(v.reset<=now)requestCounts.delete(k);},60000).unref();
