// Isolated fixture identity only; no purchases. Checks screenshot overflow at narrow and zoomed widths.
const {chromium}=await import('/home/user/pwtest/node_modules/playwright/index.mjs');
const browser=await chromium.launch();let checks=0;const check=(ok,msg)=>{if(!ok)throw new Error(msg);console.log(`PASS ${++checks}: ${msg}`);};
try{for(const width of [320,360,390]){
 const c=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});await c.addInitScript(()=>{const Native=window.WebSocket;window.WebSocket=class extends Native{constructor(url,protocols){super(String(url).includes('/options/ws/public')?'ws://127.0.0.1:4519/public':url,...(protocols===undefined?[]:[protocols]));}};});
 const p=await c.newPage();await c.request.post('http://localhost:3002/api/deriv/token',{data:{token:'synthetic-only-token'}});await c.request.post('http://localhost:3002/api/deriv/session/select',{data:{loginid:'DOT90004580'}});await p.goto('http://localhost:3002/overlord');await p.getByRole('button',{name:'Run bot',exact:true}).waitFor();
 await p.getByRole('combobox',{name:/^Market/}).selectOption('R_10');
 await p.getByRole('switch',{name:/Recovery mode/}).click();await p.getByRole('button',{name:'Run bot',exact:true}).click();const d=p.getByRole('dialog');await d.waitFor();
 check(await d.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth+1;}),`${width}: confirmation and long recovery text stay within viewport`);
 check(await d.getByRole('button',{name:'Confirm & run'}).isVisible(),`${width}: confirm control reachable`);
 await d.getByRole('button',{name:'Cancel',exact:true}).click();check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: complete page has no horizontal overflow`);
 const panel=p.getByRole('heading',{name:'Bot session',exact:true}).locator('xpath=ancestor::section[1]');for(const name of ['Summary','Transactions','Journal']){await panel.getByRole('tab',{name,exact:true}).click();check(await panel.getByLabel('Session totals').isVisible(),`${width}: ${name} retains session totals`);}
 if(width===360)await p.screenshot({path:'/home/user/execution-mobile.png',fullPage:true});await c.close();
}console.log(`PASS ${checks} isolated mobile checks; no purchases.`);}finally{await browser.close();}
