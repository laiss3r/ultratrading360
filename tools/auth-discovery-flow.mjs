// Synthetic current-API Demo-only regression. Run the isolated server with
// NODE_OPTIONS='--require ./tools/auth-transport-hook.cjs' and broker STUB_DEMO_ONLY=1.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/user/pwtest/node_modules/playwright/index.mjs');
const base=process.env.BASE||'http://localhost:3002';const browser=await chromium.launch();let checks=0;
const check=(ok,name)=>{if(!ok)throw new Error(name);console.log(`PASS ${++checks}: ${name}`);};
try{
 const context=await browser.newContext({viewport:{width:360,height:844},isMobile:true});const page=await context.newPage();let handoffs=0;
 page.on('request',r=>{if(r.url().includes('/api/deriv/handoff'))handoffs++;});
 const start=await (await context.request.get(base+'/api/deriv/oauth/start')).json();const state=new URL(start.authorizeUrl).searchParams.get('state');
 await page.goto(base+`/callback?code=synthetic-code&state=${encodeURIComponent(state)}`);await page.getByRole('heading',{name:'Signed in to Deriv',exact:true}).waitFor();
 check(new URL(page.url()).pathname==='/callback','Demo-only authorization does not silently land in Demo');
 check((await page.locator('.notice').innerText()).includes('1 current Options trading account'),'reports current REST Demo-only result, not an invented classic Real');
 check(handoffs===0,'current OAuth never hands its bearer to classic discovery');
 check(await page.locator('button[aria-haspopup="menu"]').count()===0,'callback has no provisional account header');
 await page.getByRole('link',{name:'Use the returned Demo account',exact:true}).click();await page.waitForURL(base+'/');
 await page.waitForFunction(()=>document.querySelector('button[aria-haspopup="menu"]')?.getAttribute('aria-label')?.includes('DOT90004580'));
 check(true,'returned Demo is available by explicit choice');
 const chosen=await (await context.request.get(base+'/api/deriv/session')).json();check(chosen.preferReal===false,'explicit Demo continuation clears automatic Real preference in cookie');
 await page.getByRole('button',{name:/Account: DOT90004580/}).click();check(await page.getByRole('menuitemradio').count()===1,'historical mappings are not fabricated into live switcher accounts');
 console.log(`PASS ${checks} synthetic current-API Demo-only checks. No live consent, private accounts or orders.`);
}finally{await browser.close();}
