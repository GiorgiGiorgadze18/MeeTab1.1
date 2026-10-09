'use strict';
// Read-only/negative remote smoke test for the isolated MeeTab Render staging API.
// No OAuth credentials, secrets, booking writes, or DB mutations.
const assert=require('node:assert/strict');
const host='https://meetab-staging-20261010.onrender.com';
const frontend='https://giorgigiorgadze18.github.io';
async function get(path, options={}){
  const url=host+path;
  let last;
  for(let i=0;i<5;i++){
    try{
      const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000),...options});
      if([502,503,504].includes(response.status)&&i<4){
        await new Promise(r=>setTimeout(r,5000));
        continue;
      }
      return response;
    }catch(e){
      last=e;
      if(i===4)throw e;
      await new Promise(r=>setTimeout(r,5000));
    }
  }
  throw last||new Error('No response');
}
(async()=>{
  let r=await get('/health');
  assert.equal(r.status,200,'Staging backend not healthy');
  assert.equal((await r.json()).ok,true);
  assert.equal(r.headers.get('cache-control'),'no-store');

  const cases=[
    ['profile is private','/api/me',401,{}],
    ['IT recipient is private','/api/it-config?roomId=gulisqari',401,{}],
    ['calendar events are private','/api/events?calendarId=staging-room&from=2026-10-10T00%3A00%3A00Z&to=2026-10-11T00%3A00%3A00Z',401,{}],
    ['untrusted browser Origin rejected','/api/me',403,{Origin:'https://attacker.example.test'}],
    ['trusted browser Origin still needs login','/api/me',401,{Origin:frontend}],
  ];
  for(const [label,path,expected,headers] of cases){
    r=await get(path,{headers});
    assert.equal(r.status,expected,label+' expected '+expected+' got '+r.status);
    assert.equal(r.headers.get('cache-control'),'no-store',label+' cache must be disabled');
    console.log('PASS '+label+': HTTP '+expected);
  }
  r=await get('/api/me',{headers:{Origin:'https://attacker.example.test'}});
  assert.equal(r.headers.get('access-control-allow-origin'),null,'Do not allow attacker CORS');
  r=await get('/api/me',{headers:{Origin:frontend}});
  assert.equal(r.headers.get('access-control-allow-origin'),frontend,'Trusted frontend CORS');
  console.log('STAGING_HTTP_SMOKE=PASS');
})().catch(e=>{console.error('STAGING_HTTP_SMOKE=FAIL',e.message);process.exitCode=1;});
