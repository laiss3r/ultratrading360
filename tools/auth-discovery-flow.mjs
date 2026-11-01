// Synthetic only: STUB_DEMO_ONLY=1 STUB_CLASSIC_NO_BALANCES=1.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/user/pwtest/node_modules/playwright/index.mjs');
const base=process.env.BASE||'http://localhost:3000';const browser=await chromium.launch();let checks=0;
const check=(ok,name)=>{if(!ok)throw new Error(name);console.log(`PASS ${++checks}: ${name}`);};
try{
 const context=await browser.newContext({viewport:{width:360,height:844},isMobile:true});const page=await context.newPage();
 await context.addInitScript(()=>{window.__demoFlash=false;new MutationObserver(()=>{if(document.querySelector('button[aria-haspopup="menu"]')?.getAttribute('aria-label')?.includes(', Demo,'))window.__demoFlash=true;}).observe(document,{subtree:true,childList:true,attributes:true});});
 await page.route('**/api/deriv/oauth/callback',async route=>{const response=await page.request.post(base+'/api/deriv/token',{data:{token:'synthetic-only-token'}});await route.fulfill({response});});
 await page.goto(base+'/callback?code=synthetic-code&state=synthetic-state');await page.waitForURL(base+'/');
 await page.waitForFunction(()=>document.querySelector('button[aria-haspopup="menu"]')?.getAttribute('aria-label')?.includes('CR1234567'));
 check(true,'Demo-only first response completes classic Real discovery before workspace navigation');
 check(!(await page.evaluate(()=>window.__demoFlash)),'no provisional Demo account is flashed before the discovered Real');
 const cookie=await page.request.get(base+'/api/deriv/session');check((await cookie.json()).session.loginid==='CR1234567','discovered Real is also the committed server identity');
 await page.route('**/api/deriv/handoff',route=>route.fulfill({status:401,json:{ok:false}}));
 await page.goto(base+'/callback?code=synthetic-second&state=synthetic-second');
 await page.getByRole('alert').filter({hasText:'Deriv did not return a Real account'}).waitFor();
 check(new URL(page.url()).pathname==='/callback','no Real returned: login does not silently land in Demo');
 check(await page.locator('button[aria-haspopup="menu"]').count()===0,'no false Real or provisional Demo header on missing-Real response');
 await page.getByRole('link',{name:'Use the returned Demo account',exact:true}).click();await page.waitForURL(base+'/');
 await page.waitForFunction(()=>document.querySelector('button[aria-haspopup="menu"]')?.getAttribute('aria-label')?.includes('DOT90004580'));
 check(true,'Demo is available only by an explicit choice after missing-Real authorization');
 const chosen=await (await page.request.get(base+'/api/deriv/session')).json();check(chosen.preferReal===false,'explicit Demo continuation clears automatic Real preference in the cookie');
 console.log(`PASS ${checks} synthetic discovery/no-silent-Demo checks. No live consent or orders.`);
}finally{await browser.close();}
