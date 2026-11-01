// Fixture authentication only; market data below uses the genuine public Deriv socket.
const {chromium}=await import('/home/user/pwtest/node_modules/playwright/index.mjs');
const browser=await chromium.launch();let checks=0;
const check=(ok,text)=>{if(!ok)throw new Error(text);console.log(`PASS ${++checks}: ${text}`);};
try{
const c=await browser.newContext({viewport:{width:360,height:844}});const page=await c.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await c.request.post('http://localhost:3002/api/deriv/token',{data:{token:'synthetic-only-token'}});
await page.goto('http://localhost:3002/overlord');await page.getByRole('button',{name:'Find market',exact:true}).waitFor({timeout:20000});
await page.getByRole('button',{name:'Find market',exact:true}).click();await page.locator('.scan-market-card').first().waitFor();
await page.waitForFunction(()=>[...document.querySelectorAll('.scan-market-card small')].some(el=>/Quote \d/.test(el.textContent)),{},{timeout:45000});
check(true,'Genuine public broker ticks reach live scanner cards');
check(await page.locator('.scan-market-card').count()>1,'Markets watched in parallel');
check(await page.locator('.scan-market-card button:not(:disabled)').count()===0,'Unqualified markets cannot be selected as a signal');
check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'360px mobile viewport has no page overflow');
await page.screenshot({path:'/home/user/scanner-mobile.png',fullPage:true});
await page.getByRole('button',{name:'Stop scan',exact:true}).click();check(await page.locator('.scan-market-card').count()===0,'Stop immediately discards all market rows');
check(errors.length===0,'No browser runtime errors');await c.close();
console.log(`PASS ${checks} checks; fixture identity, genuine read-only public ticks; no trades.`);
}finally{await browser.close();}
