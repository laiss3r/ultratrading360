// Genuine PUBLIC data only. No credentials, authentication, proposal or order.
// CLOCK_OFFSET=120000 tests an incorrectly configured device clock.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/user/pwtest/node_modules/playwright/index.mjs');
const base=process.env.BASE||'http://127.0.0.1:3000',offset=Number(process.env.CLOCK_OFFSET||0),onlyFirst=process.env.ONLY_FIRST==='1',correctClock=process.env.CORRECT_CLOCK==='1';
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],requests=[];
let ticks=0,pages=0,checks=0;const brokerErrors=[];
const check=(ok,message)=>{if(!ok)throw Error(message);console.log(`PASS ${++checks}: ${message}`);};
await page.addInitScript(ms=>{const original=Date.now.bind(Date);Date.now=()=>original()+ms;},offset);
page.on('pageerror',e=>errors.push(e.message));
page.on('websocket',socket=>{socket.on('framesent',f=>{try{requests.push(JSON.parse(String(f.payload)));}catch{}});socket.on('framereceived',f=>{try{const m=JSON.parse(String(f.payload));if(m.tick)ticks++;if(m.history)pages++;if(m.error){brokerErrors.push(m.error);console.log('BROKER_READ_ERROR',JSON.stringify(m.error));}}catch{}});});
try{
 await page.goto(base+'/signals');await page.locator('.boot-status').waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelectorAll('.workspace-main input[type=checkbox]').length>=13,null,{timeout:30000});
 await page.getByText(/Choose markets to watch/).click();const boxes=page.locator('.workspace-main input[type=checkbox]');
 if(onlyFirst)for(let i=1;i<await boxes.count();i++)await boxes.nth(i).uncheck();
 const expected=onlyFirst?1:await boxes.count(),started=performance.now();await page.getByRole('button',{name:'Find market',exact:true}).click();
 await page.waitForFunction(()=>Number(document.querySelector('progress[aria-label="Market analysis progress"]')?.value)>0,null,{timeout:30000});
 check(true,'real page progress advances before all markets complete');
 if(correctClock)await page.evaluate(()=>{Date.now=()=>new Date().getTime();});
 await page.locator('.scan-market-card[data-scan-phase=watching]').first().waitFor({timeout:35000});const firstReadyMs=performance.now()-started;
 check(true,`first market completes a full historical seed (${Math.round(firstReadyMs)} ms)`);
 await page.waitForFunction(n=>document.querySelectorAll('.scan-market-card[data-scan-phase=watching]').length===n,expected,{timeout:300000});
 check(true,`${expected} / ${expected} markets complete historical analysis`);
 const cards=await page.locator('.scan-market-card').allTextContents(),activity=await page.locator('.scan-activity').innerText();
 check(cards.every(t=>!t.includes('0 live ticks observed')),'every watched market receives accepted live ticks');
 check(cards.every(t=>!t.includes('stale or future-dated')),'genuine fresh seeds are not rejected by the device clock');
 check(activity.includes('history ticks loaded')&&activity.includes('receiving live ticks'),'header separates genuine page progress, completed markets and live feeds');
 if(offset&&!correctClock)check((await page.locator('.workspace-main').innerText()).includes('Your device clock differs from broker time'),'clock skew is explicitly explained rather than silently rejecting every tick');
 check(requests.filter(r=>r.time===1).length>=1,'freshness is calibrated against an actual broker clock response');
 check(pages>=expected*5&&ticks>expected,'actual paginated history and live responses were observed');
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px scan does not overflow the viewport`);}
 await page.screenshot({path:`/home/user/signals-public-${offset}-${expected}.png`,fullPage:true});
 await page.getByRole('button',{name:'Stop scan',exact:true}).click();check(await page.getByText('Live scan is stopped',{exact:true}).isVisible(),'Stop clears scan evidence and owns pending resources');
 check(!requests.some(r=>r.buy||r.authorize||r.proposal||r.proposal_open_contract),'verification sends no private authentication, quote or order');
 check(errors.length===0,`no browser runtime errors (${errors.join('; ')})`);
 console.log(JSON.stringify({base,readOnly:true,clockOffsetMs:offset,correctedDuringScan:correctClock,markets:expected,firstReadyMs,totalReadyMs:performance.now()-started,historyResponses:pages,rawTickResponses:ticks,brokerErrors,checks}));
}catch(error){await page.screenshot({path:'/home/user/signals-public-failure.png',fullPage:true});console.error(await page.locator('.workspace-main').innerText());throw error;}finally{await browser.close();}
