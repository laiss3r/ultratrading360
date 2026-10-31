'use client';

import { create } from 'zustand';
import type { AccountMode, ActiveSymbol, AuthSession } from '@/lib/deriv/types';
import { DERIV_APP_ID } from '@/lib/deriv/config';
import { DerivProvider, type MarketProvider, type Quote } from '@/lib/engine/provider';
import { RiskManager, type RiskSnapshot } from '@/lib/engine/risk';
import { TradingBot, type BotState, type TradeRecord } from '@/lib/engine/bot';
import { createStrategy, validateStrategy, type Strategy } from '@/lib/engine/strategies';
import { computeMetrics, type PerformanceMetrics } from '@/lib/metrics';
import {
  DEFAULT_SETTINGS,
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
  trades: TradeRecord[];
  metrics: PerformanceMetrics;
  risk: RiskManager;
  riskSnapshot: RiskSnapshot;
  log: LogEntry[];
  busy: string | null;

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
  trades: [],
  metrics: computeMetrics([], 0),
  risk: new RiskManager(DEFAULT_SETTINGS.limits, DEFAULT_SETTINGS.recovery, 0),
  riskSnapshot: new RiskManager().getSnapshot(),
  log: [],
  busy: null,
  rankings: [],
  runPanelOpen: true,
  runPanelTab: 'summary',
  botRuns: 0,
  quickStrategyOpen: false,

  /* ---------------------------------------------------------- lifecycle */

  async hydrate() {
    if (get().hydrated) return;
    const settings = await loadSettings();
    const strategies = await listStrategies();
    const trades = await listTrades();
    const risk = new RiskManager(settings.limits, settings.recovery, 0);
    set({
      settings,
      strategies: strategies.length ? strategies : [createStrategy({ name: 'Starter — odd digit' })],
      trades,
      metrics: computeMetrics(trades, 0),
      risk,
      riskSnapshot: risk.getSnapshot(),
      hydrated: true,
    });
    get().pushLog('info', 'Local store hydrated from IndexedDB.');
    await get().loadConfig();
    await get().refreshSession(false);
    await get().applyMode(settings.mode, true);
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
    const next = { ...get().settings, ...patch };
    // The risk manager is the single source of truth for limits; keep it in sync.
    next.limits = { ...next.limits, realTradingAcknowledged: next.realTradingAcknowledged };
    set({ settings: next });
    get().risk.limits = next.limits;
    get().risk.recovery = next.recovery;
    set({ riskSnapshot: get().risk.getSnapshot() });
    await saveSettings(next);
  },

  /* ---------------------------------------------------------- connection */

  async refreshSession(notify = true) {
    try {
      const r = await fetch('/api/deriv/session?refresh=1', { cache: 'no-store' });
      const j = await r.json();
      if (j.authenticated && j.session) {
        const had = get().session;
        set({ session: j.session as AuthSession });
        if (notify) get().pushLog('ok', `Session active: ${j.session.loginid} (${j.session.currency})`);
        if (!had || had.loginid !== j.session.loginid) get().rebaseToAccount();
      } else {
        set({ session: null });
        if (notify && j.reason) get().pushLog('warn', `Session not active: ${j.reason}`);
      }
      const a = await fetch('/api/deriv/accounts', { cache: 'no-store' });
      if (a.ok) {
        const aj = await a.json();
        if (aj.ok) set({ accounts: aj.accounts as AccountSummary[] });
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

  async connectWithPat(token: string): Promise<{ ok: boolean; message: string }> {
    set({ busy: 'pat' });
    try {
      const r = await fetch('/api/deriv/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        const msg = j.message ?? `Deriv rejected the token (HTTP ${r.status}).`;
        get().pushLog('error', `PAT login failed: ${msg}`);
        return { ok: false, message: msg };
      }
      set({ session: j.session as AuthSession, accounts: (j.accounts ?? []) as AccountSummary[] });
      get().pushLog('ok', `Connected with API token as ${j.session.loginid}.`);
      get().rebaseToAccount();
      // Default to the DEMO socket after connecting. Selecting a real account is a separate,
      // explicitly gated action -- we never silently start on real money.
      await get().applyMode('deriv_demo', false);
      return { ok: true, message: `Connected as ${j.session.loginid}` };
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
    get().stopBot('disconnected');
    try {
      await fetch('/api/deriv/oauth/logout', { method: 'POST' });
    } catch {
      /* best effort */
    }
    set({ session: null, accounts: [] });
    get().pushLog('warn', 'Disconnected. The local session cookie was cleared; revoke the token at Deriv if you want it dead server-side.');
    await get().applyMode('deriv_demo', false);
  },

  /** Switch the active account (demo vs real). Real requires acknowledgement. */
  async selectAccount(loginid: string): Promise<{ ok: boolean; message: string }> {
    const acct = get().accounts.find((a) => a.loginid === loginid);
    if (!acct) return { ok: false, message: 'Unknown account.' };
    if (!acct.isVirtual && !get().settings.realTradingAcknowledged) {
      return {
        ok: false,
        message: 'Real-money trading is not acknowledged. Enable it in Risk settings first.',
      };
    }
    await get().applyMode(acct.isVirtual ? 'deriv_demo' : 'deriv_real', false);
    get().rebaseToAccount();
    return { ok: true, message: `Switched to ${loginid}` };
  },

  /* ---------------------------------------------------------- market data */

  async applyMode(mode: AccountMode, initial = false): Promise<void> {
    const cur = get();
    // Tear down any running bot and the old provider before switching provenance.
    cur.stopBot(`mode changed to ${mode}`);
    cur.provider?.disconnect();

    set({ dataSource: 'deriv_live', connectionStatus: 'connecting', marketError: null });

    // Public market data works with NO credential, so load that first: the charts are useful
    // even before the user connects an account.
    const publicProvider = new DerivProvider(mode);
    set({ provider: publicProvider });
    try {
      await publicProvider.connect();
      set({ connectionStatus: 'open' });
      await get().loadMarket(initial);
      get().pushLog('ok', `Connected to Deriv public market data (${mode}).`);
    } catch (e) {
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
    await get().attachTradingSocket(mode);
  },

  /** Exchange the server-held token for an OTP socket so the bot can trade. */
  async attachTradingSocket(mode: 'deriv_demo' | 'deriv_real'): Promise<void> {
    const loginid = get().accounts.find((a) => (mode === 'deriv_real' ? !a.isVirtual : a.isVirtual))?.loginid ?? get().session?.loginid;
    if (!loginid) return;
    try {
      const r = await fetch('/api/deriv/socket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginid, allowReal: mode === 'deriv_real' && get().settings.realTradingAcknowledged }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        get().pushLog('warn', `Trading socket unavailable: ${j.message ?? r.status}. Market data still works; trading stays disabled.`);
        return;
      }
      const prev = get().provider;
      prev?.disconnect();
      const authed = new DerivProvider(mode, { authenticatedUrl: j.url ?? undefined, onStatus: (s) => set({ connectionStatus: s }) });
      set({ provider: authed });
      await authed.connect();
      set({ connectionStatus: 'open' });
      get().pushLog('ok', `Authenticated trading socket open for ${loginid} (${j.mode}).`);
    } catch (e) {
      get().pushLog('error', `Trading socket error: ${(e as Error).message}`);
    }
  },

  async loadMarket(initial = false): Promise<void> {
    const { provider, activeSymbol } = get();
    if (!provider) return;
    set({ marketLoading: true, marketError: null });
    try {
      const hist = await provider.history(activeSymbol, 800);
      set({
        quotes: hist.slice(-MAX_QUOTES),
        digits: hist.map((q) => q.digit),
        pipSize: hist[0]?.pipSize ?? 2,
        marketLoading: false,
      });
      if (!initial) get().pushLog('info', `Loaded ${hist.length} historical ticks for ${activeSymbol}.`);
      await get().subscribeTicks(activeSymbol);
      if (provider instanceof DerivProvider) await get().loadSymbols();
    } catch (e) {
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
      await get().rankMarkets(symbols);
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
    if (!get().session) {
      return {
        ok: false,
        message: 'No Deriv account is connected. Connect a demo or real account before running a bot — this tool trades only on Deriv.',
      };
    }
    if (!get().settings.limits.tradingEnabled) {
      return { ok: false, message: 'Trading is disabled. Enable it in Risk settings — the bot refuses to run otherwise.' };
    }
    if (mode === 'deriv_real' && !get().settings.realTradingAcknowledged) {
      return { ok: false, message: 'Real-money trading is not acknowledged. Confirm it in Risk settings.' };
    }
    if (get().bot && get().botState === 'running') {
      return { ok: false, message: 'A bot is already running. Stop it first — only one bot runs at a time to prevent duplicate orders.' };
    }

    const startingBalance = get().session?.balance ?? 0;
    const risk = new RiskManager(get().settings.limits, get().settings.recovery, startingBalance);

    const bot = new TradingBot(s, provider, risk, {
      onStateChange: (st, detail) => {
        set({ botState: st, botDetail: detail ?? '' });
        if (st === 'halted' || st === 'error') get().pushLog('warn', `Bot ${st}: ${detail ?? ''}`);
        if (st === 'running') get().pushLog('ok', `Bot started: "${s.name}" v${s.version} on ${s.market} [${mode}]`);
        if (st === 'stopped') get().pushLog('info', `Bot stopped: ${detail ?? ''}`);
        set({ riskSnapshot: risk.getSnapshot() });
      },
      onTrade: async (t) => {
        await appendTrades([t]);
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
    }, startingBalance);

    set({ bot, activeStrategyId: id, botState: 'starting', botDetail: '' });
    try {
      await bot.start(800);
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

  async clearTrades(): Promise<void> {
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
  hydrate: () => Promise<void>;
  loadConfig: () => Promise<void>;
  pushLog: (level: LogEntry['level'], text: string) => void;
  clearLog: () => void;
  setSettings: (patch: Partial<AppSettings>) => Promise<void>;
  refreshSession: (notify?: boolean) => Promise<void>;
  connectWithPat: (token: string) => Promise<{ ok: boolean; message: string }>;
  createOptionsAccount: (accountType: 'demo' | 'real') => Promise<{ ok: boolean; message: string }>;
  startOAuth: (signup?: boolean) => Promise<{ ok: boolean; message: string }>;
  disconnect: () => Promise<void>;
  selectAccount: (loginid: string) => Promise<{ ok: boolean; message: string }>;
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
