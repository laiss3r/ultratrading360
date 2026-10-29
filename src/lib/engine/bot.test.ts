import { describe, expect, it, beforeEach } from 'vitest';
import { getBot, registerBot, releaseBot, runningBotIds, TradingBot, type TradeRecord } from './bot';
import type { MarketProvider, PricedContract, Quote, SettledContract } from './provider';
import { DEFAULT_RECOVERY, DEFAULT_RISK_LIMITS, RiskManager } from './risk';
import { createStrategy, type Strategy } from './strategies';
import type { AccountMode } from '../deriv/types';
import type { ContractType } from '../deriv/contracts';

/**
 * A provider the test drives by hand, so lifecycle guarantees are asserted deterministically
 * rather than against wall-clock timers.
 */
class ScriptedProvider implements MarketProvider {
  mode: AccountMode;
  source: 'simulation' | 'deriv_live';
  connected = true;
  quoteHandlers: Array<(q: Quote) => void> = [];
  priceCalls = 0;
  executeCalls = 0;
  failOnExecute: string | null = null;
  settleAs: 'win' | 'loss' | 'alternate' = 'alternate';
  private n = 0;
  pipSize = 2;

  constructor(mode: AccountMode = 'simulation', private payoutMult = 1.96) {
    this.mode = mode;
    this.source = mode === 'simulation' ? 'simulation' : 'deriv_live';
  }

  async connect() {
    this.connected = true;
  }
  disconnect() {
    this.connected = false;
  }
  isConnected() {
    return this.connected;
  }
  async history(symbol: string, count: number): Promise<Quote[]> {
    const out: Quote[] = [];
    for (let i = 0; i < count; i++) out.push(this.makeQuote(symbol, i % 2 === 0 ? 1 : 3, i));
    return out;
  }
  async stream(_symbol: string, onQuote: (q: Quote) => void) {
    this.quoteHandlers.push(onQuote);
    return () => {
      this.quoteHandlers = this.quoteHandlers.filter((h) => h !== onQuote);
    };
  }
  async price(req: { symbol: string; contractType: ContractType; stake: number; barrier?: string }): Promise<PricedContract> {
    this.priceCalls++;
    return {
      stake: req.stake,
      payout: Math.round(req.stake * this.payoutMult * 100) / 100,
      askPrice: req.stake,
      contractType: req.contractType,
      symbol: req.symbol,
      barrier: req.barrier,
      source: this.source,
    };
  }
  async execute(priced: PricedContract): Promise<SettledContract> {
    this.executeCalls++;
    if (this.failOnExecute) throw new Error(this.failOnExecute);
    const i = this.n++;
    const won =
      this.settleAs === 'win' ? true : this.settleAs === 'loss' ? false : i % 2 === 0;
    const profit = won ? Math.round((priced.payout - priced.stake) * 100) / 100 : -priced.stake;
    return {
      won,
      stake: priced.stake,
      payout: won ? priced.payout : 0,
      profit,
      entryDigit: 5,
      exitDigit: 6,
      source: this.source,
    };
  }

  /** Test hook: emit a quote as though the market moved. */
  push(symbol: string, digit: number, epoch = Date.now()) {
    const q = this.makeQuote(symbol, digit, epoch);
    for (const h of [...this.quoteHandlers]) h(q);
    return q;
  }
  private makeQuote(symbol: string, digit: number, epoch: number): Quote {
    return { symbol, price: 571.9 + digit / 100, digit, epoch, pipSize: this.pipSize, source: this.source };
  }
}

/** A strategy whose gate is always open, so every quote triggers a trade. */
const alwaysStrategy = (patch: Partial<Strategy> = {}): Strategy =>
  createStrategy({
    name: 'Always-on test',
    market: 'R_100',
    contractType: 'DIGITODD',
    stake: 1,
    cooldownSeconds: 0,
    maxTrades: 1000,
    entry: { id: 'root', op: 'AND', children: [{ id: 'c', kind: 'odd' }] },
    limits: { ...DEFAULT_RISK_LIMITS, tradingEnabled: true, maxStake: 100, maxSessionLoss: 1e9, maxDailyLoss: 1e9 },
    recovery: { ...DEFAULT_RECOVERY },
    ...patch,
  });

describe('bot lifecycle: a stopped bot must never submit another order', () => {
  let provider: ScriptedProvider;
  let bot: TradingBot;

  beforeEach(() => {
    provider = new ScriptedProvider();
    bot = new TradingBot(alwaysStrategy(), provider, new RiskManager(bot_limits(), { ...DEFAULT_RECOVERY }), {});
  });

  const bot_limits = () => ({
    ...DEFAULT_RISK_LIMITS,
    tradingEnabled: true,
    maxStake: 100,
    maxSessionLoss: 1e9,
    maxDailyLoss: 1e9,
  });

  it('trades while running', async () => {
    await bot.start(20);
    expect(bot.state).toBe('running');
    provider.push('R_100', 7);
    await flush();
    expect(bot.getTrades().length).toBe(1);
    expect(provider.executeCalls).toBe(1);
  });

  it('submits NOTHING after stop(), even when quotes keep arriving', async () => {
    await bot.start(20);
    provider.push('R_100', 7);
    await flush();
    const afterFirst = bot.getTrades().length;
    expect(afterFirst).toBe(1);

    bot.stop();
    expect(bot.state).toBe('stopped');
    expect(provider.quoteHandlers).toHaveLength(0); // stream disposed

    for (let i = 0; i < 50; i++) provider.push('R_100', 9);
    await flush();
    expect(bot.getTrades().length).toBe(afterFirst);
    expect(provider.executeCalls).toBe(1);
    expect(provider.priceCalls).toBe(1);
  });

  it('stop() is idempotent', async () => {
    await bot.start(20);
    bot.stop();
    bot.stop();
    bot.stop();
    expect(bot.state).toBe('stopped');
  });

  it('pause() suppresses orders and resume() restores them', async () => {
    await bot.start(20);
    bot.pause();
    expect(bot.state).toBe('paused');
    for (let i = 0; i < 10; i++) provider.push('R_100', 7);
    await flush();
    expect(bot.getTrades().length).toBe(0);

    bot.resume();
    expect(bot.state).toBe('running');
    provider.push('R_100', 7);
    await flush();
    expect(bot.getTrades().length).toBe(1);
  });

  it('resume() from a non-paused state is a no-op', async () => {
    await bot.start(20);
    bot.resume();
    expect(bot.state).toBe('running');
    bot.stop();
    bot.resume(); // must NOT resurrect a stopped bot
    expect(bot.state).toBe('stopped');
  });

  it('start() twice does not create a second stream (single-flight)', async () => {
    await bot.start(20);
    const handlers = provider.quoteHandlers.length;
    await bot.start(20);
    expect(provider.quoteHandlers.length).toBe(handlers);
    provider.push('R_100', 7);
    await flush();
    expect(bot.getTrades().length).toBe(1); // not 2
  });
});

describe('bot lifecycle: a dropped connection must not fake trades', () => {
  it('halts instead of continuing when the provider disconnects', async () => {
    const provider = new ScriptedProvider();
    const bot = new TradingBot(
      alwaysStrategy(),
      provider,
      new RiskManager({ ...DEFAULT_RISK_LIMITS, tradingEnabled: true, maxStake: 100, maxSessionLoss: 1e9, maxDailyLoss: 1e9 }, { ...DEFAULT_RECOVERY }),
      {},
    );
    await bot.start(20);
    provider.connected = false; // simulate the socket dropping

    provider.push('R_100', 7);
    await flush();

    expect(bot.state).toBe('halted');
    expect(bot.getState().detail).toMatch(/connection lost/i);
    expect(bot.getTrades().length).toBe(0); // nothing fabricated
  });

  it('records an error and halts on a NOT AUTHORIZED failure', async () => {
    const provider = new ScriptedProvider('deriv_real');
    provider.failOnExecute = 'NOT AUTHORIZED: this socket is not authenticated.';
    const bot = new TradingBot(
      alwaysStrategy(),
      provider,
      new RiskManager({ ...DEFAULT_RISK_LIMITS, tradingEnabled: true, realTradingAcknowledged: true, maxStake: 100, maxSessionLoss: 1e9, maxDailyLoss: 1e9 }, { ...DEFAULT_RECOVERY }),
      {},
    );
    await bot.start(20);
    provider.push('R_100', 7);
    await flush();

    const trades = bot.getTrades();
    expect(trades).toHaveLength(1);
    expect(trades[0].error).toMatch(/NOT AUTHORIZED/);
    expect(trades[0].profit).toBe(0); // no phantom P/L
    expect(bot.state).toBe('halted');
  });

  it('halts on insufficient funds rather than looping', async () => {
    const provider = new ScriptedProvider('deriv_demo');
    provider.failOnExecute = 'INSUFFICIENT FUNDS: balance is too low.';
    const bot = new TradingBot(
      alwaysStrategy(),
      provider,
      new RiskManager({ ...DEFAULT_RISK_LIMITS, tradingEnabled: true, maxStake: 100, maxSessionLoss: 1e9, maxDailyLoss: 1e9 }, { ...DEFAULT_RECOVERY }),
      {},
    );
    await bot.start(20);
    provider.push('R_100', 7);
    await flush();
    expect(bot.state).toBe('halted');
    expect(bot.getTrades()[0].error).toMatch(/INSUFFICIENT FUNDS/);
  });
});

describe('restart safety: no duplicate trades', () => {
  it('skips an idempotency key already present in the restored ledger', async () => {
    const provider = new ScriptedProvider();
    const strategy = alwaysStrategy();
    const risk = () =>
      new RiskManager({ ...DEFAULT_RISK_LIMITS, tradingEnabled: true, maxStake: 100, maxSessionLoss: 1e9, maxDailyLoss: 1e9 }, { ...DEFAULT_RECOVERY });

    const first = new TradingBot(strategy, provider, risk(), {});
    await first.start(20);
    provider.push('R_100', 7);
    await flush();
    const ledger: TradeRecord[] = first.getTrades();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].idempotencyKey).toBe(`${strategy.id}:${strategy.version}:0`);
    first.stop();

    // Simulate a worker/page restart that reloads the persisted ledger.
    const restarted = new TradingBot(strategy, provider, risk(), {});
    restarted.restoreLedger(ledger);
    await restarted.start(20);
    provider.push('R_100', 7);
    await flush();

    // Index 0 was already executed, so it is skipped and index 1 is used instead.
    const keys = restarted.getTrades().map((t) => t.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(`${strategy.id}:${strategy.version}:0`);
    expect(keys.filter((k) => k.endsWith(':0'))).toHaveLength(1);
  });

  it('a strategy version bump starts a fresh key namespace without reusing an executed key', async () => {
    const provider = new ScriptedProvider();
    const s1 = alwaysStrategy();
    const s2 = { ...s1, version: s1.version + 1 };
    const risk = () =>
      new RiskManager({ ...DEFAULT_RISK_LIMITS, tradingEnabled: true, maxStake: 100, maxSessionLoss: 1e9, maxDailyLoss: 1e9 }, { ...DEFAULT_RECOVERY });

    const b1 = new TradingBot(s1, provider, risk(), {});
    await b1.start(20);
    provider.push('R_100', 7);
    await flush();
    const ledger = b1.getTrades();
    b1.stop();

    const b2 = new TradingBot(s2, provider, risk(), {});
    b2.restoreLedger(ledger);
    await b2.start(20);
    provider.push('R_100', 7);
    await flush();

    const all = b2.getTrades();
    // The restored v1 trade plus exactly one NEW v2 trade.
    expect(all).toHaveLength(2);
    expect(all.filter((t) => t.strategyVersion === s1.version)).toHaveLength(1);
    const fresh = all.filter((t) => t.strategyVersion === s2.version);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].idempotencyKey.startsWith(`${s2.id}:${s2.version}:`)).toBe(true);
    // The core guarantee: no idempotency key is ever executed twice.
    const keys = all.map((t) => t.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(provider.executeCalls).toBe(2);
  });
});

describe('risk manager integration', () => {
  it('halts the bot when the risk manager says halt', async () => {
    const provider = new ScriptedProvider();
    provider.settleAs = 'loss';
    const bot = new TradingBot(
      alwaysStrategy(),
      provider,
      new RiskManager({ ...DEFAULT_RISK_LIMITS, tradingEnabled: true, maxStake: 100, maxSessionLoss: 2, maxDailyLoss: 1e9 }, { ...DEFAULT_RECOVERY }),
      {},
    );
    await bot.start(20);
    for (let i = 0; i < 10; i++) {
      provider.push('R_100', 7);
      await flush();
    }
    expect(bot.state).toBe('halted');
    expect(bot.getState().detail).toMatch(/session_loss/);
    // The bot must have stopped well before consuming all 10 quotes.
    expect(provider.executeCalls).toBeLessThan(10);
  });

  it('halts at strategy maxTrades', async () => {
    const provider = new ScriptedProvider();
    provider.settleAs = 'win';
    const bot = new TradingBot(
      alwaysStrategy({ maxTrades: 3 }),
      provider,
      new RiskManager({ ...DEFAULT_RISK_LIMITS, tradingEnabled: true, maxStake: 100, maxTrades: 1000, maxSessionLoss: 1e9, maxDailyLoss: 1e9 }, { ...DEFAULT_RECOVERY }),
      {},
    );
    await bot.start(20);
    for (let i = 0; i < 20; i++) {
      provider.push('R_100', 7);
      await flush();
    }
    expect(bot.getTrades().length).toBe(3);
    expect(bot.state).toBe('halted');
  });

  it('refuses to trade when tradingEnabled is false', async () => {
    const provider = new ScriptedProvider();
    const bot = new TradingBot(
      alwaysStrategy({ limits: { ...DEFAULT_RISK_LIMITS, tradingEnabled: false } }),
      provider,
      new RiskManager({ ...DEFAULT_RISK_LIMITS, tradingEnabled: false }, { ...DEFAULT_RECOVERY }),
      {},
    );
    await bot.start(20);
    for (let i = 0; i < 5; i++) {
      provider.push('R_100', 7);
      await flush();
    }
    expect(provider.executeCalls).toBe(0);
    expect(bot.getTrades().length).toBe(0);
  });
});

describe('gate evaluation', () => {
  it('does not trade when the entry gate is closed', async () => {
    const provider = new ScriptedProvider();
    const bot = new TradingBot(
      alwaysStrategy({ entry: { id: 'r', op: 'AND', children: [{ id: 'c', kind: 'even' }] } }),
      provider,
      new RiskManager({ ...DEFAULT_RISK_LIMITS, tradingEnabled: true, maxStake: 100, maxSessionLoss: 1e9, maxDailyLoss: 1e9 }, { ...DEFAULT_RECOVERY }),
      {},
    );
    await bot.start(20);
    provider.push('R_100', 7); // odd -> gate closed
    await flush();
    expect(bot.getTrades().length).toBe(0);
    provider.push('R_100', 8); // even -> gate open
    await flush();
    expect(bot.getTrades().length).toBe(1);
  });

  it('respects the cooldown between trades', async () => {
    const provider = new ScriptedProvider();
    const bot = new TradingBot(
      alwaysStrategy({ cooldownSeconds: 60 }),
      provider,
      new RiskManager({ ...DEFAULT_RISK_LIMITS, tradingEnabled: true, maxStake: 100, maxSessionLoss: 1e9, maxDailyLoss: 1e9 }, { ...DEFAULT_RECOVERY }),
      {},
    );
    await bot.start(20);
    provider.push('R_100', 7);
    await flush();
    provider.push('R_100', 7);
    await flush();
    provider.push('R_100', 7);
    await flush();
    expect(bot.getTrades().length).toBe(1);
  });
});

describe('trade record integrity', () => {
  it('records provenance, balance movement and reasons', async () => {
    const provider = new ScriptedProvider('simulation');
    provider.settleAs = 'win';
    const bot = new TradingBot(
      alwaysStrategy(),
      provider,
      new RiskManager({ ...DEFAULT_RISK_LIMITS, tradingEnabled: true, maxStake: 100, maxSessionLoss: 1e9, maxDailyLoss: 1e9 }, { ...DEFAULT_RECOVERY }),
      {},
      1000,
    );
    await bot.start(20);
    provider.push('R_100', 7);
    await flush();
    const t = bot.getTrades()[0];
    expect(t.source).toBe('simulation');
    expect(t.mode).toBe('simulation');
    expect(t.won).toBe(true);
    expect(t.profit).toBeCloseTo(0.96, 2);
    expect(t.balanceBefore).toBe(1000);
    expect(t.balanceAfter).toBeCloseTo(1000.96, 2);
    expect(bot.getBalance()).toBeCloseTo(1000.96, 2);
    expect(t.gateReasons.length).toBeGreaterThan(0);
    expect(t.entryDigit).toBeDefined();
  });

  it('labels Deriv-mode trades with deriv_live provenance', async () => {
    const provider = new ScriptedProvider('deriv_demo');
    provider.settleAs = 'loss';
    const bot = new TradingBot(
      alwaysStrategy(),
      provider,
      new RiskManager({ ...DEFAULT_RISK_LIMITS, tradingEnabled: true, maxStake: 100, maxSessionLoss: 1e9, maxDailyLoss: 1e9 }, { ...DEFAULT_RECOVERY }),
      {},
      500,
    );
    await bot.start(20);
    provider.push('R_100', 7);
    await flush();
    const t = bot.getTrades()[0];
    expect(t.source).toBe('deriv_live');
    expect(t.mode).toBe('deriv_demo');
    expect(t.won).toBe(false);
    expect(t.profit).toBe(-1);
    expect(bot.getBalance()).toBe(499);
  });

  it('never mixes simulated and real provenance in one record', async () => {
    const sim = new ScriptedProvider('simulation');
    const bot = new TradingBot(
      alwaysStrategy(),
      sim,
      new RiskManager({ ...DEFAULT_RISK_LIMITS, tradingEnabled: true, maxStake: 100, maxSessionLoss: 1e9, maxDailyLoss: 1e9 }, { ...DEFAULT_RECOVERY }),
      {},
    );
    await bot.start(20);
    sim.push('R_100', 7);
    await flush();
    for (const t of bot.getTrades()) {
      expect(t.source === 'simulation' ? t.mode : t.mode).toBeDefined();
      if (t.source === 'simulation') expect(t.mode).toBe('simulation');
    }
  });
});

describe('validation and registry', () => {
  it('refuses to start with an invalid strategy', async () => {
    const provider = new ScriptedProvider();
    const bad = alwaysStrategy({ stake: -5 });
    const bot = new TradingBot(bad, provider, new RiskManager({ ...DEFAULT_RISK_LIMITS, tradingEnabled: true }, { ...DEFAULT_RECOVERY }), {});
    await expect(bot.start(20)).rejects.toThrow(/invalid/i);
    expect(bot.state).toBe('error');
    expect(provider.executeCalls).toBe(0);
  });

  it('the registry blocks a second running bot for the same strategy', async () => {
    releaseBot('dup-test');
    const provider = new ScriptedProvider();
    const s = alwaysStrategy({ id: 'dup-test' });
    const mk = () =>
      new TradingBot(s, provider, new RiskManager({ ...DEFAULT_RISK_LIMITS, tradingEnabled: true, maxStake: 100, maxSessionLoss: 1e9, maxDailyLoss: 1e9 }, { ...DEFAULT_RECOVERY }), {});
    const a = mk();
    await a.start(20);
    registerBot('dup-test', a);
    expect(getBot('dup-test')).toBe(a);
    expect(runningBotIds()).toContain('dup-test');
    expect(() => registerBot('dup-test', mk())).toThrow(/already running/);
    a.stop();
    releaseBot('dup-test');
    expect(getBot('dup-test')).toBeUndefined();
  });
});

/** Let the microtask queue drain so async handleQuote completes. */
async function flush(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}
