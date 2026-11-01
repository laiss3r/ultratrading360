// Controlled broker fixture only. Never authenticates with or buys from the real broker.
const {chromium}=await import('/home/user/pwtest/node_modules/playwright/index.mjs');
const browser=await chromium.launch();let checks=0;
const check=(ok,msg)=>{if(!ok)throw Error(msg);console.log(`PASS ${++checks}: ${msg}`);};
try{
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base='http://127.0.0.1:3001';
 await page.request.post('http://127.0.0.1:4517/__fixture/reset');
 const auth=await page.request.post(base+'/api/deriv/token',{data:{token:'synthetic-only-token'}});check(auth.ok(),'isolated synthetic account authenticates');
 await page.request.post(base+'/api/deriv/session/select',{data:{loginid:'DOT90004580'}});
 await page.goto(base+'/overlord');await page.waitForFunction(()=>document.querySelector('.account-trigger')?.textContent?.includes('10000'));
 const main=page.locator('.workspace-main');
 await main.getByRole('combobox',{name:'Market',exact:true}).selectOption('R_10');
 await main.getByRole('spinbutton',{name:'Initial stake'}).fill('2');
 await main.getByRole('button',{name:'Find market',exact:true}).click();
 const row=page.locator('[data-market-symbol="R_25"][data-discovery-phase="ready"]');await row.waitFor({timeout:45000});
 check(await row.getByRole('button',{name:'Run market',exact:true}).isVisible(),'Run appears beside the analysed market');
 const expected=await row.locator('.scanned-market-run').evaluate(el=>({...el.dataset}));
 check(await main.getByRole('combobox',{name:'Market',exact:true}).inputValue()==='R_10','global setup initially targets a different market');
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px market Run causes no horizontal overflow`);}
 await page.setViewportSize({width:390,height:844});await row.screenshot({path:'/home/user/scanned-market-run-mobile.png'});
 await row.getByRole('button',{name:'Run market',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();
 check((await dialog.innerText()).includes('R_25'),'confirmation targets clicked R_25 rather than global R_10');
 check((await dialog.innerText()).includes(expected.runContract),'confirmation uses scanned best contract');
 if(expected.runBarrier!==undefined)check((await dialog.innerText()).includes(`· ${expected.runBarrier}`),'confirmation uses scanned best barrier');
 check((await dialog.innerText()).includes('2.00 USD'),'configured stake survives market preparation');
 check(await main.getByRole('combobox',{name:'Market',exact:true}).inputValue()==='R_25','visible setup updates to the clicked market');
 check(await main.getByRole('combobox',{name:'Contract type',exact:true}).inputValue()===expected.runContract,'visible contract matches the prepared strategy');
 const ledger=async()=>await(await page.request.get('http://127.0.0.1:4517/__fixture/trades')).json();check((await ledger()).length===0,'preparing Run sends no purchase before confirmation');
 await dialog.getByRole('button',{name:'Confirm & run'}).click();await page.locator('.global-session').waitFor();check(true,'confirmed scanned-market Run automatically expands shared session');
 await page.waitForFunction(()=>/waiting|qualified/i.test(document.querySelector('.global-session')?.textContent??''),undefined,{timeout:20000});
 check((await ledger()).length===0,'unqualified scanned setup waits without fabricating a purchase');
 await page.getByRole('button',{name:'Collapse trading session'}).click();
 check(await row.getByRole('button',{name:'Run market',exact:true}).isDisabled(),'running bot disables additional market Run buttons');
 await page.getByRole('button',{name:/Expand trading session/}).click();await page.locator('.global-session').getByRole('button',{name:'Stop bot'}).click();
 check(errors.length===0,'no browser runtime errors');console.log(JSON.stringify({synthetic:true,checks}));
}finally{await browser.close();}
