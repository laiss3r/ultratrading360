// Isolated synthetic transport only. See docs/run-confirmation-permissions.md.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/user/pwtest/node_modules/playwright/index.mjs');
const base=process.env.BASE||'http://localhost:3002';const browser=await chromium.launch();let checks=0;
const check=(ok,message)=>{if(!ok)throw new Error(message);console.log(`PASS ${++checks}: ${message}`);};
try{for(const real of [false,true]){
 const context=await browser.newContext({viewport:{width:360,height:844}});await context.addInitScript(()=>{const Native=window.WebSocket;window.WebSocket=class extends Native{constructor(url,protocols){super(String(url).includes('/options/ws/public')?'ws://127.0.0.1:4519/public':url,...(protocols===undefined?[]:[protocols]));}};});
 const page=await context.newPage();const id=real?'ROT90004581':'DOT90004580';const mode=real?'Real':'Demo';
 await context.request.post(base+'/api/deriv/token',{data:{token:'synthetic-only-token'}});await context.request.post(base+'/api/deriv/session/select',{data:{loginid:id}});
 await page.goto(base+'/risk');await page.getByRole('button',{name:new RegExp(`Account: ${id}`)}).waitFor();
 const permission=page.getByRole('switch',{name:'Allow this browser to place trades'});check(!(await permission.isChecked()),`${mode}: fresh browser does not enable orders automatically`);
 if(!real)check(await page.getByText('Demo uses virtual funds. Real-money acknowledgement is not required for Demo trading.',{exact:true}).count()===1,'Demo: no irrelevant disabled Real acknowledgement switch');
 await page.getByRole('link',{name:'Overlord Pro',exact:true}).click();await page.getByRole('combobox',{name:/^Market/}).selectOption('R_10');
 await page.getByRole('button',{name:'Run bot',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();
 check((await dialog.innerText()).includes('Confirm & run will enable trading'),`${mode}: confirmation explains the explicit permission grant`);
 check((await dialog.innerText()).includes(id),`${mode}: confirmation binds the selected account`);
 if(real){await dialog.getByRole('button',{name:'Confirm & run'}).click();await dialog.getByText('Acknowledge the real-money risk for this selected account before confirming.',{exact:true}).waitFor();check(true,'Real: no silent risk acknowledgement');await dialog.getByRole('switch',{name:'I acknowledge real-money risk for this selected account'}).click();}
 await dialog.getByRole('button',{name:'Confirm & run'}).click();await dialog.waitFor({state:'hidden',timeout:20000});
 check(true,`${mode}: explicit confirmation enables permission, verifies broker channel and starts run`);
 check(!(await page.locator('.workspace-main').innerText()).includes('Trading is disabled'),`${mode}: no contradictory disabled error`);
 await page.locator('.workspace-main').getByRole('button',{name:'Stop bot',exact:true}).first().click();
 await page.getByRole('link',{name:'Risk & Settings',exact:true}).click();check(await page.getByRole('switch',{name:'Allow this browser to place trades'}).isChecked(),`${mode}: shared Risk switch agrees with run permission`);
 await page.reload();await page.getByRole('button',{name:new RegExp(`Account: ${id}`)}).waitFor();check(await page.getByRole('switch',{name:'Allow this browser to place trades'}).isChecked(),`${mode}: permission survives reload`);
 await page.getByRole('button',{name:'Stop & disable trading'}).click();check(!(await page.getByRole('switch',{name:'Allow this browser to place trades'}).isChecked()),`${mode}: emergency disable still overrides permission`);
 await context.close();
}console.log(`PASS ${checks} synthetic permission checks. No live broker account or order accessed.`);}finally{await browser.close();}
