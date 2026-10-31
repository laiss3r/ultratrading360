/** TEST ONLY. Uses tools/derivstub.mjs with STUB_TRADING=1 STUB_DEMO_ONLY=1. */
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.BASE||'http://localhost:3000';
const b=await chromium.launch();const context=await b.newContext({viewport:{width:390,height:844}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let checks=0;const check=(n,ok)=>{assert.ok(ok,n);console.log(`ok ${++checks}: ${n}`);};
try{
 await page.request.post('http://127.0.0.1:4517/__fixture/reset');
 const login=await page.request.post(base+'/api/deriv/token',{data:{token:'synthetic-fixture-only'}});check('synthetic upstream login succeeds',login.ok());
 // Fresh login now prefers Real; this order fixture explicitly opts into Demo.
 const selected=await page.request.post(base+'/api/deriv/session/select',{data:{loginid:'DOT90004580'}});assert.ok(selected.ok());
 await page.goto(base+'/risk');await page.locator('button[aria-haspopup="menu"]').waitFor();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('dd')).some((e)=>e.textContent==='Verified'),undefined,{timeout:20000});
 await page.getByRole('switch',{name:'Allow this browser to place trades'}).click();
 await page.locator('.tool-nav').getByRole('link',{name:'Overlord Pro',exact:true}).click();await page.waitForURL(base+'/overlord');
 await page.getByRole('button',{name:'Find market',exact:true}).click();await page.getByText(/Sample comparison complete/).waitFor({timeout:15000});
 check('finder reports actual fixture measurements, not generated confidence',(await page.locator('table').innerText()).includes('95% interval'));
 check('contrarian ordering selects lower-observed occurrence market',await page.getByRole('combobox',{name:/^Market/}).inputValue()==='R_10');
 await page.getByRole('combobox',{name:/^Duration/}).selectOption('3');await page.getByLabel('Target profit',{exact:true}).fill('1');await page.getByLabel('Stop loss',{exact:true}).fill('10');
 await page.getByRole('switch',{name:'Enable martingale'}).click();await page.getByRole('switch',{name:'Recovery mode — use a second contract'}).click();
 await page.getByRole('button',{name:'Run bot',exact:true}).click();await page.getByRole('dialog').waitFor();
 check('confirmation displays the actual Demo account',(await page.getByRole('dialog').innerText()).includes('DOT90004580'));
 let ledger=await (await page.request.get('http://127.0.0.1:4517/__fixture/trades')).json();check('no buy before explicit confirmation',ledger.length===0);
 await page.getByRole('button',{name:'Confirm & run',exact:true}).click();
 // Wait for actual engine halt, not a cosmetic timeout or a simulated UI result.
 await page.waitForFunction(()=>document.body.textContent.includes('Session profit target reached'),undefined,{timeout:20000});
 ledger=await (await page.request.get('http://127.0.0.1:4517/__fixture/trades')).json();
 check('exactly three genuine application buy requests reach the synthetic upstream',ledger.length===3);
 check('recovery changes the executed contract only after settled losses',JSON.stringify(ledger.map((t)=>t.contract_type))===JSON.stringify(['DIGITEVEN','DIGITOVER','DIGITOVER']));
 check('martingale stakes follow settled loss sequence',JSON.stringify(ledger.map((t)=>t.amount))===JSON.stringify([1,2.1,4.41]));
 check('chosen duration is retained through proposal verification and buy',ledger.every((t)=>t.duration===3&&t.currency==='USD'));
 await page.waitForTimeout(900);const final=await (await page.request.get('http://127.0.0.1:4517/__fixture/trades')).json();check('profit target prevents all subsequent entries',final.length===3);
 await page.locator('.tool-nav').getByRole('link',{name:'Trade History',exact:true}).click();await page.waitForURL(base+'/history');
 check('settled broker fixture records appear in the genuine ledger',(await page.locator('table').innerText()).includes('DIGITOVER'));
 check('mobile layout has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 check('no uncaught browser errors',errors.length===0);
 console.log(`PASS ${checks} SYNTHETIC trading workflow checks. No live funds or live orders used.`);
}catch(e){console.log('Dialog errors:',await page.getByRole('alert').allTextContents());console.log('Session:',await page.locator('.session-controls').allTextContents());throw e;}finally{await b.close();}
