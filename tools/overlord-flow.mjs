// Synthetic integration ONLY. Start derivstub with STUB_TRADING=1 STUB_PATTERNS=1
// STUB_REAL_FUNDS=1 STUB_SETTLE_MS=1800 and a matching test-only server build.
// Never run these fixtures or credentials against a live broker endpoint.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/home/user/pwtest/node_modules/playwright/index.mjs');
import fs from 'node:fs/promises';
const base = process.env.APP_URL || 'http://127.0.0.1:3000';
const mode = process.env.TEST_MODE || 'demo';
const loginid = mode === 'real' ? 'ROT90004581' : 'DOT90004580';
const otherId = mode === 'real' ? 'DOT90004580' : 'ROT90004581';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = []; const checks = [];
page.on('pageerror', (error) => errors.push(error.message));
function check(ok, message) { if (!ok) throw new Error(message); checks.push(message); console.log(`PASS ${mode}: ${message}`); }
const main = page.locator('.workspace-main');
const consolePanel = () => main.getByRole('heading', { name: 'Bot session', exact: true }).locator('xpath=ancestor::section[1]');
const accountButton = () => page.locator('button[aria-haspopup="menu"]');
async function ledger() { const r = await page.request.get('http://127.0.0.1:4517/__fixture/trades'); return r.json(); }
async function navigate(path) { await page.goto(base + path); await accountButton().waitFor(); }
async function waitVerified() { await page.waitForFunction(() => Array.from(document.querySelectorAll('dd')).some((el) => el.textContent === 'Verified')); }
async function configurePermission() {
  await navigate('/risk');
  if (!(await accountButton().getAttribute('aria-label')).includes(loginid)) {
    await accountButton().click();
    await page.getByRole('menuitemradio').filter({hasText:loginid}).click();
    await page.getByRole('menu').waitFor({state:'hidden'});
  }
  const allow = main.getByRole('switch', { name: 'Allow this browser to place trades' });
  if (!(await allow.isChecked())) await allow.click();
  if (mode === 'real') {
    const ack = main.getByRole('switch', { name: 'I accept the risk of losing real money on the selected account' });
    if (!(await ack.isChecked())) await ack.check();
  }
  await waitVerified();
}
async function configureBot() {
  await navigate('/overlord');
  await main.getByRole('combobox', { name: /^Market/ }).selectOption('R_10');
  await main.getByRole('spinbutton', { name: 'Initial stake' }).fill('1');
  await main.getByRole('combobox', { name: 'Duration' }).selectOption('1');
  await main.getByRole('spinbutton', { name: 'Target profit' }).fill('1');
  await main.getByRole('spinbutton', { name: /^Stop loss/ }).fill('10');
  const martingale = main.getByRole('switch', { name: 'Enable martingale' });
  if (!(await martingale.isChecked())) await martingale.click();
  await main.getByRole('spinbutton', { name: 'Multiplier' }).fill('2.1');
  await main.getByRole('spinbutton', { name: 'Maximum escalation steps' }).fill('4');
  const recovery = main.getByRole('switch', { name: /Recovery mode/ });
  if (await recovery.isChecked()) await recovery.click();
  await waitVerified();
}
async function confirmRun() {
  await main.getByRole('button', { name: 'Run bot', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  check((await dialog.innerText()).includes(loginid), 'confirmation identifies selected genuine account');
  await dialog.getByRole('button', { name: /Confirm/ }).click();
  await dialog.waitFor({ state: 'hidden' });
}
async function waitOpen() {
  await page.waitForFunction(() => document.querySelector('.workspace-main')?.textContent?.includes('Broker confirmed contract'), { timeout: 60000 });
}
async function assertSwitchBlocked() {
  await accountButton().click();
  await page.getByRole('menuitemradio').filter({ hasText: otherId }).click();
  await page.getByText('Stop the bot before switching accounts.', { exact: true }).waitFor();
  check((await accountButton().getAttribute('aria-label')).includes(loginid), 'pending account cannot be switched');
  await accountButton().click();
}
try {
  await page.request.post('http://127.0.0.1:4517/__fixture/reset');
  const auth = await page.request.post(base + '/api/deriv/token', { data: { token: 'synthetic-only-token' } });
  if (!auth.ok()) throw new Error(`Synthetic authentication failed: ${auth.status()} ${await auth.text()}`);
  const select = await page.request.post(base + '/api/deriv/session/select', { data: { loginid } });
  if (!select.ok()) throw new Error(`Synthetic selection failed: ${select.status()}`);
  await configurePermission();
  check((await accountButton().getAttribute('aria-label')).includes(loginid), 'verified execution uses explicitly selected environment');
  await configureBot();
  await main.getByRole('button', { name: 'Find market', exact: true }).click();
  await main.getByText(/2 \/ 2 markets/).waitFor({ timeout: 40000 });
  check((await main.innerText()).includes('New live outcomes'), 'scanner shows measured forward-validation evidence');
  check(!(await main.innerText()).includes('84.9% confidence'), 'scanner does not fabricate screenshot confidence');
  await confirmRun();
  await page.waitForTimeout(2000);
  check((await ledger()).length === 0, 'unqualified historical pattern cannot trigger an order');
  check((await consolePanel().innerText()).toLowerCase().includes('waiting'), 'run visibly waits for qualified live signals');
  await waitOpen();
  check((await consolePanel().getByRole('button', { name: 'Reset session view' }).isDisabled()), 'reset is disabled while an accepted contract is pending');
  await assertSwitchBlocked();
  await page.waitForFunction(() => document.querySelector('.workspace-main')?.textContent?.includes('Session profit target reached'), { timeout: 60000 });
  const trades = await ledger();
  check(trades.length === 3, 'qualified continuous run stops after exactly three accepted contracts');
  check(JSON.stringify(trades.map((t) => t.price)) === '[1,2.1,4.41]', 'recovery stakes use actual settled losses');
  check(trades.every((t) => t.contract_type === 'DIGITEVEN' && t.duration === 1 && t.underlying_symbol === 'R_10'), 'orders preserve selected digit contract, duration and market');
  check(trades.every((t) => t.account_socket.includes(loginid)), 'all broker orders use selected account socket, including Real');
  const summary = await consolePanel().innerText();
  check(summary.includes('+1.09') && summary.includes('7.51') && summary.includes('8.60'), 'summary reconciles actual net, paid stake and gross return');
  await consolePanel().getByRole('tab', { name: 'Transactions', exact: true }).click();
  const transactionText = await consolePanel().innerText();
  check(transactionText.includes('100.01') && transactionText.includes('100.08'), 'transactions expose broker entry and exit spots');
  await consolePanel().getByRole('tab', { name: 'Journal', exact: true }).click();
  const journal = await consolePanel().innerText();
  check(['pricing', 'buying', 'open', 'settled'].every((phase) => journal.toLowerCase().includes(phase)), 'journal retains chronological broker lifecycle');
  const downloadPromise = page.waitForEvent('download');
  await consolePanel().getByRole('button', { name: 'Download journal' }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  check(exported.length > 10 && exported.every((entry) => entry.accountLoginid === loginid), 'journal download is scoped to selected account');
  await consolePanel().getByRole('button', { name: 'Reset session view' }).click();
  await consolePanel().getByRole('tab', { name: 'Summary', exact: true }).click();
  check((await consolePanel().innerText()).includes('0 settled'), 'reset clears displayed run totals without inventing a session');
  await navigate('/history');
  check(await main.locator('tbody tr').count() === 3, 'view reset preserves broker transaction history');
  await navigate('/overlord');
  await page.reload(); await accountButton().waitFor();
  await consolePanel().getByRole('tab', { name: 'Journal', exact: true }).click();
  await consolePanel().getByRole('checkbox', { name: 'Include prior sessions for this account' }).check();
  check((await consolePanel().innerText()).toLowerCase().includes('settled'), 'account journal survives authenticated refresh and view reset');
  check((await ledger()).length === 3, 'refresh does not resume or duplicate execution');
  await accountButton().click();
  await page.getByRole('menuitemradio').filter({ hasText: otherId }).click();
  await page.getByRole('menu').waitFor({ state: 'hidden' });
  await navigate('/history');
  check(await main.locator('tbody tr').count() === 0, 'switching accounts cannot inherit another account transactions');
  // Fresh run: Stop must retain an already accepted contract until actual settlement.
  await accountButton().click();
  await page.getByRole('menuitemradio').filter({ hasText: loginid }).click();
  await page.getByRole('menu').waitFor({ state: 'hidden' });
  await configurePermission();
  await configureBot();
  await page.request.post('http://127.0.0.1:4517/__fixture/reset');
  await confirmRun();
  await waitOpen();
  await consolePanel().getByRole('button', { name: 'Stop bot', exact: true }).click();
  check(await consolePanel().getByRole('button', { name: 'Reset session view' }).isDisabled(), 'Stop does not discard accepted unsettled contract');
  await assertSwitchBlocked();
  await page.waitForTimeout(2600);
  const stopped = await ledger();
  check(stopped.length === 1, 'Stop prevents a second entry after pending settlement');
  check(!(await consolePanel().getByRole('button', { name: 'Reset session view' }).isDisabled()), 'broker settlement releases pending reset lock after Stop');
  check(errors.length === 0, `no browser runtime errors (${errors.join('; ')})`);
  console.log(JSON.stringify({ synthetic: true, mode, passed: checks.length }, null, 2));
} catch (error) {
  await page.screenshot({ path: `/home/user/overlord-${mode}-failure.png`, fullPage: true });
  await fs.writeFile(`/home/user/overlord-${mode}-failure.txt`, await page.locator('body').innerText());
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); }
