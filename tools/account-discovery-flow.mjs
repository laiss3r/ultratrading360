/** Synthetic-only regression: non-empty Demo REST list + additional classic Real. */
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.BASE||'http://localhost:3000';
const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let checks=0;
function check(name,ok){assert.ok(ok,name);console.log(`ok ${++checks}: ${name}`);}
const trigger=()=>page.locator('button[aria-haspopup="menu"]');
try{
  // Seed an already signed-in Demo-only cookie, as in the reported screenshot.
  const login=await page.request.post(base+'/api/deriv/token',{data:{token:'synthetic-only-token'}});const result=await login.json();
  check('upstream initially returns one Demo row only',result.accounts.length===1&&result.accounts[0].isVirtual);
  await page.goto(base+'/risk');await trigger().waitFor();await trigger().click();
  await page.getByRole('menuitemradio',{name:/CR1234567/}).waitFor({timeout:20000});
  check('Real is discovered automatically without reconnecting',await page.getByRole('menuitemradio',{name:/CR1234567/}).count()===1);
  check('Options Demo is retained',await page.getByRole('menuitemradio',{name:/DOT90004580/}).count()===1);
  check('Real zero is read from balance, not a missing-amount default',(await page.getByRole('menuitemradio',{name:/CR1234567/}).innerText()).includes('0.00'));
  await page.waitForFunction(()=>!document.querySelector('button[aria-busy="true"]'));
  await page.getByRole('menuitemradio',{name:/CR1234567/}).click();
  await page.waitForFunction(()=>document.querySelector('button[aria-haspopup="menu"]')?.getAttribute('aria-label')?.includes('CR1234567'));
  check('Real is selectable without execution permission',(await trigger().getAttribute('aria-label')).includes('Real, 0.00 USD'));
  const socket=await page.request.post(base+'/api/deriv/socket',{data:{loginid:'CR1234567',allowReal:true}});
  check('display discovery never grants Options trading authority',socket.status()===409);
  await page.locator('.tool-nav').getByRole('link',{name:'Bot Builder',exact:true}).click();await page.waitForURL(base+'/builder');
  check('same selected Real identity survives navigation',(await trigger().getAttribute('aria-label')).includes('CR1234567'));
  await page.reload();await trigger().waitFor();
  check('selected Real identity persists on reload',(await trigger().getAttribute('aria-label')).includes('CR1234567'));
  await trigger().click();await page.getByRole('button',{name:'Refresh accounts'}).click();await page.waitForFunction(()=>!document.querySelector('button[aria-busy="true"]'));
  check('Demo-only REST refresh does not erase the discovered Real row',await page.getByRole('menuitemradio',{name:/CR1234567/}).count()===1);
  check('no mobile horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'/home/user/account-discovery-research/synthetic-discovered-real.png',fullPage:true});
  check('no uncaught browser errors',errors.length===0);
  console.log(`PASS ${checks} synthetic checks; no live account or order accessed.`);
}finally{await browser.close();}
