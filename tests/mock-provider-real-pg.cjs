'use strict';
// Reuse only fake provider HTTP, restoring the real PostgreSQL driver immediately.
const Module=require('node:module'),load=Module._load;
require('./mock-provider.cjs');Module._load=load;
const mockFetch=global.fetch,usedRefresh=new Set();
global.fetch=async(url,options={})=>{
  if(String(url).startsWith('https://oauth2.googleapis.com/token')){
    const body=new URLSearchParams(options.body);
    if(body.get('grant_type')==='refresh_token'){
      const refresh=body.get('refresh_token');
      if(usedRefresh.has(refresh))return new Response(JSON.stringify({error:'invalid_grant'}),{status:400});
      usedRefresh.add(refresh);
      return new Response(JSON.stringify({access_token:'test-refreshed-access',refresh_token:'test-rotated-refresh',expires_in:3600}),{status:200});
    }
    if(body.get('code')==='expired-login')return new Response(JSON.stringify({access_token:'test-local-access',refresh_token:'test-local-refresh',expires_in:-1}),{status:200});
  }
  return mockFetch(url,options);
};
