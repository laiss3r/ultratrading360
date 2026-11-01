// Genuine public discovery/history/streams only. Never authenticates, confirms execution, or buys.
const {chromium}=await import('/home/user/pwtest/node_modules/playwright/index.mjs');
const browser=await chromium.launch();const base=process.env.BASE||'http://127.0.0.1:3000';let checks=0;
const check=(ok,msg)=>{if(!ok)throw Error(msg);console.log(`PASS ${++checks}: ${msg}`);};
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],sent=[],symbols=new Map(),ticks=new Set();
 page.on('pageerror',e=>errors.push(e.message));page.on('websocket',ws=>{ws.on('framesent',f=>{try{sent.push(JSON.parse(String(f.payload)));}catch{}});ws.on('framereceived',f=>{try{const p=JSON.parse(String(f.payload));if(Array.isArray(p.active_symbols))for(const s of p.active_symbols)symbols.set(s.underlying_symbol,s);if(p.tick)ticks.add(p.tick.underlying_symbol??p.tick.symbol);}catch{}});});
 await page.goto(base+'/elite');const main=page.locator('.workspace-main');await main.getByRole('heading',{name:'Elite Prime Pro',exact:true}).waitFor();
 const config=await page.evaluate(()=>fetch('/api/deriv/config').then(r=>r.json()));check(!/127\.0\.0\.1|localhost/.test(config.apiBase),'build uses the genuine broker API, not the isolated fixture');
 await main.locator('[data-elite-market]').first().waitFor({timeout:45000});await page.waitForFunction(()=>{const cards=[...document.querySelectorAll('[data-elite-market]')];return cards.length>0&&cards.every(c=>c.querySelector('.badge')?.textContent==='Live');},{timeout:60000});
 const selected=await main.locator('[data-elite-market]').evaluateAll(nodes=>nodes.map(n=>n.dataset.eliteMarket));
 check(selected.length>0&&selected.every(s=>symbols.has(s)),`${selected.length} selected markets are returned by actual active_symbols`);
 check(selected.every(s=>ticks.has(s)),'each selected market has an actual subscribed broker tick');
 check(await main.locator('[data-elite-market] .elite-stream:first-of-type .elite-token').count()===selected.length*5,'each market displays five observed digits');
 check(await main.locator('[data-elite-market] .elite-stream:nth-of-type(2) .elite-token').count()===selected.length*5,'each market displays five observed price moves');
 await main.getByRole('button',{name:'Circles',exact:true}).click();check(await main.locator('.elite-circles .elite-token').count()===selected.length*10,'Circles has ten genuine observed-frequency bins per market');
 for(const width of [320,360,390,768,1280]){await page.setViewportSize({width,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px genuine-data page has no horizontal overflow`);}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:`/home/user/elite-public-${base.includes('vercel')?'production':'local'}-mobile.png`,fullPage:true});
 const capability=await page.evaluate(async(selected)=>{const ws=new WebSocket('wss://api.derivws.com/trading/v1/options/ws/public'),pending=new Map();let req=0;const ask=body=>new Promise((resolve,reject)=>{const req_id=++req;pending.set(req_id,{resolve,reject});ws.send(JSON.stringify({...body,req_id}));});await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});ws.onmessage=msg=>{const p=JSON.parse(msg.data),wait=pending.get(p.req_id);if(wait){pending.delete(p.req_id);p.error?wait.reject(Error(p.error.message)):wait.resolve(p);}};try{return await Promise.all(selected.map(async symbol=>{const p=await ask({contracts_for:symbol});return {symbol,contracts:p.contracts_for.available.filter(s=>['DIGITEVEN','DIGITODD','DIGITOVER','DIGITUNDER','DIGITMATCH','DIGITDIFF','CALL','PUT'].includes(s.contract_type)).map(s=>({type:s.contract_type,min:s.min_contract_duration,max:s.max_contract_duration,range:s.last_digit_range}))};}));}finally{ws.close();}},selected);
 check(capability.every(c=>c.contracts.some(s=>s.type==='DIGITEVEN'&&s.min==='1t'&&Number.parseInt(s.max)>=1)),'actual per-market capabilities validate the default Even / one-tick action');
 console.log('BROKER_CAPABILITIES',JSON.stringify(capability));
 await main.getByRole('button',{name:'Execute strategies',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();check((await dialog.innerText()).includes('Elite Prime Pro'),'preparation opens exact Elite confirmation without purchasing');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 check(await page.locator('a[href="/builder"]').count()>0&&await page.locator('a[href="/overlord"]').count()>0,'Bot Builder and Overlord remain accessible');
 check(!sent.some(p=>p.buy||p.authorize),'no private authentication or order during public verification');check(errors.length===0,`no browser runtime errors (${errors.join('; ')})`);
 console.log(JSON.stringify({checks,readOnly:true,base,selected}));
}finally{await browser.close();}
