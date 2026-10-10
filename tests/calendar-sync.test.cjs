'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../website/index.html'),'utf8');
const android=fs.readFileSync(path.join(__dirname,'../android/app/src/main/java/ge/evex/meetab/MainActivity.java'),'utf8');

assert.match(html,/refreshSec:\s*20\b/,'Poll should run every 20 sec while visible');
assert.match(html,/visibilitychange/);
assert.match(html,/window\.MeeTabRefreshCalendar\s*=/);
assert.match(html,/window\.addEventListener\('focus',\s*refreshOnWake\)/);
assert.match(html,/await load\(true\); resetForm\(\); go\('home'\)/,'Booking should force fresh read');
assert.match(android,/onResume\(\)[\s\S]*?MeeTabRefreshCalendar/,'Android resume should refresh');

const start=html.indexOf('let calendarSyncGeneration = 0,');
const end=html.indexOf('/* ===== ნავიგაცია ===== */',start);
assert(start>-1&&end>start,'Could not extract the actual production sync implementation');
const source=html.slice(start,end);

(async()=>{
  let next, draws=0, ticks=0, warnings=0, logged=0;
  const api={list:()=>next()};
  const app=new Function('API','renderCal','tick','toast','console',
    'let events=[];const MIN=60000,rnd=d=>new Date(Math.round(+new Date(d)/MIN)*MIN);\n'+
    source+'\nreturn {load, getEvents:()=>events};'
  )(api,()=>draws++,()=>ticks++,()=>warnings++,{error:()=>logged++});

  const event=(title)=>({title,start:'2026-10-09T15:30:00Z',end:'2026-10-09T15:45:00Z'});
  next=async()=>[event('Existing meeting')];
  await app.load();
  assert.equal(app.getEvents()[0].title,'Existing meeting');
  assert.equal(draws,1);

  // A slow response from before an account/calendar switch must not overwrite new data.
  let resolveOld;
  next=()=>new Promise(r=>{resolveOld=r});
  const slow=app.load();
  const reload=app.load(true);
  next=async()=>[event('Fresh Google meeting')];
  resolveOld([event('Outdated meeting')]);
  await Promise.all([slow,reload]);
  assert.equal(app.getEvents()[0].title,'Fresh Google meeting');
  assert.equal(draws,2);

  // A failed poll should not clear meetings and incorrectly mark the room as free.
  next=async()=>{throw Error('Temporary provider outage')};
  await app.load();
  assert.equal(app.getEvents()[0].title,'Fresh Google meeting');
  assert.equal(draws,2,'Error should not repaint empty calendar');
  assert.equal(logged,1);
  assert.equal(warnings,1);

  next=async()=>[event('Phone booking')];
  await app.load();
  assert.equal(app.getEvents()[0].title,'Phone booking');
  assert.equal(draws,3);
  assert.equal(ticks,3);
  console.log('CALENDAR_SYNC_TEST=PASS: refresh interval, Android resume, stale response, failed poll, recovery');
})().catch(e=>{console.error('CALENDAR_SYNC_TEST=FAIL',e);process.exitCode=1});
