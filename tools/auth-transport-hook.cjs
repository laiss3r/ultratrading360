// TEST PROCESS ONLY. No real broker credentials. Never imported by the app or enabled in production.
const original=globalThis.fetch;
globalThis.fetch=async function(input,init){
 const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
 if(url==='https://auth.deriv.com/oauth2/token')return new Response(JSON.stringify({access_token:'synthetic-browser-check-only',expires_in:3600,token_type:'Bearer'}),{headers:{'content-type':'application/json'}});
 if(url.startsWith('https://api.derivws.com/trading/v1/options/'))return original('http://127.0.0.1:4517'+new URL(url).pathname,init);
 return original(input,init);
};
