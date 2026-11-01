// Synthetic regression. REST/WS fixtures ONLY, STUB_HISTORY_DELAY_MS=10000.
// OAuth frontend response is backed by the real PAT session API fixture; the
// OAuth code-exchange/server-state logic is tested separately in route.test.ts.
// No interactive Deriv consent or live credentials/orders are exercised here.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/user/pwtest/node_modules/playwright/index.mjs');
const base=process.env.BASE||'http://localhost:3000';
const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:360,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();
let checks=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
const check=(ok,name)=>{if(!ok)throw new Error(name);console.log(`PASS ${++checks}: ${name}`);};
const active=async(id)=>page.waitForFunction(id=>document.querySelector('button[aria-haspopup="menu"]')?.getAttribute('aria-label')?.includes(id),id,{timeout:5000});
const trigger=()=>page.locator('button[aria-haspopup="menu"]');
const select=async(id)=>{await trigger().click();await page.getByRole('menuitemradio').filter({hasText:id}).click();await active(id);await page.getByRole('menu').waitFor({state:'hidden'});};
try{
 await context.addInitScript(()=>localStorage.setItem('ut_pref_loginid','DOT90004580'));
 let r=await page.request.post(base+'/api/deriv/token',{data:{token:'synthetic-only-token'}});check(r.ok(),'fixture authentication');
 await page.request.post(base+'/api/deriv/session/select',{data:{loginid:'DOT90004580'}});
 let responseAt=0;let reads=0;
 page.on('request',req=>{if(req.method()==='GET'&&/\/api\/deriv\/(session|accounts)(\?|$)/.test(req.url()))reads++;});
 await page.route('**/api/deriv/oauth/callback',async route=>{
  const login=await page.request.post(base+'/api/deriv/token',{data:{token:'synthetic-only-token'}});
  responseAt=Date.now();await route.fulfill({response:login});
 });
 await page.goto(base+'/callback?code=synthetic-code&state=synthetic-state');await page.waitForURL(base+'/');await active('ROT90004581');
 const latency=Date.now()-responseAt;
 check(latency<1500,`Real workspace visible ${latency}ms after authenticated response, despite 10s market history`);
 check(reads===0,'no duplicate session/account GETs in successful callback');
 check(!(await page.locator('body').innerText()).includes('Connecting your account'),'no blocking connection/loading panel after auth');
 await trigger().click();check(await page.getByRole('menuitemradio').count()===2,'dropdown immediately has genuine Real and Demo rows');
 check(await page.getByRole('menuitemradio').filter({hasText:'DOT90004580'}).isEnabled(),'dropdown usable while market history is still loading');await trigger().click();
 const accounts=await page.request.get(base+'/api/deriv/accounts');check(!accounts.headers()['set-cookie'],'account GET cannot overwrite identity cookie');
 const refreshed=await page.request.get(base+'/api/deriv/session?refresh=1');check(!refreshed.headers()['set-cookie'],'session GET cannot overwrite identity cookie');
 await select('DOT90004580');check(true,'explicit Demo switch works without waiting for charts/socket');
 let release;const gate=new Promise(resolve=>{release=resolve;});let capturedResolve;const captured=new Promise(resolve=>{capturedResolve=resolve;});
 await page.route('**/api/deriv/session?refresh=1',async route=>{const old=await route.fetch();capturedResolve();await gate;await route.fulfill({response:old});});
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await captured;
 await select('ROT90004581');release();await page.waitForTimeout(400);
 check((await trigger().getAttribute('aria-label')).includes('ROT90004581'),'delayed old Demo refresh cannot change the new Real selection');
 r=await page.request.get(base+'/api/deriv/session');check((await r.json()).session.loginid==='ROT90004581','cookie also remains Real after stale response');
 await page.unroute('**/api/deriv/session?refresh=1');await page.reload();await active('ROT90004581');check(true,'Real survives full authenticated reload');
 await select('DOT90004580');await page.reload();await active('DOT90004580');check(true,'explicit Demo choice survives reload');
 await page.goto(base+'/callback?code=synthetic-new-code&state=synthetic-new-state');await page.waitForURL(base+'/');await active('ROT90004581');check(true,'new login resets previous Demo choice to genuine Real');
 await select('DOT90004580');await page.unroute('**/api/deriv/oauth/callback');
 await page.route('**/api/deriv/oauth/callback',route=>route.fulfill({status:400,json:{ok:false,error:'state_expired',message:'Synthetic authorization rejection'}}));
 await page.goto(base+'/callback?code=synthetic-invalid&state=synthetic-unrelated');await page.getByRole('alert').filter({hasText:'Synthetic authorization rejection'}).waitFor();
 check(new URL(page.url()).pathname==='/callback','failed new OAuth cannot silently land on an old Demo session');
 check(await trigger().count()===0,'provisional/old Demo is not flashed in callback header');
 check(errors.length===0,`no uncaught browser errors: ${errors.join('; ')}`);
 console.log(`PASS ${checks} synthetic auth/race checks. No live authorization or orders.`);
}finally{await browser.close();}
