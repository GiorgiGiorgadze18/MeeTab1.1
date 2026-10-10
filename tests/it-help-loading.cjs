'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../website/index.html'),'utf8');
const start=html.indexOf('async function openITHelp() {');
const end=html.indexOf("$('#bIT').onclick = openITHelp;",start);
assert(start>=0&&end>start,'IT help implementation not found');
const source=html.slice(start,end);

function fixture(){
  const selectors=['#itCurrent','#itHint','#itEdit','#itEditor','#itRecipient','#itAdminCode','#itSave','#md','.mbtns','.mtxt'];
  const nodes=Object.fromEntries(selectors.map(s=>[s,{textContent:'',value:'',hidden:true,isConnected:true,style:{},focus(){}}]));
  let resolve,reject,reads=0;
  const response=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const auth={getITConfig:room=>{assert.equal(room,'test-room');reads++;return response;}};
  const modal=async markup=>{
    nodes['#itCurrent'].textContent=markup.match(/id="itCurrent">([^<]*)/)[1];
  };
  const open=new Function('$','ROOM','ROOM_ID','CONFIG','MeeTabAuth','modal','sendIT',
    source+'\nreturn openITHelp;')(s=>nodes[s],{name:'Test room'},'test-room',
      {itEmail:'legacy@example.test'},auth,modal,()=>{});
  return {nodes,open,resolve,reject,get reads(){return reads;}};
}

(async()=>{
  // Execute the actual UI handler with a deliberately slow server response.
  for(const canEdit of [true,false]){
    const app=fixture(),work=app.open();
    await Promise.resolve();
    assert.equal(app.reads,1);
    assert.equal(app.nodes['#itCurrent'].textContent,'იტვირთება...','Never show an unconfirmed static recipient while loading');
    assert.equal(app.nodes['#itEdit'].hidden,true,'Editing stays hidden until server authorization');
    app.resolve({recipient:'saved@example.test',canEdit});
    await work;
    assert.equal(app.nodes['#itCurrent'].textContent,'saved@example.test');
    assert.equal(app.nodes['#itEdit'].hidden,!canEdit,'Ordinary users cannot open the recipient editor');
  }
  for(const reason of ['Login required','Forbidden room','Network failure']){
    const app=fixture(),work=app.open();
    await Promise.resolve();app.reject(Error(reason));await work;
    assert.equal(app.nodes['#itCurrent'].textContent,'ვერ ჩაიტვირთა','Failed reads must not display the legacy recipient');
    assert.equal(app.nodes['#itEdit'].hidden,true);
    assert.match(app.nodes['#itHint'].textContent,/პროფილში/);
  }
  const empty=fixture(),emptyWork=empty.open();
  await Promise.resolve();empty.resolve({recipient:'',canEdit:false});await emptyWork;
  assert.equal(empty.nodes['#itCurrent'].textContent,'არ არის მითითებული');
  const dismissed=fixture(),dismissedWork=dismissed.open();
  await Promise.resolve();dismissed.nodes['#itCurrent'].isConnected=false;
  dismissed.resolve({recipient:'saved@example.test',canEdit:true});await dismissedWork;
  assert.equal(dismissed.nodes['#itCurrent'].textContent,'იტვირთება...','A removed dialog ignores late responses');
  console.log('IT_HELP_LOADING=PASS: slow read, admin/user permissions, login/forbidden/network failures, missing recipient, removed dialog');
})().catch(e=>{console.error('IT_HELP_LOADING=FAIL',e.message);process.exitCode=1;});
