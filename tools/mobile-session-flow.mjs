// Explicitly synthetic only: Demo-only REST + late classic Real fixtures.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/home/user/pwtest/node_modules/playwright/index.mjs');
const base=process.env.BASE||'http://localhost:3000';
const browser=await chromium.launch();let checks=0;
function check(ok,message){if(!ok)throw new Error(message);console.log(`PASS ${++checks}: ${message}`);}
try{
 for(const width of [320,360,390]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const auth=await page.request.post(base+'/api/deriv/token',{data:{token:'synthetic-only-token'}});check(auth.ok(),`${width}: synthetic authentication`);
  await page.goto(base+'/overlord');
  await page.waitForFunction(()=>document.querySelector('button[aria-haspopup="menu"]')?.getAttribute('aria-label')?.includes('CR1234567'),undefined,{timeout:30000});
  check(true,`${width}: fresh login discovers and selects genuine returned Real row`);
  await page.getByRole('button',{name:'Session',exact:true}).click();
  const rail=page.getByRole('complementary',{name:'Session monitor'});
  await rail.getByText(/viewing only; Deriv must expose an Options account/).waitFor({timeout:30000});
  check(true,`${width}: actual broker channel refusal is visible, not hidden in logs`);
  check(await rail.getByRole('button',{name:'Reconnect trading channel'}).isEnabled(),`${width}: safe reconnect action is available`);
  await rail.getByRole('button',{name:'Run strategy',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  check(await dialog.evaluate(el=>el.parentElement?.parentElement===document.body),`${width}: drawer confirmation is portalled outside clipping ancestor`);
  const bounds=await dialog.boundingBox();check(bounds.x>=0&&bounds.x+bounds.width<=width,`${width}: dialog stays within viewport`);
  const fits=await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1&&Array.from(el.querySelectorAll('dd, .button-row button')).every(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;}));
  check(fits,`${width}: values and confirmation controls do not extend off screen`);
  check((await dialog.innerText()).includes('CR1234567 (REAL MONEY)'),`${width}: confirmation identifies selected Real, not a cosmetic label`);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  check(errors.length===0,`${width}: no uncaught runtime errors`);
  await context.close();
 }
 console.log(`PASS ${checks} synthetic mobile/session checks. No orders placed.`);
}finally{await browser.close();}
