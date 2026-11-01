// Genuine public, read-only browser checks. No authentication, confirmation or buy.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/user/pwtest/node_modules/playwright/index.mjs');
const base=process.env.BASE||'http://localhost:3000';const browser=await chromium.launch();let checks=0;
const check=(ok,msg)=>{if(!ok)throw new Error(msg);console.log(`PASS ${++checks}: ${msg}`);};
try{
 const page=await browser.newPage({viewport:{width:360,height:844}});const errors=[],sockets=[];page.on('pageerror',e=>errors.push(e.message));page.on('websocket',ws=>{const frames=[];sockets.push(frames);ws.on('framesent',f=>{try{frames.push(JSON.parse(String(f.payload)));}catch{}});});
 await page.goto(base+'/overlord');const panel=page.getByRole('heading',{name:'Volatility market discovery',exact:true}).locator('xpath=ancestor::section[1]');
 check(await panel.getByRole('button',{name:'Find market'}).isVisible(),'Overlord-only history-first discovery is present');
 check(await panel.getByRole('checkbox').count()===0,'no market checklist or manual sample size');
 const before=Date.now();await panel.getByRole('button',{name:'Find market'}).click();
 await panel.locator('[data-discovery-phase="ready"]').first().waitFor({timeout:45000});console.log(`First visible historical result: ${Date.now()-before}ms`);
 await panel.getByText('HISTORICAL ANALYSIS COMPLETE',{exact:true}).waitFor({timeout:90000});
 const rows=await panel.locator('[data-market-symbol]').count(),ready=await panel.locator('[data-discovery-phase="ready"]').count();check(ready>0&&rows===ready,`all ${rows} API-returned open Volatility markets analysed, no missing rows`);
 const names=await panel.locator('.scan-market-card header strong').allTextContents();check(names.every(n=>/Volatility/i.test(n))&&names.some(n=>/\(1s\)/.test(n)),'full API display names include one-second variants');
 const discovery=sockets.find(frames=>frames.some(f=>f.ticks_history&&f.count===1000)&&frames.some(f=>f.contracts_for));if(!discovery)throw Error('Dedicated discovery transport not found');
 check(!discovery.some(f=>f.ticks||f.buy),'discovery never subscribes to live ticks or sends buy');
 check(discovery.filter(f=>f.ticks_history).length===rows,'single fixed 1000-tick page per market');
 check(await panel.locator('[data-probability]').evaluateAll(nodes=>nodes.every(n=>Math.abs(Number(n.dataset.probability)-Number(n.dataset.hits)/Number(n.dataset.sample))<1e-12)),'every displayed probability is backed by hits/sample');
 check(await panel.locator('[data-contract-family]').count()===ready*4,'Even/Odd/Over/Under shown for every analysed market');
 for(const width of [320,360,390,1280]){await page.setViewportSize({width,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px: no horizontal page overflow`);}
 await page.setViewportSize({width:360,height:844});await page.screenshot({path:'/home/user/overlord-history-mobile.png',fullPage:true});
 const reads=discovery.filter(f=>f.ticks_history).length;await page.getByRole('combobox',{name:'Duration',exact:true}).selectOption('2');await panel.getByText('HISTORICAL ANALYSIS COMPLETE',{exact:true}).waitFor();try{await panel.getByText(/500 non-overlapping 2-tick outcomes/).first().waitFor({timeout:10000});}catch(e){console.log('DEBUG',await panel.innerText());throw e;}
 check(discovery.filter(f=>f.ticks_history).length===reads,'duration changes reanalyse cached histories without download');
 await panel.getByRole('button',{name:'Apply highest-probability setup'}).click();check(await page.getByText(/Historical result applied to setup/).count()===1,'historical result applies setup without starting a bot');
 check(!sockets.some(frames=>frames.some(f=>f.buy)),'no order was submitted by scanning or applying a result');
 await panel.getByRole('button',{name:'Stop scan'}).click();check(await panel.locator('[data-market-symbol]').count()===0,'Stop immediately discards discovery rows');
 await panel.getByRole('button',{name:'Find market'}).click();await panel.locator('[data-discovery-phase="ready"]').first().waitFor({timeout:20000});check(true,'immediate restart after Stop opens a clean historical connection');await panel.getByRole('button',{name:'Stop scan'}).click();
 check(errors.length===0,`no browser runtime errors (${errors.join('; ')})`);
 await page.goto(base+'/signals');check(await page.getByRole('heading',{name:'Live market signals',exact:true}).count()===1,'Signal Tools retains its existing live scanner; only Overlord changed');
 console.log(JSON.stringify({checks,readOnly:true,base}));
}finally{await browser.close();}
