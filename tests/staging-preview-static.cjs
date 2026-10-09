'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const {serveStagingPreview}=require('../backend/staging-preview');
const origin='https://staging.example.test';
const srv=http.createServer(async(req,res)=>{
  const url=new URL(req.url,origin);
  if(url.pathname==='/preview'||url.pathname.startsWith('/preview/'))
    return serveStagingPreview(req,res,url,origin);
  res.writeHead(404);res.end();
});
(async()=>{
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+srv.address().port;
  async function check(url,status,expected){
    const r=await fetch(base+url,{redirect:'manual'});
    assert.equal(r.status,status,url);
    assert.equal(r.headers.get('cache-control'),'no-store',url);
    if(expected)assert.match(await r.text(),expected,url);
  }
  await check('/preview',302);
  await check('/preview/',200,/MeeTab/);
  await check('/preview/auth.js',200,/MeeTabAuth/);
  await check('/preview/auth-return.html',200,/auth/);
  await check('/preview/app-config.js',200,/window\.MEETAB_API_BASE = "https:\/\/staging\.example\.test"/);
  await check('/preview/site-config.js',200,/MEETAB_SITE/);
  await check('/preview/assets/icons/settings.svg',200);
  for(const p of ['/preview/server.js','/preview/../backend/server.js',
    '/preview/%2e%2e%2fbackend%2fserver.js','/preview/.env',
    '/preview/%5C%5Cbackend%5Cserver.js','/preview/assets/%2e%2e%2fsite-config.js']){
    const r=await fetch(base+p,{redirect:'manual'});
    assert.notEqual(r.status,200,'should not expose '+p);
  }
  const post=await fetch(base+'/preview/app-config.js',{method:'POST'});
  assert.equal(post.status,405);
  console.log('STAGING_PREVIEW_STATIC=PASS');
})().catch(e=>{console.error('STAGING_PREVIEW_STATIC=FAIL',e.message);process.exitCode=1}).finally(()=>srv.close());
