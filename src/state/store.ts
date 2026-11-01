'use client';
import type { ExecutionEvent } from '@/lib/engine/execution';
import type { SignalEvidence } from '@/lib/signals/patterns';

import { create } from 'zustand';
import { changeIdentity, identityRevision, sessionWrite } from '@/lib/deriv/sessionWrites';
import { watchClassicBalances, type BalanceStatus, type BalanceUpdate } from '@/lib/deriv/classicBalances';
import { accountDiscoveryMessage } from '@/lib/deriv/accountDiagnostics';
import type { AccountMode, ActiveSymbol, AuthSession } from '@/lib/deriv/types';
import { DERIV_APP_ID } from '@/lib/deriv/config';
import { DerivProvider, type MarketProvider, type Quote } from '@/lib/engine/provider';
import { RiskManager, type RiskSnapshot } from '@/lib/engine/risk';
import { TradingBot, type BotState, type TradeRecord } from '@/lib/engine/bot';
import { createStrategy, effectiveStrategyLimits, validateStrategy, type Strategy } from '@/lib/engine/strategies';
import { computeMetrics, type PerformanceMetrics } from '@/lib/metrics';
import {
  DEFAULT_SETTINGS,
  appendExecutionEvent, loadExecutionJournal, loadSessionResets, saveSessionResets,
  appendTrades,
  listStrategies,
  listTrades,
  loadSettings,
  saveSettings,
  saveStrategy,
  deleteStrategy as removeStoredStrategy,
  type AppSettings,
} from '@/lib/persistence/db';

export interface AccountSummary {
  loginid: string;
  currency: string;
  balance: number;
  balanceKnown?: boolean;
  isVirtual: boolean;
}

export interface LogEntry {
  at: number;
  level: 'info' | 'ok' | 'warn' | 'error';
  text: string;
}

export type RunPanelTab = 'summary' | 'transactions' | 'journal';

export interface MarketRanking {
  symbol: string;
  name: string;
  /** Ticks observed in the sample window. */
  sample: number;
  /** Observed spread of the last digit, 0..1. Higher = closer to uniform. */
  digitEntropy: number;
  /** Relative tick cadence implied by the symbol family (1s indices are faster). */
  cadence: 'fast' | 'normal';
  /** Mean absolute per-tick move in pips — a volatility proxy, not a prediction. */
  meanAbsMovePips: number;
  open: boolean;
  score: number;
}

interface State {
  hydrated: boolean;
  settings: AppSettings;
  session: AuthSession | null;
  accounts: AccountSummary[];
  oauthConfigured: boolean;
  redirectUri: string;
  appId: string;

  provider: MarketProvider | null;
  connectionStatus: string;
  tradingLoginid: string | null;
  tradingMessage: string | null;
  tradingConnecting: boolean;
  symbols: ActiveSymbol[];
  activeSymbol: string;
  quotes: Quote[];
  digits: number[];
  pipSize: number;
  dataSource: 'none' | 'deriv_live';
  marketLoading: boolean;
  marketError: string | null;

  strategies: Strategy[];
  activeStrategyId: string | null;
  bot: TradingBot | null;
  botState: BotState;
  botDetail: string;
  execution: ExecutionEvent|null;
  executionJournal: ExecutionEvent[];
  botSignal: SignalEvidence|null;
  sessionResets: Record<string,number>;
  trades: TradeRecord[];
  metrics: PerformanceMetrics;
  risk: RiskManager;
  riskSnapshot: RiskSnapshot;
  log: LogEntry[];
  busy: string | null;
  balanceStatus: BalanceStatus;
  balanceMessage: string;

  rankings: MarketRanking[];

  /**
   * Run drawer state. Deriv Bot keeps Summary / Transactions / Journal in a
   * fixed-width drawer on the right of the workspace rather than on separate
   * routes, so the tab and its open/closed state are UI state, not navigation.
   */
  runPanelOpen: boolean;
  runPanelTab: RunPanelTab;
  /**
   * Bot starts since the stats were last reset, for the Summary panel's
   * "No. of runs" tile. Incremented only on a successful start — a resume does
   * not count, which matches Deriv's definition of a run.
   */
  botRuns: number;
  /** The Quick Strategy wizard is a modal in Deriv Bot, launched from the builder. */
  quickStrategyOpen: boolean;
}

const MAX_QUOTES = 1200;

/**
 * Tick subscriptions are disposed imperatively, not rendered, so the handle lives outside the
 * store. Keeping it in reactive state would cause a new object identity on every tick.
 */
let disposeTicks: (() => void) | null = null;

function entropy(digits: number[]): number {
  if (digits.length === 0) return 0;
  const counts = new Array(10).fill(0);
  for (const d of digits) if (d >= 0 && d <= 9) counts[d]++;
  let h = 0;
  for (const c of counts) {
    if (c > 0) {
      const p = c / digits.length;
      h -= p * Math.log2(p);
    }
  }
  return h / Math.log2(10); // normalised to 0..1
}

const PREF_LOGINID = 'ut_pref_loginid';
let modeRevision = 0;
let settingsRevision = 0;
let settingsSave: Promise<void> = Promise.resolve();
let hydration: Promise<void> | null = null;
let upkeepStarted = false;
let stopBalances: (() => void) | null = null;
const lastBalances = new Map<string, BalanceUpdate>();
let staleRetry: ReturnType<typeof setTimeout> | null = null;
function scheduleStaleRetry() {
  if (staleRetry) return;
  staleRetry = setTimeout(() => {
    staleRetry = null;
    void useApp.getState().refreshSession(false);
  }, 30000);
}

export const useApp = create<State & Actions>()((set, get) => ({
  hydrated: false,
  settings: DEFAULT_SETTINGS,
  session: null,
  accounts: [],
  oauthConfigured: false,
  redirectUri: '',
  appId: DERIV_APP_ID,

  provider: null,
  connectionStatus: 'idle',
  tradingLoginid: null,
  tradingMessage: null,
  tradingConnecting: false,
  symbols: [],
  activeSymbol: 'R_100',
  quotes: [],
  digits: [],
  pipSize: 2,
  dataSource: 'none',
  marketLoading: false,
  marketError: null,

  strategies: [],
  activeStrategyId: null,
  bot: null,
  botState: 'idle',
  botDetail: '',
  execution: null, executionJournal: [], botSignal: null, sessionResets: {},
  trades: [],
  metrics: computeMetrics([], 0),
  risk: new RiskManager(DEFAULT_SETTINGS.limits, DEFAULT_SETTINGS.recovery, 0),
  riskSnapshot: new RiskManager().getSnapshot(),
  log: [],
  busy: null,
  balanceStatus: 'stale',
  balanceMessage: 'Balances are last known until a live update arrives.',
  rankings: [],
  runPanelOpen: false,
  runPanelTab: 'summary',
  botRuns: 0,
  quickStrategyOpen: false,

  /* ---------------------------------------------------------- lifecycle */

  async hydrate() {
    if (get().hydrated) return;
    if (hydration) return hydration;
    hydration = (async()=>{
    const revision = identityRevision();
    const readSettingsRevision = settingsRevision;
    const storedSettings = await loadSettings();
    const strategies = await listStrategies();
    const trades = await listTrades();
    const executionJournal=await loadExecutionJournal();
    const sessionResets=await loadSessionResets();
    const settings = revision===identityRevision() && readSettingsRevision===settingsRevision?storedSettings:get().settings;
    const risk = new RiskManager(settings.limits, settings.recovery, 0);
    set({
      settings,
      strategies: strategies.length ? strategies : [createStrategy({ name: 'Starter — odd digit' })],
      trades, executionJournal, sessionResets,
      metrics: computeMetrics(trades, 0),
      risk,
      riskSnapshot: risk.getSnapshot(),
      hydrated: true,
    });
    get().pushLog('info', 'Local store hydrated from IndexedDB.');
    await get().loadConfig();
    if((typeof window!=='undefined'&&window.location.pathname==='/callback')||revision!==identityRevision()){get().startUpkeep();return;}
    // Boot reads the cookie only (no Deriv round-trip): a slow or failed Deriv call
    // must never gate navigation or look like a logout. Revalidation happens in the
    // background upkeep loop instead.
    await get().refreshSession(false, { revalidate: false });
    get().startUpkeep();
    // The server cookie is authoritative. A stale local Demo preference from a
    // previous login must not override a fresh login's Real default. Explicit
    // switching already persists the choice in this cookie.
    const active = get().session?.loginid ?? null;
    const activeRow = active ? get().accounts.find((a) => a.loginid === active) : null;
    const mode = activeRow ? (activeRow.isVirtual ? 'deriv_demo' : 'deriv_real') : get().settings.mode;
    await get().applyMode(mode, true);
    })();
    try { await hydration; } finally { hydration = null; }
  },

  async loadConfig() {
    try {
      const r = await fetch('/api/deriv/config', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      set({ appId: j.appId, oauthConfigured: !!j.oauth?.configured, redirectUri: j.oauth?.redirectUri ?? '' });
    } catch {
      /* config is advisory; market data works without any server secret */
    }
  },

  pushLog(level: LogEntry['level'], text: string) {
    set((s) => ({ log: [{ at: Date.now(), level, text }, ...s.log].slice(0, 400) }));
  },

  setRunPanelOpen(open: boolean) {
    set({ runPanelOpen: open });
  },

  setRunPanelTab(tab: RunPanelTab) {
    set({ runPanelTab: tab, runPanelOpen: true });
  },

  openQuickStrategy() {
    set({ quickStrategyOpen: true });
  },

  closeQuickStrategy() {
    set({ quickStrategyOpen: false });
  },

  clearLog() {
    set({ log: [] });
  },

  async setSettings(patch: Partial<AppSettings>) {
    settingsRevision++;
    const next = { ...get().settings, ...patch };
    // The risk manager is the single source of truth for limits; keep it in sync.
    next.limits = { ...next.limits, realTradingAcknowledged: next.realTradingAcknowledged };
    if(!next.limits.tradingEnabled&&['starting','running','paused'].includes(get().botState))get().stopBot('Trading permission disabled; accepted contracts may still settle.');
    set({ settings: next });
    get().risk.limits = get().bot ? effectiveStrategyLimits(next.limits, get().bot!.strategy) : next.limits;
    get().risk.recovery = next.recovery;
    set({ riskSnapshot: get().risk.getSnapshot() });
    const write = settingsSave.catch(()=>{}).then(()=>saveSettings(next));
    settingsSave = write;
    await write;
  },

  /* ---------------------------------------------------------- connection */

  startBalanceStream() {
    if (stopBalances || !get().session) return;
    stopBalances = watchClassicBalances((updates) => {
      if (!get().session) return;
      for (const u of updates) lastBalances.set(u.loginid, u);
      const active = lastBalances.get(get().session!.loginid);
      set({
        accounts: get().accounts.map((a) => ({ ...a, ...lastBalances.get(a.loginid) })),
        session: active ? { ...get().session!, balance: active.balance, currency: active.currency, balanceKnown: true } : get().session,
      });
    }, (balanceStatus, balanceMessage) => set({ balanceStatus, balanceMessage: balanceMessage ?? '' }));
  },

  stopBalanceStream() {
    stopBalances?.(); stopBalances = null; lastBalances.clear();
    set({ balanceStatus: 'stale', balanceMessage: 'Balance stream disconnected.' });
  },

  startUpkeep() {
    if (upkeepStarted || typeof window === 'undefined') return;
    upkeepStarted = true;
    const tick = () => {if(!useApp.getState().busy)void useApp.getState().refreshSession(false);};
    window.setInterval(tick, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') tick();
    });
    window.addEventListener('online', tick);
    window.addEventListener('storage', (event) => {
      if (event.key !== PREF_LOGINID) return;
      const previous = useApp.getState().session?.loginid;
      void useApp.getState().refreshSession(false, { revalidate: false }).then(() => {
        const current = useApp.getState();
        if (current.session && current.session.loginid !== previous) {
          void current.applyMode(current.session.isVirtual ? 'deriv_demo' : 'deriv_real');
        }
      });
    });
  },

  async refreshSession(notify = true, opts?: { revalidate?: boolean }) {
    let revision=identityRevision();
    try {
      const r = await fetch(opts?.revalidate === false ? '/api/deriv/session' : '/api/deriv/session?refresh=1', {
        cache: 'no-store',
      });
      const j = await r.json();
      if(revision!==identityRevision())return;
      if (j.authenticated && j.session) {
        const had = get().session;
        if(had&&had.loginid!==j.session.loginid)revision=changeIdentity();
        const newest = lastBalances.get(j.session.loginid);
        set({ session: newest ? { ...j.session, balance: newest.balance, currency: newest.currency, balanceKnown: true } : j.session as AuthSession });
        if (notify) get().pushLog('ok', `Session active: ${j.session.loginid} (${j.session.currency})`);
        if (!had || had.loginid !== j.session.loginid) {
          get().rebaseToAccount();
          try { localStorage.setItem(PREF_LOGINID, j.session.loginid); } catch { /* private mode */ }
        }
        if (had && had.loginid !== j.session.loginid && get().provider) {
          const mode = j.session.isVirtual ? 'deriv_demo' : 'deriv_real';
          get().stopBalanceStream();
          await get().setSettings({ mode, realTradingAcknowledged: false, acknowledgedAccountLoginid: null,
            limits: { ...get().settings.limits, realTradingAcknowledged: false } });
          void get().applyMode(mode, false).catch((e:Error)=>get().pushLog('warn',e.message));
        }
        if (j.stale) {
          // Deriv was unreachable during revalidation: stay signed in, retry soon.
          get().pushLog('info', 'Deriv could not be reached to revalidate; staying signed in and retrying.');
          scheduleStaleRetry();
        }
      } else if (j.authenticated === false && (r.ok || r.status === 401)) {
        get().stopBalanceStream();
        get().stopBot('session ended');
        get().provider?.disconnect();
        set({ session: null, accounts: [],runPanelOpen:false });
        if (notify && j.reason) {
          get().pushLog(
            'warn',
            j.reason === 'expired'
              ? 'Your Deriv session expired or was revoked - sign in again.'
              : `Session not active: ${j.reason}`,
          );
        }
      }
      if (j.authenticated !== true) return;
      let rows:AccountSummary[]|undefined=j.accounts;
      if(!Array.isArray(rows)){
        const a=await fetch('/api/deriv/accounts?cached=1',{cache:'no-store'});
        const aj=a.ok?await a.json():null;rows=aj?.accounts;
      }
      if(revision!==identityRevision())return;
      if(Array.isArray(rows)){
        set({accounts:rows.map((a)=>({...a,...lastBalances.get(a.loginid)}))});
        const real=rows.find((a)=>!a.isVirtual);
        if(j.preferReal&&real&&get().session?.isVirtual)await get().selectAccount(real.loginid,{silent:true});
      }
    } catch (e) {
      if (notify) get().pushLog('error', `Session refresh failed: ${(e as Error).message}`);
    }
  },

  async createOptionsAccount(accountType: 'demo' | 'real'): Promise<{ ok: boolean; message: string }> {
    set({ busy: 'create-options' });
    try {
      const r = await fetch('/api/deriv/accounts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountType }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        const msg = j.message ?? `Deriv refused the request (HTTP ${r.status}).`;
        get().pushLog('error', `Options account creation failed: ${msg}`);
        return { ok: false, message: msg };
      }
      set({ session: j.session as AuthSession, accounts: (j.accounts ?? []) as AccountSummary[] });
      get().pushLog('ok', `Options account created: ${j.session.loginid} (${accountType}).`);
      get().rebaseToAccount();
      if (accountType === 'demo') await get().applyMode('deriv_demo', false);
      return { ok: true, message: `Connected as ${j.session.loginid}` };
    } finally {
      set({ busy: null });
    }
  },

  async finishAuthentication(result: {session:AuthSession;accounts?:AccountSummary[]}):Promise<{ok:boolean;message:string;demoAvailable?:boolean}>{
    const revision=changeIdentity();
    set({busy:'auth'});
    try{
      const session=result.session,accounts=result.accounts??[];
      if(revision!==identityRevision())return {ok:false,message:'Account choice changed while signing in.'};
      set({session,accounts,tradingLoginid:null});
      get().rebaseToAccount();
      const mode=session.isVirtual?'deriv_demo':'deriv_real';
      await get().setSettings({mode,realTradingAcknowledged:false,acknowledgedAccountLoginid:null,limits:{...get().settings.limits,realTradingAcknowledged:false}});
      // Account selection is complete: history, rankings and sockets are background work.
      void get().applyMode(mode,false).catch((e:Error)=>get().pushLog('warn',e.message));
      if(!session.loginid)return {ok:false,message:accountDiscoveryMessage(session.accountDiagnostics)};
      if(session.isVirtual)return {ok:false,demoAvailable:true,message:accountDiscoveryMessage(session.accountDiagnostics) + ' You may explicitly choose the returned Demo account.'};
      return {ok:true,message:`Connected as ${session.loginid} (Real).`};
    }finally{if(revision===identityRevision())set({busy:null});}
  },

  async connectWithPat(token: string): Promise<{ ok: boolean; message: string }> {
    get().stopBalanceStream();
    changeIdentity();
    set({ busy: 'pat' });
    try {
      const r = await sessionWrite(()=>fetch('/api/deriv/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }));
      const j = await r.json();
      if (!r.ok || !j.ok) {
        const msg = j.message ?? `Deriv rejected the token (HTTP ${r.status}).`;
        get().pushLog('error', `PAT login failed: ${msg}`);
        return { ok: false, message: msg };
      }
      return await get().finishAuthentication(j);
    } catch (e) {
      const msg = (e as Error).message;
      get().pushLog('error', `PAT login error: ${msg}`);
      return { ok: false, message: msg };
    } finally {
      set({ busy: null });
    }
  },

  async startOAuth(signup = false): Promise<{ ok: boolean; message: string }> {
    set({ busy: 'oauth' });
    try {
      const r = await fetch(`/api/deriv/oauth/start${signup ? '?signup=1' : ''}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j.authorizeUrl) {
        const msg = j.message ?? 'Could not start the OAuth flow.';
        get().pushLog('error', msg);
        return { ok: false, message: msg };
      }
      get().pushLog('info', 'Redirecting to Deriv authorization…');
      window.location.assign(j.authorizeUrl);
      return { ok: true, message: 'Redirecting…' };
    } catch (e) {
      const msg = (e as Error).message;
      get().pushLog('error', `OAuth start failed: ${msg}`);
      return { ok: false, message: msg };
    } finally {
      set({ busy: null });
    }
  },

  async disconnect(): Promise<void> {
    changeIdentity();
    get().stopBalanceStream();
    get().stopBot('disconnected');
    try {
      await sessionWrite(()=>fetch('/api/deriv/oauth/logout', { method: 'POST' }));
    } catch {
      /* best effort */
    }
    set({ session: null, accounts: [],runPanelOpen:false });
    try { localStorage.removeItem(PREF_LOGINID); } catch { /* private mode */ }
    get().pushLog('warn', 'Disconnected. The local session cookie was cleared; revoke the token at Deriv if you want it dead server-side.');
    await get().applyMode('deriv_demo', false);
  },

  /** Switch the active account (demo vs real). Real requires acknowledgement.
   *  The choice is persisted server-side (session cookie) AND as a local pref, so
   *  every route, reload and tab agrees on the active account. */
  async selectAccount(loginid: string, opts?: { silent?: boolean }): Promise<{ ok: boolean; message: string }> {
    if (get().bot?.hasPendingOrder() || ['starting', 'running', 'paused', 'stopping'].includes(get().botState)) return { ok: false, message: 'Stop the bot before switching accounts.' };
    const acct = get().accounts.find((a) => a.loginid === loginid);
    if (!acct) return { ok: false, message: 'Unknown account. Sync balances or sign in again.' };
    if (get().busy&&get().busy!=='sync-balances') return { ok: false, message: 'Another account operation is in progress.' };
    const revision=changeIdentity();
    set({ busy: 'switch-account' });
    try {
    // Viewing a real account is not permission to place real-money orders.
    // Execution remains gated by the socket and risk controls.
    const r = await sessionWrite(()=>fetch('/api/deriv/session/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginid }),
    }));
    const j = (await r.json().catch(() => null)) as {
      ok?: boolean;
      message?: string;
      session?: AuthSession;
      accounts?: AccountSummary[];
    } | null;
    if(revision!==identityRevision())return {ok:false,message:'A newer account choice superseded this response.'};
    if (!r.ok || !j?.ok || !j.session) {
      const msg = j?.message ?? `Switch failed (HTTP ${r.status}).`;
      if (!opts?.silent) get().pushLog('error', msg);
      return { ok: false, message: msg };
    }
    get().provider?.disconnect();
    const latestBalance = lastBalances.get(loginid);
    set({ session: latestBalance ? { ...j.session, balance: latestBalance.balance, currency: latestBalance.currency, balanceKnown: true } : j.session,
      accounts: ((j.accounts ?? get().accounts) as AccountSummary[]).map((a) => ({ ...a, ...lastBalances.get(a.loginid) })) });
    try {
      localStorage.setItem(PREF_LOGINID, loginid);
    } catch {
      /* private mode: pref is best-effort */
    }
    const acknowledged = get().settings.acknowledgedAccountLoginid === loginid && get().settings.realTradingAcknowledged;
    await get().setSettings({ mode: acct.isVirtual ? 'deriv_demo' : 'deriv_real', realTradingAcknowledged: acknowledged, acknowledgedAccountLoginid: acknowledged ? loginid : null, limits: { ...get().settings.limits, realTradingAcknowledged: acknowledged } });
    void get().applyMode(acct.isVirtual ? 'deriv_demo' : 'deriv_real', false).catch((e:Error)=>get().pushLog('warn',e.message));
    get().rebaseToAccount();
    if (!opts?.silent) {
      get().pushLog('ok', `Active account: ${loginid} (${acct.balance.toFixed(2)} ${acct.currency}).`);
    }
    return { ok: true, message: `Switched to ${loginid}` };
    } catch (e) {
      return { ok: false, message: `Account switch failed: ${(e as Error).message}` };
    } finally {
      if(revision===identityRevision())set({ busy: null });
    }
  },

  /** Refresh every available account source, not just a non-empty Options list. */
  async syncBalances(): Promise<{ ok: boolean; message: string }> {
    if (!get().session) return { ok: false, message: 'Connect a Deriv account first.' };
    if (get().busy) return { ok: false, message: 'Another account operation is in progress.' };
    const loginid = get().session!.loginid;
    const revision=identityRevision();
    set({ busy: 'sync-balances' });
    try {
      const response = await fetch('/api/deriv/accounts', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      const listing = await response.json();
      if (revision!==identityRevision()||get().session?.loginid !== loginid) return { ok: false, message: 'Account changed during discovery.' };
      if (!response.ok || !listing?.ok) return {ok:false,message:listing?.message ?? 'Deriv account refresh failed. Your selected account is unchanged.'};
      if (Array.isArray(listing.accounts) && listing.accounts.length) {
        set({accounts: (listing.accounts as AccountSummary[]).map((a)=>({...a,...lastBalances.get(a.loginid)}))});
      }
      if (listing.diagnostics && get().session) set({session:{...get().session!,accountDiagnostics:listing.diagnostics}});
      if (!get().accounts.length) return {ok:false,message:listing.message ?? accountDiscoveryMessage(listing.diagnostics)};
      return {ok:true,message:listing.cached ? 'Known accounts retained. Deriv returned no current Options rows; see connection details.' : 'Account list refreshed from Deriv.'};
    } catch (e) {
      return { ok: false, message: `Listed accounts retained. Additional discovery failed: ${(e as Error).message}` };
    } finally {
      if(get().busy==='sync-balances')set({ busy: null });
    }
  },

  /* ---------------------------------------------------------- market data */

  async applyMode(mode: AccountMode, initial = false): Promise<void> {
    const revision = ++modeRevision;
    const cur = get();
    if(cur.settings.mode!==mode)await get().setSettings({mode});
    // Tear down any running bot and the old provider before switching provenance.
    cur.stopBot(`mode changed to ${mode}`);
    cur.provider?.disconnect();

    set({ dataSource: 'deriv_live', connectionStatus: 'connecting', tradingLoginid: null, tradingMessage: null, tradingConnecting: false, marketError: null });

    // Public market data works with NO credential, so load that first: the charts are useful
    // even before the user connects an account.
    const publicProvider = new DerivProvider(mode);
    set({ provider: publicProvider });
    try {
      await publicProvider.connect();
      if(revision!==modeRevision){publicProvider.disconnect();return;}
      set({ connectionStatus: 'open' });
      await get().loadMarket(initial);
      get().pushLog('ok', `Connected to Deriv public market data (${mode}).`);
    } catch (e) {
      if(revision!==modeRevision)return;
      // No fallback: a Deriv tool without Deriv shows an error, not invented prices.
      set({ connectionStatus: 'error', marketError: (e as Error).message });
      get().pushLog('error', `Deriv market-data connection failed: ${(e as Error).message}`);
      get().pushLog('warn', 'Charts and statistics stay empty until the connection to Deriv succeeds.');
      return;
    }

    if (!get().session) {
      get().pushLog('warn', 'Market data is live, but no account is connected. Trading is disabled until you connect.');
      return;
    }
    if(revision!==modeRevision)return;
    await get().attachTradingSocket(mode);
  },

  /** Exchange the server-held token for an OTP socket so the bot can trade. */
  async attachTradingSocket(mode: 'deriv_demo' | 'deriv_real'): Promise<void> {
    const loginid = get().session?.loginid;
    if (!loginid || get().tradingConnecting) return;
    if(get().bot?.hasPendingOrder()||['starting','running','paused','stopping'].includes(get().botState))return;
    const revision = modeRevision;
    const current = () => revision===modeRevision&&get().session?.loginid===loginid;
    if(mode!==(get().session!.isVirtual?'deriv_demo':'deriv_real'))return;
    let candidate:DerivProvider|null=null;
    set({tradingConnecting:true,tradingMessage:'Connecting the selected account and verifying its broker balance…'});
    try {
      const r = await fetch('/api/deriv/socket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginid, allowReal: mode === 'deriv_real' && get().settings.realTradingAcknowledged && get().settings.acknowledgedAccountLoginid === loginid }),
      });
      const j = await r.json();
      if(!current())return;
      if (!r.ok || !j.ok) {
        set({tradingMessage:j.message??`Trading channel failed (HTTP ${r.status}).`,tradingLoginid:null});
        get().pushLog('warn', `Trading socket unavailable: ${j.message ?? r.status}. Market data still works; trading stays disabled.`);
        return;
      }
      if (get().session?.loginid !== loginid) return;
      if (!j.url || j.loginid!==loginid || j.mode!==mode) throw new Error('Deriv returned an incomplete or mismatched account socket. Reconnect this selected account.');
      const prev = get().provider;
      let firstUrl: string | null = j.url ?? null;
      const authed = new DerivProvider(mode, {
        urlFactory: async () => {
          if (get().session?.loginid !== loginid) throw new Error('Account changed');
          if (firstUrl) { const url = firstUrl; firstUrl = null; return url; }
          const response = await fetch('/api/deriv/socket', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ loginid, allowReal: mode === 'deriv_real' && get().settings.realTradingAcknowledged && get().settings.acknowledgedAccountLoginid === loginid }),
          });
          const fresh = await response.json();
          if (!response.ok || !fresh.url) throw new Error(fresh.message ?? 'Could not renew trading socket');
          return fresh.url as string;
        },
        onStatus: (s) => { if (get().provider === authed) set({ connectionStatus: s, ...(s !== 'open' ? { tradingLoginid: null } : {}) }); },
      });
      candidate=authed;
      await authed.connect();
      if (!current() || get().provider!==prev) { authed.disconnect(); return; }
      let verified:{balance:number;currency:string}|null=null;
      const acceptBalance=(balance:number,currency:string)=>{
        verified={balance,currency};
        if (!current() || get().provider!==authed) return;
        set({ tradingLoginid:loginid,tradingMessage:null,session:{...get().session!,balance,currency,balanceKnown:true},
          accounts:get().accounts.map(a=>a.loginid===loginid?{...a,balance,currency}:a) });
      };
      await authed.streamBalance(acceptBalance,{loginid,currency:get().session!.currency});
      if (!current() || get().provider!==prev) { authed.disconnect(); return; }
      if (!verified || !authed.isConnected()) throw new Error('Deriv did not confirm the selected account balance. No bot was started.');
      prev?.disconnect();
      set({provider:authed,connectionStatus:'open'});
      acceptBalance((verified as {balance:number;currency:string}).balance,(verified as {balance:number;currency:string}).currency);
      await get().subscribeTicks(get().activeSymbol);
      get().pushLog('ok', `Authenticated trading socket open for ${loginid} (${j.mode}).`);
    } catch (e) {
      candidate?.disconnect();
      if(current()){set({tradingMessage:(e as Error).message,tradingLoginid:null});get().pushLog('error', `Trading socket error: ${(e as Error).message}`);}
    }finally{if(current())set({tradingConnecting:false});}
  },

  async loadMarket(initial = false): Promise<void> {
    const { provider, activeSymbol } = get();
    if (!provider) return;
    set({ marketLoading: true, marketError: null });
    try {
      const hist = await provider.history(activeSymbol, 800);
      if(provider!==get().provider||activeSymbol!==get().activeSymbol)return;
      set({
        quotes: hist.slice(-MAX_QUOTES),
        digits: hist.map((q) => q.digit),
        pipSize: hist[0]?.pipSize ?? 2,
        marketLoading: false,
      });
      if (!initial) get().pushLog('info', `Loaded ${hist.length} historical ticks for ${activeSymbol}.`);
      await get().subscribeTicks(activeSymbol);
      if (provider instanceof DerivProvider) void get().loadSymbols();
    } catch (e) {
      if(provider!==get().provider||activeSymbol!==get().activeSymbol)return;
      set({ marketLoading: false, marketError: (e as Error).message });
      get().pushLog('error', `Market load failed: ${(e as Error).message}`);
    }
  },

  async loadSymbols(): Promise<void> {
    const provider = get().provider;
    if (!(provider instanceof DerivProvider)) return;
    try {
      const symbols = await provider.activeSymbols('synthetic_index');
      set({ symbols });
      get().pushLog('info', `Discovered ${symbols.length} synthetic markets from Deriv.`);
      void get().rankMarkets(symbols);
    } catch (e) {
      get().pushLog('warn', `Symbol discovery failed: ${(e as Error).message}`);
    }
  },

  /**
   * Rank markets from ACTUAL collected data.
   *
   * Methodology, stated plainly because it is easy to over-claim here:
   *  - digitEntropy measures how close the observed last-digit distribution is to uniform over
   *    the sample. A value near 1.0 means the sample looks like a fair 1-in-10 draw.
   *  - meanAbsMovePips is realised per-tick movement, a volatility proxy useful for choosing
   *    a market that matches a strategy's duration.
   *  - cadence reflects the instrument family (1s indices tick faster).
   *  - score is a deterministic composite used only to ORDER the list.
   * None of these forecast the next digit. Observed regularity in a finite sample is not
   * evidence of future predictability, and the UI says so wherever a ranking is shown.
   */
  async rankMarkets(symbols?: ActiveSymbol[]): Promise<void> {
    const provider = get().provider;
    const list = symbols ?? get().symbols;
    if (!provider || list.length === 0) return;
    const out: MarketRanking[] = [];
    // Sample a bounded subset so ranking never hammers the API.
    const sample = list.filter((s) => s.exchange_is_open === 1).slice(0, 14);
    for (const s of sample) {
      if(get().provider!==provider)break;
      try {
        const hist = await provider.history(s.underlying_symbol, 300);
        const digits = hist.map((q) => q.digit);
        let moves = 0;
        for (let i = 1; i < hist.length; i++) moves += Math.abs(hist[i].price - hist[i - 1].price);
        const pipValue = Math.pow(10, -(hist[0]?.pipSize ?? 2));
        const meanAbsMovePips = hist.length > 1 ? moves / (hist.length - 1) / pipValue : 0;
        const ent = entropy(digits);
        const fast = s.underlying_symbol.startsWith('1HZ');
        const score = Number((ent * 0.6 + Math.min(meanAbsMovePips / 10, 1) * 0.3 + (fast ? 0.1 : 0.05)).toFixed(4));
        out.push({
          symbol: s.underlying_symbol,
          name: s.underlying_symbol_name,
          sample: digits.length,
          digitEntropy: Number(ent.toFixed(4)),
          cadence: fast ? 'fast' : 'normal',
          meanAbsMovePips: Number(meanAbsMovePips.toFixed(3)),
          open: s.exchange_is_open === 1 && s.is_trading_suspended !== 1,
          score,
        });
      } catch {
        /* skip unreachable markets rather than failing the whole ranking */
      }
    }
    out.sort((a, b) => b.score - a.score);
    set({ rankings: out });
    get().pushLog('info', `Ranked ${out.length} markets from ${out.reduce((a, r) => a + r.sample, 0)} collected ticks.`);
  },

  async selectSymbol(symbol: string): Promise<void> {
    const cur = get();
    cur.stopBot(`market changed to ${symbol}`);
    set({ activeSymbol: symbol, quotes: [], digits: [] });
    await get().loadMarket(false);
  },

  async subscribeTicks(symbol: string): Promise<void> {
    const provider = get().provider;
    if (!provider) return;
    if (disposeTicks) {
      disposeTicks();
      disposeTicks = null;
    }
    try {
      disposeTicks = await provider.stream(symbol, (q) => {
        const s = get();
        set({
          quotes: [...s.quotes, q].slice(-MAX_QUOTES),
          digits: [...s.digits, q.digit].slice(-5000),
          pipSize: q.pipSize,
        });
      });
    } catch (e) {
      get().pushLog('warn', `Tick subscription failed: ${(e as Error).message}`);
    }
  },

  /* ---------------------------------------------------------- strategies */

  async saveStrategy(s: Strategy): Promise<{ ok: boolean; message: string }> {
    const v = validateStrategy(s);
    if (!v.valid) {
      get().pushLog('error', `Strategy "${s.name}" is invalid: ${v.errors[0]}`);
      return { ok: false, message: v.errors.join(' · ') };
    }
    const existing = get().strategies.find((x) => x.id === s.id);
    const stored: Strategy = existing
      ? { ...s, version: existing.version + 1, createdAt: existing.createdAt, updatedAt: Date.now() }
      : { ...s, version: 1, createdAt: Date.now(), updatedAt: Date.now() };
    await saveStrategy(stored);
    set((st) => ({
      strategies: st.strategies.some((x) => x.id === stored.id)
        ? st.strategies.map((x) => (x.id === stored.id ? stored : x))
        : [stored, ...st.strategies],
      activeStrategyId: st.activeStrategyId ?? stored.id,
    }));
    get().pushLog('ok', `Saved "${stored.name}" v${stored.version}${v.warnings.length ? ` (${v.warnings.length} warning(s))` : ''}.`);
    return { ok: true, message: `Saved v${stored.version}` };
  },

  async deleteStrategy(id: string): Promise<void> {
    get().stopBot('strategy deleted');
    await removeStoredStrategy(id);
    set((s) => ({
      strategies: s.strategies.filter((x) => x.id !== id),
      activeStrategyId: s.activeStrategyId === id ? null : s.activeStrategyId,
    }));
    get().pushLog('warn', 'Strategy deleted.');
  },

  setActiveStrategy(id: string | null) {
    set({ activeStrategyId: id });
  },

  /* ---------------------------------------------------------- bot control */

  /** Called ONLY by the explicit account/stake confirmation, never by login or a timer. */
  async authorizeConfirmedRun(loginid: string, acknowledgeReal: boolean) {
    const session = get().session;
    const revision = identityRevision();
    if (!loginid || session?.loginid !== loginid) return {ok:false,message:'The selected account changed. Review the account and confirm again.'};
    if (get().bot?.hasPendingOrder() || ['starting','running','paused','stopping'].includes(get().botState)) return {ok:false,message:'Stop the active bot and wait for settlement before starting another.'};
    const real = !session.isVirtual;
    const alreadyAcknowledged = get().settings.realTradingAcknowledged && get().settings.acknowledgedAccountLoginid === loginid;
    if (real && !alreadyAcknowledged && !acknowledgeReal) return {ok:false,message:'Acknowledge the real-money risk for this selected account before confirming.'};
    await get().setSettings({
      limits:{...get().settings.limits,tradingEnabled:true},
      ...(real ? {realTradingAcknowledged:true,acknowledgedAccountLoginid:loginid} : {}),
    });
    if (revision!==identityRevision() || get().session?.loginid!==loginid) return {ok:false,message:'Account changed during confirmation. No bot was started.'};
    if (get().tradingConnecting && get().tradingLoginid !== loginid) await new Promise<void>((resolve)=>{
      let unsubscribe=()=>{};
      const finish=()=>{clearTimeout(timer);unsubscribe();resolve();};
      const timer=setTimeout(finish,8000);
      unsubscribe=useApp.subscribe((state)=>{if(state.session?.loginid!==loginid || state.tradingLoginid===loginid || !state.tradingConnecting || !state.settings.limits.tradingEnabled)finish();});
    });
    if (get().tradingLoginid !== loginid && !get().tradingConnecting) await get().attachTradingSocket(real?'deriv_real':'deriv_demo');
    if (revision!==identityRevision() || get().session?.loginid!==loginid) return {ok:false,message:'Account changed while verifying its connection. No bot was started.'};
    if (!get().settings.limits.tradingEnabled) return {ok:false,message:'Trading permission was turned off. No bot was started.'};
    if (real && (!get().settings.realTradingAcknowledged || get().settings.acknowledgedAccountLoginid!==loginid)) return {ok:false,message:'Real permission was revoked. No bot was started.'};
    if (get().tradingLoginid!==loginid) return {ok:false,message:get().tradingMessage ?? 'Deriv has not verified a trading connection for this account.'};
    return {ok:true,message:'Trading permission enabled and account channel verified.'};
  },

  async runStrategy(id: string): Promise<{ ok: boolean; message: string }> {
    const s = get().strategies.find((x) => x.id === id);
    if (!s) return { ok: false, message: 'Strategy not found.' };

    const v = validateStrategy(s);
    if (!v.valid) return { ok: false, message: v.errors.join(' · ') };

    const provider = get().provider;
    if (!provider) return { ok: false, message: 'No market provider is connected.' };
    if (!provider.isConnected()) {
      return { ok: false, message: 'Provider is not connected. Reconnect before running a bot.' };
    }

    const mode = get().settings.mode;
    if (!get().session?.loginid) {
      return {
        ok: false,
        message: 'No Deriv account is connected. Connect a demo or real account before running a bot — this tool trades only on Deriv.',
      };
    }
    if (provider.mode !== (get().session!.isVirtual ? 'deriv_demo' : 'deriv_real') || mode !== provider.mode) return { ok: false, message: 'The account environment and trading provider do not match. Reconnect before running.' };
    if (s.currency !== get().session!.currency) return { ok: false, message: 'Strategy currency does not match the selected account. Review the setup.' };
    if (get().tradingLoginid !== get().session?.loginid) {
      return { ok: false, message: `No verified trading connection for ${get().session!.loginid}. ${get().tradingMessage??(get().session!.isVirtual?'Reconnect the Demo trading channel; Real acknowledgement is not required.':'Reconnect and confirm Real-money permission for this account.')}` };
    }
    if (!get().settings.limits.tradingEnabled) {
      return { ok: false, message: 'Trading is disabled. Enable it in Risk settings — the bot refuses to run otherwise.' };
    }
    if (mode === 'deriv_real' && (!get().settings.realTradingAcknowledged || get().settings.acknowledgedAccountLoginid !== get().session?.loginid)) {
      return { ok: false, message: 'Real-money trading is not acknowledged. Confirm it in Risk settings.' };
    }
    if (get().bot?.hasPendingOrder() || ['starting','running','paused','stopping'].includes(get().botState)) {
      return { ok: false, message: 'A bot is already running. Stop it first — only one bot runs at a time to prevent duplicate orders.' };
    }

    const startingBalance = get().session?.balance ?? 0;
    const risk = new RiskManager(effectiveStrategyLimits(get().settings.limits, s), s.progression ? { ...s.recovery, enabled: false } : s.recovery, startingBalance);

    const bot = new TradingBot(s, provider, risk, {
      onSignal:(e)=>set({botSignal:e}),
      onExecution:(e)=>{
        const previous=get().execution;
        set({execution:e});
        if(previous?.phase!==e.phase||previous?.contractId!==e.contractId||previous?.detail!==e.detail){
          set({executionJournal:[e,...get().executionJournal].slice(0,500)});
          void appendExecutionEvent(e).catch(()=>get().pushLog('warn','Journal persistence failed; broker execution state remains visible.'));
        }
      },
      onStateChange: (st, detail) => {
        set({ botState: st, botDetail: detail ?? '' });
        if (st === 'halted' || st === 'error') get().pushLog('warn', `Bot ${st}: ${detail ?? ''}`);
        if (st === 'running') get().pushLog('ok', `Bot started: "${s.name}" v${s.version} on ${s.market} [${mode}]`);
        if (st === 'stopped') get().pushLog('info', `Bot stopped: ${detail ?? ''}`);
        set({ riskSnapshot: risk.getSnapshot() });
      },
      onTrade: (t) => {
        void appendTrades([t]).catch(()=>get().pushLog('warn','Trade persistence failed; export the current broker result.'));
        const trades = [t, ...get().trades].slice(0, 5000);
        set({ trades, metrics: computeMetrics(trades, startingBalance), riskSnapshot: risk.getSnapshot() });
        get().pushLog(
          t.error ? 'error' : t.won ? 'ok' : 'warn',
          t.error
            ? `TRADE ERROR ${t.symbol}: ${t.error}`
            : `${t.won ? 'WIN ' : 'LOSS'} ${t.symbol} ${t.contractType} stake ${t.stake.toFixed(2)} -> ${t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)} [${mode === 'deriv_real' ? 'REAL' : 'DEMO'}]`,
        );
      },
      onError: (e) => get().pushLog('error', e.message),
      onRisk: (d) => {
        if (!d.allowed && d.reasons.length) get().pushLog('warn', `Risk manager refused a trade: ${d.reasons.join(' ')}`);
      },
    }, startingBalance, {accountLoginid:get().session?.loginid});

    set({ bot, risk, riskSnapshot: risk.getSnapshot(), activeStrategyId: id, botState: 'starting', botDetail: '', botSignal:null, execution:null, runPanelOpen:true,runPanelTab:'summary' });
    try {
      await bot.start(800);
      if(bot.state!=='running')return {ok:false,message:'Bot start was cancelled or halted.'};
      set({ botRuns: get().botRuns + 1 });
      return { ok: true, message: 'Bot running.' };
    } catch (e) {
      const msg = (e as Error).message;
      set({ botState: 'error', botDetail: msg });
      get().pushLog('error', `Bot failed to start: ${msg}`);
      return { ok: false, message: msg };
    }
  },

  pauseBot() {
    get().bot?.pause();
  },
  resumeBot() {
    get().bot?.resume();
  },
  stopBot(reason = 'stopped by user') {
    const bot = get().bot;
    if (bot) {
      bot.stop(reason);
      set({ botState: bot.state, botDetail: reason });
    }
  },

  async resetSessionView(){
    if(get().bot?.hasPendingOrder()||['starting','running','paused','stopping'].includes(get().botState))return {ok:false,message:'Stop the bot and wait for its contract before resetting.'};
    const key=`${get().settings.mode}:${get().session?.loginid??'none'}`;
    const resets={...get().sessionResets,[key]:Date.now()};
    set({sessionResets:resets,execution:null,botSignal:null,bot:null,botState:'idle',botDetail:''});
    await saveSessionResets(resets);return {ok:true,message:'Session view reset. Historical transactions and journal are retained.'};
  },

  async clearTrades(): Promise<void> {
    if(get().bot?.hasPendingOrder()||['starting','running','paused','stopping'].includes(get().botState))throw new Error('Stop the bot and wait for settlement before clearing history.');
    const { clearTrades } = await import('@/lib/persistence/db');
    await clearTrades();
    // Resetting the stats also resets the run counter, exactly as Deriv Bot's
    // Reset button does — "No. of runs" is defined as runs since the last clear.
    const base = get().session?.balance ?? 0;
    set(() => ({ trades: [], botRuns: 0, metrics: computeMetrics([], base) }));
    get().risk.resetAll(base);
    set({ riskSnapshot: get().risk.getSnapshot() });
    get().pushLog('warn', 'Trade history cleared.');
  },

  /**
   * Point the risk manager and the equity statistics at the connected account's balance.
   * Drawdown and session-loss limits are percentages of real equity, so they must be
   * measured from the account Deriv reports, never from a stored or invented figure.
   */
  rebaseToAccount() {
    const base = get().session?.balance ?? 0;
    get().risk.resetAll(base);
    set({ metrics: computeMetrics(get().trades, base), riskSnapshot: get().risk.getSnapshot() });
  },

  resetRisk() {
    get().risk.resetSession();
    set({ riskSnapshot: get().risk.getSnapshot() });
    get().pushLog('info', 'Session risk counters reset.');
  },
}));

interface Actions {
  resetSessionView: () => Promise<{ok:boolean;message:string}>;
  hydrate: () => Promise<void>;
  loadConfig: () => Promise<void>;
  pushLog: (level: LogEntry['level'], text: string) => void;
  clearLog: () => void;
  setSettings: (patch: Partial<AppSettings>) => Promise<void>;
  refreshSession: (notify?: boolean, opts?: { revalidate?: boolean }) => Promise<void>;
  finishAuthentication: (result:{session:AuthSession;accounts?:AccountSummary[]}) => Promise<{ok:boolean;message:string;demoAvailable?:boolean}>;
  connectWithPat: (token: string) => Promise<{ ok: boolean; message: string }>;
  createOptionsAccount: (accountType: 'demo' | 'real') => Promise<{ ok: boolean; message: string }>;
  startOAuth: (signup?: boolean) => Promise<{ ok: boolean; message: string }>;
  disconnect: () => Promise<void>;
  selectAccount: (loginid: string, opts?: { silent?: boolean }) => Promise<{ ok: boolean; message: string }>;
  syncBalances: () => Promise<{ ok: boolean; message: string }>;
  startUpkeep: () => void;
  startBalanceStream: () => void;
  stopBalanceStream: () => void;
  applyMode: (mode: AccountMode, initial?: boolean) => Promise<void>;
  attachTradingSocket: (mode: 'deriv_demo' | 'deriv_real') => Promise<void>;
  loadMarket: (initial?: boolean) => Promise<void>;
  loadSymbols: () => Promise<void>;
  rankMarkets: (symbols?: ActiveSymbol[]) => Promise<void>;
  selectSymbol: (symbol: string) => Promise<void>;
  subscribeTicks: (symbol: string) => Promise<void>;
  saveStrategy: (s: Strategy) => Promise<{ ok: boolean; message: string }>;
  deleteStrategy: (id: string) => Promise<void>;
  setActiveStrategy: (id: string | null) => void;
  authorizeConfirmedRun: (loginid:string, acknowledgeReal:boolean) => Promise<{ok:boolean;message:string}>;
  runStrategy: (id: string) => Promise<{ ok: boolean; message: string }>;
  pauseBot: () => void;
  resumeBot: () => void;
  stopBot: (reason?: string) => void;
  clearTrades: () => Promise<void>;
  rebaseToAccount: () => void;
  resetRisk: () => void;
  setRunPanelOpen: (open: boolean) => void;
  setRunPanelTab: (tab: RunPanelTab) => void;
  openQuickStrategy: () => void;
  closeQuickStrategy: () => void;
}
