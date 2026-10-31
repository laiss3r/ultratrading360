/**
 * Authenticated end-to-end workflow against the STUB Deriv edge (tools/derivstub.mjs)
 * and a local production build configured to talk to it. Verifies, with real backend
 * responses (stubbed Deriv, genuine app code):
 *   login -> account init -> account list -> switch -> balances -> navigation across
 *   every section -> reload persistence -> offline/online recovery -> flaky-Deriv
 *   tolerance (run the stub with STUB_FLAKY=1).
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0;
const fails = [];
const check = (name, ok) => {
  if (ok) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fails.push(name);
    console.log(`FAIL  ${name}`);
  }
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', (e) => fails.push(`pageerror: ${e.message.slice(0, 90)}`));

const signedIn = async () => {
  await page.waitForTimeout(250);
  const loginBtns = await page.locator('header button:has-text("Log in")').count();
  const switcher = await page.locator('button[aria-haspopup="menu"]').count();
  return loginBtns === 0 && switcher > 0;
};

// 1. login (PAT route against the stub: genuine server-side validation code path)
const login = await page.request.post(`${BASE}/api/deriv/token`, { data: { token: 'stubpat123456789' } });
const lj = await login.json();
check('login: token route accepts and mints a session', login.ok() && lj.ok === true);

// 2. account initialisation on the dashboard
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForSelector('button[aria-haspopup="menu"]', { timeout: 20000 });
check('init: dashboard boots signed-in (no Log in button)', await signedIn());

// 3. accounts load with balances from the stub REST listing
await page.locator('button[aria-haspopup="menu"]').first().click();
await page.waitForSelector('text=DOT90004580', { timeout: 10000 });
const body1 = await page.evaluate(() => document.body.innerText);
check('accounts: Options rows listed with balances', body1.includes('DOT90004580') && body1.includes('10000.00'));

// 4. balance sync pulls classic rows (browser-side legacy authorize against stub WS)
await page.locator('button:has-text("Sync balances")').click();
await page.waitForSelector('text=VRTC1234567', { timeout: 15000 });
const body2 = await page.evaluate(() => document.body.innerText);
check('sync: classic Real/Demo rows adopted with live balances', body2.includes('VRTC1234567') && body2.includes('4172.24') && body2.includes('CR1234567'));

// 5. switch accounts (server-backed) and verify the active row
await page.locator('[role="menuitemradio"]:has-text("VRTC1234567")').first().click();
await page.waitForTimeout(600);
await page.locator('button[aria-haspopup="menu"]').first().click();
await page.waitForSelector('text=VRTC1234567', { timeout: 10000 });
const checked = await page.locator('[role="menuitemradio"][aria-checked="true"]:has-text("VRTC1234567")').first().innerText();
check('switch: active account became VRTC1234567', checked.includes('VRTC1234567'));

await page.keyboard.press('Escape');
// 6. navigation across every section keeps the session
for (const tab of ['Builder', 'Chart', 'Signals']) {
  await page.locator(`a:has-text("${tab}")`).filter({visible:true}).first().click();
  await page.waitForTimeout(500);
  check(`navigate: ${tab} keeps the session`, await signedIn());
}

// 7. reload persistence (cookie + pref, no re-login)
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForSelector('button[aria-haspopup="menu"]', { timeout: 20000 });
check('reload: session survives a full reload', await signedIn());
await page.locator('button[aria-haspopup="menu"]').first().click();
await page.waitForSelector('text=VRTC1234567', { timeout: 10000 });
const checked2 = await page.locator('[role="menuitemradio"][aria-checked="true"]:has-text("VRTC1234567")').first().innerText();
check('reload: selected account persisted', checked2.includes('VRTC1234567'));

await page.keyboard.press('Escape');
// 8. offline -> online recovery without logout
await context.setOffline(true);
await page.waitForTimeout(800);
check('offline: still signed in while the network is down', await signedIn());
await context.setOffline(false);
await page.waitForTimeout(1200);
check('online: session recovered after reconnection', await signedIn());

// Real account viewing must persist without granting permission to execute.
const realSwitch = await page.request.post(`${BASE}/api/deriv/session/select`, { data: { loginid: 'ROT90004581' } });
const real = await realSwitch.json();
check('real selection: backend persists correct Real identity and zero balance', realSwitch.ok() && real.session.loginid === 'ROT90004581' && real.session.isVirtual === false && real.session.balance === 0);
const realSocket = await page.request.post(`${BASE}/api/deriv/socket`, { data: { loginid: 'ROT90004581' } });
check('real trading: backend rejects missing acknowledgement', realSocket.status() === 403);
const mismatch = await page.request.post(`${BASE}/api/deriv/socket`, { data: { loginid: 'DOT90004580' } });
check('socket isolation: mismatched account rejected', mismatch.status() === 409);
const missing = await page.request.post(`${BASE}/api/deriv/session/select`, { data: { loginid: 'CR9999999' } });
check('selection: unknown account rejected', missing.status() === 404);
await page.request.post(`${BASE}/api/deriv/session/select`, { data: { loginid: 'VRTC1234567' } });

// 9. flaky Deriv tolerance: reload a few times; every 3rd revalidation 500s (stub)
for (let i = 0; i < 4; i += 1) {
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('button[aria-haspopup="menu"]', { timeout: 20000 });
}
check('reloads: four reloads never logged the user out', await signedIn());

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log(fails.join('\n'));
  process.exit(1);
}
