// Synthetic transport ONLY: run the test broker with STUB_EMPTY=1, STUB_MIGRATION=pending.
// The isolated server uses tools/auth-transport-hook.cjs; never deploy that hook.
import {createCipheriv,randomBytes,scryptSync} from 'node:crypto';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/user/pwtest/node_modules/playwright/index.mjs');
const base=process.env.BASE||'http://localhost:3002';const browser=await chromium.launch();let checks=0;
const check=(ok,label)=>{if(!ok)throw new Error(label);console.log(`PASS ${++checks}: ${label}`);};
function encrypt(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',scryptSync('synthetic-local-validation-key-only','ultratrading360-session',32),iv);const bytes=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return [iv,cipher.getAuthTag(),bytes].map(b=>b.toString('base64url')).join('.');}
try{
 for(const width of [320,360,390,1280]){
  const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();let handoffs=0;
  page.on('request',r=>{if(r.url().includes('/api/deriv/handoff'))handoffs++;});
  const started=await context.request.get(base+'/api/deriv/oauth/start',{maxRedirects:0});
  const location=(await started.json()).authorizeUrl;check(Boolean(location),`${width}: server generated OAuth redirect and state`);
  const state=new URL(location).searchParams.get('state');const start=Date.now();
  await page.goto(base+`/callback?code=synthetic-browser-code&state=${encodeURIComponent(state)}`);
  await page.getByRole('heading',{name:'Signed in to Deriv',exact:true}).waitFor();
  check(Date.now()-start<5000,`${width}: complete server callback reports pending migration without legacy wait`);
  check(!new URL(page.url()).search,`${width}: callback clears single-use code and state even when no trading account exists`);
  const snapshot=await (await context.request.get(base+'/api/deriv/session')).json();
  check(snapshot.authenticated&&snapshot.session.loginid===''&&snapshot.session.balanceKnown===false&&snapshot.session.accountDiagnostics.migration==='pending',`${width}: encrypted cookie retains credential-only state and broker migration result`);
  check(!JSON.stringify(snapshot).includes('synthetic-browser-check-only'),`${width}: server snapshot never exposes bearer`);
  await page.getByRole('link',{name:'View account connection',exact:true}).click();await page.waitForURL(base+'/connect');
  await page.getByText('No account selected',{exact:true}).first().waitFor();
  check(await page.getByText('Demo account',{exact:true}).count()===0,`${width}: no false Demo label`);
  const trigger=page.getByRole('button',{name:'Deriv connected: no trading account selected',exact:true});await trigger.click();
  check(await page.getByRole('menuitemradio').count()===0,`${width}: no fabricated account row`);
  check(!(await trigger.innerText()).includes('0.00'),`${width}: no invented zero balance`);
  await page.getByRole('button',{name:'Close accounts',exact:true}).click();
  const refresh=page.getByRole('button',{name:'Refresh accounts',exact:true});await refresh.click();
  await page.waitForFunction(()=>!document.querySelector('button[aria-busy="true"]'));
  check(handoffs===0,`${width}: login and manual refresh issue no legacy token handoff`);
  check(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth+1),`${width}: connection details fit viewport`);
  await page.goto(base+'/risk');const switches=page.getByRole('switch');
  check(await switches.count()>=2&&await switches.nth(0).isDisabled()&&await switches.nth(1).isDisabled(),`${width}: empty account cannot enable execution or Real acknowledgement`);
  await context.close();
 }
 // A real account with an actual ZERO is distinct from the empty-account placeholder.
 const context=await browser.newContext({viewport:{width:360,height:844}});
 await context.addCookies([{name:'ut_session',value:encrypt({kind:'oauth',loginid:'ROT_FIXTURE',currency:'USD',balance:0,balanceKnown:true,isVirtual:false,scopes:['trade'],expiresAt:Date.now()+3600000,accessToken:'synthetic-browser-check-only',accountRows:[{account_loginid:'ROT_FIXTURE',currency:'USD',balance:0,is_virtual:0}]}),url:base,httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();await page.goto(base+'/connect');await page.getByRole('button',{name:/^Account: ROT_FIXTURE, Real/}).waitFor();
 check((await page.getByRole('button',{name:/^Account: ROT_FIXTURE, Real/}).innerText()).includes('0.00'), '360: genuine returned zero remains visible for Real');
 await context.close();console.log(`PASS ${checks} synthetic callback/cookie/mobile checks. No real consent, private accounts or orders tested.`);
}finally{await browser.close();}
