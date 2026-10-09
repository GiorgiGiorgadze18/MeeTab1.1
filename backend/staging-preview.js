'use strict';
// Staging-only UI files: all APIs and OAuth tokens stay on the backend.
const fs=require('node:fs/promises'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../website');
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg',
  '.jpeg':'image/jpeg','.otf':'font/otf','.woff':'font/woff','.woff2':'font/woff2'};
function response(req,res,status,data,mime='text/plain; charset=utf-8'){
  const bytes=Buffer.isBuffer(data)?data:Buffer.from(data,'utf8');
  res.writeHead(status,{'Content-Type':mime,'Content-Length':String(bytes.length),
    'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
    'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});
  res.end(req.method==='HEAD'?undefined:bytes);
}
async function serveStagingPreview(req,res,url,apiOrigin){
  if(req.method!=='GET'&&req.method!=='HEAD')return response(req,res,405,'Method not allowed');
  if(url.pathname==='/preview'){
    res.writeHead(302,{'Location':'/preview/','Cache-Control':'no-store'});res.end();return;
  }
  let requested;
  try{requested=decodeURIComponent(url.pathname.slice('/preview/'.length))}
  catch{return response(req,res,400,'Invalid path')}
  if(!requested)requested='index.html';
  const parts=requested.split('/');
  if(parts.some(x=>!x||x==='.'||x==='..'||x.startsWith('.')||x.includes('\\')||x.includes('\0')||x.includes(':')))
    return response(req,res,404,'Not found');
  if(!['index.html','auth.js','auth-return.html','site-config.js','app-config.js'].includes(requested)&&
      !(requested.startsWith('assets/')&&parts.length>=2))return response(req,res,404,'Not found');
  if(requested==='app-config.js')
    return response(req,res,200,'window.MEETAB_API_BASE = '+JSON.stringify(apiOrigin)+';\n',MIME['.js']);
  const filename=path.resolve(ROOT,requested);
  if(!filename.startsWith(ROOT+path.sep))return response(req,res,404,'Not found');
  const mime=MIME[path.extname(filename).toLowerCase()];
  if(!mime)return response(req,res,404,'Not found');
  try{
    const stat=await fs.stat(filename);
    if(!stat.isFile()||stat.size>8*1024*1024)return response(req,res,404,'Not found');
    return response(req,res,200,await fs.readFile(filename),mime);
  }catch{return response(req,res,404,'Not found')}
}
module.exports={serveStagingPreview};
