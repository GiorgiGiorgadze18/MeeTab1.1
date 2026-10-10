'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const site=fs.readFileSync(path.join(root,'website/site-config.js'),'utf8');
const auth=fs.readFileSync(path.join(root,'website/auth.js'),'utf8');
const html=fs.readFileSync(path.join(root,'website/index.html'),'utf8');
const selection=html.slice(html.indexOf('const SITE = window.MEETAB_SITE;'),html.indexOf('/* ===== მონაცემები'));

(async()=>{
  for(const room of ['', 'guliskari', 'gulisqari', 'room2', 'unknown-room', '__proto__', 'constructor']){
    const window={MEETAB_API_BASE:'https://api.example.test'},reads=[],calls=[],nodes=new Map();
    const node=()=>({value:'',style:{},classList:{add(){},remove(){}},addEventListener(){},replaceChildren(){},append(){}});
    const element=key=>{if(!nodes.has(key))nodes.set(key,node());return nodes.get(key);};
    const context={window,URLSearchParams,location:{search:room?'?room='+room:'',hostname:'ui.example.test'},
      document:{querySelector:element,createElement:node},
      sessionStorage:{getItem(){return 'mock-session';},setItem(){},removeItem(){}},
      localStorage:{getItem(key){reads.push(key);return 'saved-calendar';},setItem(){}},
      fetch:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>
        url.endsWith('/api/me')?{provider:'google',name:'Test User'}:
        url.endsWith('/api/calendars')?{calendars:[]}:{recipient:'it@example.test',canEdit:false}};}};
    vm.createContext(context);vm.runInContext(site,context);
    const resolved=window.MeeTabRoom(room);
    const knownDefault=['','guliskari','gulisqari'].includes(room);
    const expected=knownDefault?'gulisqari':room;
    assert.equal(resolved.id,expected,'Keep stored identities; unknown keys must not inherit default room access');
    assert.equal(resolved.key,knownDefault?'guliskari':room);
    if(knownDefault)assert.equal(resolved.room.name,'გულისკარი');
    vm.runInContext(selection+'\nthis.selectedId=ROOM_ID;this.selectedName=ROOM.name;',context);
    assert.equal(context.selectedId,expected,'Calendar UI and authentication must resolve the same room');
    vm.runInContext(auth,context);await window.MeeTabAuth.init();
    assert.deepEqual(reads,['meetab_calendar_google_'+expected],'Preserve already saved calendar selection');
    assert.equal(window.MeeTabAuth.calendar(),'saved-calendar');
    await window.MeeTabAuth.getITConfig(context.selectedId);
    assert.equal(new URL(calls.at(-1).url).searchParams.get('roomId'),expected);
    await window.MeeTabAuth.requestIT(context.selectedId);
    assert.equal(JSON.parse(calls.at(-1).options.body).roomId,expected);
  }
  console.log('ROOM_IDENTITY=PASS: corrected/legacy/default links, saved calendar and IT identity, other/unknown/prototype keys');
})().catch(e=>{console.error('ROOM_IDENTITY=FAIL',e.message);process.exitCode=1;});
