/** Synthetic only: official REST Demo and Real listing; never uses live funds. */
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/user/pwtest/node_modules/playwright/index.mjs');
const base=process.env.BASE||'http://localhost:3000';
const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let checks=0;
const check=(name,ok)=>{assert.ok(ok,name);console.log(`ok ${++checks}: ${name}`);};
const trigger=()=>page.locator('button[aria-haspopup="menu"]');
const active=async(id)=>{await page.waitForFunction((id)=>document.querySelector('button[aria-haspopup="menu"]')?.getAttribute('aria-label')?.includes(id),id,{timeout:20000});};
const login=async()=>{const r=await page.request.post(base+'/api/deriv/token',{data:{token:'synthetic-only-token'}});assert.ok(r.ok());return r.json();};
try{
 await context.addInitScript(()=>localStorage.setItem('ut_pref_loginid','DOT90004580'));
 const initial=await login();check('REST directly returns both accounts and selects Real',initial.accounts.length===2&&!initial.session.isVirtual);
 await page.goto(base+'/risk');await active('ROT90004581');
 check('fresh login automatically chooses returned Real despite old Demo preference',(await trigger().getAttribute('aria-label')).includes('Real, 0.00 USD'));
 check('viewing Real does not enable execution',await page.getByRole('switch',{name:'Allow this browser to place trades'}).getAttribute('aria-checked')==='false');
 await trigger().click();check('both genuine Demo and Real rows remain available',await page.getByRole('menuitemradio',{name:/DOT90004580/}).count()===1&&await page.getByRole('menuitemradio',{name:/ROT90004581/}).count()===1);
 await page.waitForFunction(()=>!document.querySelector('button[aria-busy="true"]'));
 await page.getByRole('menuitemradio',{name:/DOT90004580/}).click();await active('DOT90004580');check('user can explicitly switch to Demo',true);
 await page.reload();await active('DOT90004580');check('explicit Demo choice survives reload',true);
 await trigger().click();await page.getByRole('button',{name:'Refresh accounts'}).click();await page.waitForFunction(()=>!document.querySelector('button[aria-busy="true"]'));
 check('account refresh never overrides explicit Demo choice',(await trigger().getAttribute('aria-label')).includes('DOT90004580'));
 await page.getByRole('menuitemradio',{name:/ROT90004581/}).click();await active('ROT90004581');check('user can switch back to Real',true);
 await page.reload();await active('ROT90004581');check('cookie preserves Real despite stale local Demo preference',true);
 await trigger().click();await page.waitForFunction(()=>!document.querySelector('button[aria-busy="true"]'));await page.getByRole('menuitemradio',{name:/DOT90004580/}).click();await active('DOT90004580');
 await login();await page.reload();await active('ROT90004581');check('a new login starts with Real again, rather than restoring prior-session Demo',true);
 check('mobile layout has no horizontal page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));check('no uncaught browser errors',errors.length===0);
 console.log(`PASS ${checks} SYNTHETIC real-default checks. No live account or order accessed.`);
}catch(e){console.log('Account:',await trigger().getAttribute('aria-label'));throw e;}finally{await browser.close();}
