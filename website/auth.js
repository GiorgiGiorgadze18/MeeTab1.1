/* MeeTab profile + room-calendar selector. No OAuth credentials or provider tokens in public HTML. */
(function(){
'use strict';
const $=s=>document.querySelector(s), API_BASE=(window.MEETAB_API_BASE||'').replace(/\/$/,'');
const ROOM_KEY=new URLSearchParams(location.search).get('room')||'gulisqari';
let token=sessionStorage.getItem('meetab_session')||'',profile=null,calendarId='',choices=[];
const sessionKey=()=>profile?'meetab_calendar_'+profile.provider+'_'+ROOM_KEY:'';
const notify=()=>{updateUI();if(typeof window.MeeTabAuthUpdated==='function')window.MeeTabAuthUpdated();};
const invalidBase=()=>!/^https:\/\/[\w.-]+(?::\d+)?$/.test(API_BASE);
async function call(path, options={}){
  if(invalidBase())throw Error('ჯერ საჭიროა backend-ის HTTPS მისამართის მითითება app-config.js-ში.');
  const r=await fetch(API_BASE+path,{...options,headers:{'Authorization':token?'Bearer '+token:'','Content-Type':'application/json',...(options.headers||{})},cache:'no-store'});
  const x=await r.json().catch(()=>({}));
  if(!r.ok){if(r.status===401&&path!='/auth/exchange'){token='';profile=null;sessionStorage.removeItem('meetab_session');notify();}throw Error(x.error||'API კავშირი ვერ შედგა ('+r.status+')');}
  return x;
}
async function useTicket(ticket){
  if(!/^[a-zA-Z0-9_-]{30,100}$/.test(ticket))throw Error('ავტორიზაციის ბმული არასწორია');
  const x=await call('/auth/exchange',{method:'POST',body:JSON.stringify({ticket})});
  token=x.session;sessionStorage.setItem('meetab_session',token);
  await restore();
  open();
}
async function restore(){
  if(!token)return notify();
  try{
    profile=await call('/api/me'); calendarId=localStorage.getItem(sessionKey())||'';
    const j=await call('/api/calendars');choices=j.calendars||[];
    // Don't pick a private user's calendar automatically for a public room tablet.
    notify();
  }catch(e){choices=[];notify();$('#authMessage').textContent=e.message;}
}
async function login(provider){
  if(invalidBase()){$('#authMessage').textContent='საჭიროა backend-ის კონფიგურაცია. იხილე README.md';return;}
  const url=API_BASE+'/auth/'+provider+'/start?mode='+(window.MeeTabNative || location.hostname==='appassets.androidplatform.net'?'app':'web');
  // Android wrapper intercepts this URL and opens Chrome (OAuth in WebView is blocked).
  location.assign(url);
}
function options(){
  const sel=$('#calendarList');sel.replaceChildren();const def=document.createElement('option');def.value='';def.textContent='აირჩიე ოთახის კალენდარი';sel.append(def);
  choices.forEach(x=>{const o=document.createElement('option');o.value=x.id;o.textContent=x.name+(x.role&&x.role==='reader'?' (მხოლოდ წაკითხვა)':'');sel.append(o);});
  sel.value=choices.some(x=>x.id===calendarId)?calendarId:'';
  $('#calendarManual').value=sel.value?'':calendarId;
}
function updateUI(){
  const yes=Boolean(profile), name=profile?.name||profile?.email||'';
  $('#profileLabel').textContent=yes?(name.length>19?name.slice(0,18)+'…':name):'პროფილი';
  $('#authIdent').textContent=yes?`${name}\n${profile.email||''} · ${profile.provider==='google'?'Google':'Microsoft'}`:'აირჩიე ანგარიში, რომლის კალენდართანაც გინდა დაკავშირება.';
  $('#authLogin').hidden=yes;$('#authConnected').hidden=!yes;
  $('#chosenCalendar').textContent=calendarId?'კალენდარი: '+(choices.find(x=>x.id===calendarId)?.name||calendarId):'ოთახის კალენდარი ჯერ არჩეული არ არის';
  const author=$('#bookAuthor');if(author)author.textContent=yes?(profile?.name&&!profile.name.includes('@')?profile.name:'სახელი მიუწვდომელია'):'საჭიროა შესვლა';
  if(yes)options();
}
function open(){updateUI();$('#authOverlay').classList.add('on');}
function close(){$('#authOverlay').classList.remove('on');}
function saveCalendar(){
  const id=($('#calendarManual').value.trim()||$('#calendarList').value).trim();
  if(!id){$('#authMessage').textContent='აირჩიე ან ჩაწერე კალენდრის ID.';return;}
  if(id.length>256){$('#authMessage').textContent='ID მეტისმეტად გრძელია';return;}
  calendarId=id;localStorage.setItem(sessionKey(),id);$('#authMessage').textContent='კალენდარი შენახულია. სინქრონიზაცია მიმდინარეობს…';notify();close();
}
async function logout(){
  try{await call('/api/logout',{method:'POST'});}catch{}
  profile=null;token='';calendarId='';choices=[];sessionStorage.removeItem('meetab_session');notify();open();
}
async function init(){
  $('#profileBtn').addEventListener('click',open);
  $('#authDismiss').addEventListener('click',close);
  $('#authOverlay').addEventListener('click',e=>{if(e.target===$('#authOverlay'))close();});
  $('#loginMicrosoft').addEventListener('click',()=>login('microsoft'));
  $('#loginGoogle').addEventListener('click',()=>login('google'));
  $('#saveCalendar').addEventListener('click',saveCalendar);
  $('#disconnect').addEventListener('click',logout);
  $('#calendarList').addEventListener('change',()=>{$('#calendarManual').value='';});
  window.MeeTabReceiveTicket=ticket=>{useTicket(ticket).catch(e=>{open();$('#authMessage').textContent=e.message;});};
  const qs=new URLSearchParams(location.search),ticket=qs.get('ticket');
  if(ticket){qs.delete('ticket');const clean=location.pathname+(qs.size?'?'+qs:'')+location.hash;history.replaceState(null,'',clean);await window.MeeTabReceiveTicket(ticket);}
  else await restore();
}
window.MeeTabAuth={init,open,ready:()=>Boolean(profile&&token&&calendarId),name:()=>profile?.name&&!profile.name.includes('@')?profile.name:'',calendar:()=>calendarId,provider:()=>profile?.provider||'',
  async listEvents(){if(!this.ready())return [];const from=new Date(Date.now()-12*3600000).toISOString(),to=new Date(Date.now()+7*86400000).toISOString();return (await call('/api/events?'+new URLSearchParams({calendarId,from,to}))).events.map(x=>({...x,start:new Date(x.start),end:new Date(x.end)}));},
  async createEvent(ev){if(!this.ready())throw Error('ჯერ შედი პროფილში და აირჩიე ოთახის კალენდარი');return call('/api/events',{method:'POST',body:JSON.stringify({calendarId,title:ev.title,start:new Date(ev.start).toISOString(),end:new Date(ev.end).toISOString(),urgent:ev.urgent})});},
  async requestIT(roomId){if(!profile||!token)throw Error('IT მოთხოვნისთვის ჯერ შედი პროფილში');return call('/api/it-request',{method:'POST',body:JSON.stringify({roomId})});},
  async getITConfig(roomId){if(!profile||!token)throw Error('კონფიგურაციის სანახავად შედი პროფილში');return call('/api/it-config?'+new URLSearchParams({roomId}));},
  async saveITConfig(roomId,recipient,adminCode){
    if(!profile||!token)throw Error('კონფიგურაციის შესაცვლელად შედი პროფილში');
    if(!adminCode)throw Error('შეიყვანეთ ადმინისტრატორის კოდი');
    return call('/api/it-config',{method:'POST',headers:{'X-MeeTab-Admin-Code':adminCode},
      body:JSON.stringify({roomId,recipient})});
  }
};
})();
