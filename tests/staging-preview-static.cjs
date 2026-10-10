'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
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
  // Serve the exact bundled fonts so staging keeps the tablet typography.
  for(const weight of ['Light','Regular','Medium','Bold']){
    const filename='PingGeL-'+weight+'.otf';
    const r=await fetch(base+'/preview/fonts/'+filename);
    assert.equal(r.status,200,filename);
    assert.equal(r.headers.get('content-type'),'font/otf',filename);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()),
      await fs.readFile(path.join(__dirname,'../website/fonts',filename)),filename);
  }
  for(const p of ['/preview/server.js','/preview/../backend/server.js',
    '/preview/%2e%2e%2fbackend%2fserver.js','/preview/.env',
    '/preview/%5C%5Cbackend%5Cserver.js','/preview/assets/%2e%2e%2fsite-config.js',
    '/preview/fonts/%2e%2e%2fsite-config.js','/preview/fonts/.env']){
    const r=await fetch(base+p,{redirect:'manual'});
    assert.notEqual(r.status,200,'should not expose '+p);
  }
  const post=await fetch(base+'/preview/app-config.js',{method:'POST'});
  assert.equal(post.status,405);
  console.log('STAGING_PREVIEW_STATIC=PASS');
})().catch(e=>{console.error('STAGING_PREVIEW_STATIC=FAIL',e.message);process.exitCode=1}).finally(()=>srv.close());
