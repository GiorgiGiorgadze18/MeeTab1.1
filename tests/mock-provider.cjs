// Local-only fake provider responses. Never used in production.
const nativeFetch=global.fetch;
global.fetch=async (url, opts={})=>{
 const addr=String(url);
 if(addr.startsWith('https://oauth2.googleapis.com/token'))return new Response(JSON.stringify({access_token:'test-local-access',refresh_token:'test-local-refresh',expires_in:3600}),{status:200});
 if(addr.startsWith('https://openidconnect.googleapis.com/v1/userinfo'))return new Response(JSON.stringify({sub:'test-user',name:'Test Fullname',email:'test@example.test'}),{status:200});
 if(addr.startsWith('https://www.googleapis.com/calendar/v3/users/me/calendarList'))return new Response(JSON.stringify({items:[{id:'test-room',summary:'Test Room',accessRole:'owner'}]}),{status:200});
 if(addr.startsWith('https://www.googleapis.com/calendar/v3/calendars/')&&(!opts.method||opts.method==='GET')){
  const now=Date.now();const d=x=>new Date(now+x).toISOString();
  return new Response(JSON.stringify({items:[
   {id:'own',summary:'Own event',start:{dateTime:d(120000)},end:{dateTime:d(720000)},organizer:{email:'test@example.test'}},
   {id:'named',summary:'Named event',start:{dateTime:d(900000)},end:{dateTime:d(1500000)},organizer:{displayName:'Bob Doe',email:'bob@example.test'}},
   {id:'unnamed',summary:'Unnamed event',start:{dateTime:d(1800000)},end:{dateTime:d(2400000)},organizer:{email:'anonymous@example.test'}}
  ]}),{status:200});
 }
 if(addr==='https://test-hook.example.test/notify')return new Response('{}',{status:200});
 return nativeFetch(url,opts);
};
