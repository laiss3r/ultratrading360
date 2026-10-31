import type { MarketProvider, Quote, SettledContract } from './provider';
import type { AccountMode } from '../deriv/types';
import { evaluateGroup, type DigitWindow } from './conditions';
import { RiskManager, type RiskDecision } from './risk';
import type { Strategy } from './strategies';
import { validateStrategy } from './strategies';
import { OrderCancelledError } from '../deriv/trading';
import { nextContract } from './rotation';
import { progressionStake } from './progressions';

export type BotState = 'idle' | 'starting' | 'running' | 'paused' | 'stopping' | 'stopped' | 'halted' | 'error';

export interface TradeRecord {
  id: string;
  /** Idempotency key: strategyId + version + monotonic trade index. */
  idempotencyKey: string;
  strategyId: string;
  strategyName: string;
  strategyVersion: number;
  symbol: string;
  contractType: string;
  barrier?: string;
  stake: number;
  payout: number;
  profit: number;
  won: boolean;
  openedAt: number;
  closedAt: number;
  entryDigit?: number;
  exitDigit?: number;
  entryPrice?: number;
  exitPrice?: number;
  mode: AccountMode;
  /** Provenance of the numbers: every contract here was executed through Deriv. */
  source: 'deriv_live';
  balanceBefore: number;
  balanceAfter: number;
  riskReasons: string[];
  gateReasons: string[];
  error?: string;
}

export interface BotEvents {
  onStateChange?: (s: BotState, detail?: string) => void;
  onQuote?: (q: Quote) => void;
  onTrade?: (t: TradeRecord) => void;
  onGate?: (satisfied: boolean, reasons: string[]) => void;
  onRisk?: (d: RiskDecision) => void;
  onError?: (e: Error) => void;
}

/**
 * Bot execution engine.
 *
 * Guarantees this class is responsible for:
 *  1. A STOPPED bot never submits another order. `state` is checked immediately before every
 *     purchase, not just at loop entry, so a stop during an in-flight tick takes effect.
 *  2. Restarting does not duplicate trades. Every order carries an idempotency key derived
 *     from (strategyId, strategyVersion, tradeIndex); a key already present in the ledger is
 *     skipped rather than re-executed.
 *  3. A dropped provider connection halts the bot instead of fabricating results.
 *  4. The risk manager is consulted before every single order and its `halt` decision stops
 *     the session.
 */
export class TradingBot {
  state: BotState = 'idle';
  private trades: TradeRecord[] = [];
  private executedKeys = new Set<string>();
  private tradeIndex = 0;
  private digits: number[] = [];
  private prices: number[] = [];
  private pipSize = 2;
  private stopDisposer: (() => void) | null = null;
  private inFlight: Promise<void> | null = null;
  private lastTradeAt = 0;
  private balance: number;
  private startingBalance: number;
  private detail = '';

  constructor(
    public strategy: Strategy,
    private provider: MarketProvider,
    public risk: RiskManager,
    private events: BotEvents = {},
    startingBalance = 10000,
  ) {
    this.balance = startingBalance;
    this.startingBalance = startingBalance;
  }

  private setState(s: BotState, detail = '') {
    this.state = s;
    this.detail = detail;
    this.events.onStateChange?.(s, detail);
  }

  getState(): { state: BotState; detail: string } {
    return { state: this.state, detail: this.detail };
  }
  hasPendingOrder(): boolean { return this.inFlight !== null; }

  getTrades(): TradeRecord[] {
    return [...this.trades];
  }
  getBalance(): number {
    return this.balance;
  }
  getStartingBalance(): number {
    return this.startingBalance;
  }
  getDigits(): number[] {
    return [...this.digits];
  }

  /** Restore a ledger from persistence so a page refresh does not restart the trade index. */
  restoreLedger(trades: TradeRecord[]) {
    for (const t of trades) {
      this.executedKeys.add(t.idempotencyKey);
      this.trades.push(t);
      this.tradeIndex = Math.max(this.tradeIndex, Number(t.idempotencyKey.split(':')[2] ?? 0) + 1);
    }
  }

  async start(historySize = 1000): Promise<void> {
    const v = validateStrategy(this.strategy);
    if (!v.valid) {
      this.setState('error', v.errors.join(' | '));
      throw new Error(`Strategy invalid: ${v.errors.join('; ')}`);
    }
    if (this.state === 'running') return; // single-flight: a second start() is a no-op
    if (this.inFlight) await this.inFlight.catch(() => undefined);

    this.setState('starting');
    try {
      if (!this.provider.isConnected()) await this.provider.connect();
      const hist = await this.provider.history(this.strategy.market, historySize);
      this.digits = hist.map((q) => q.digit);
      this.prices = hist.map((q) => q.price);
      this.pipSize = hist[0]?.pipSize ?? 2;
      this.risk.setEquity(this.balance);

      const dispose = await this.provider.stream(this.strategy.market, (q) => {
        this.events.onQuote?.(q);
        if (q.symbol !== this.strategy.market || this.state !== 'running') return;
        this.digits.push(q.digit); if (this.digits.length > 5000) this.digits.shift();
        this.prices.push(q.price); if (this.prices.length > 5000) this.prices.shift();
        this.pipSize = q.pipSize;
        // Exactly one quote -> proposal -> buy -> settlement chain at a time.
        if (this.inFlight) return;
        this.inFlight = Promise.resolve().then(() => this.handleQuote(q)).catch((e) => {
          this.events.onError?.(e as Error);
          this.setState('error', (e as Error).message);
          this.teardownStream();
        }).finally(() => { this.inFlight = null; });
      });
      this.stopDisposer = dispose;
      this.setState('running');
    } catch (e) {
      this.setState('error', (e as Error).message);
      this.events.onError?.(e as Error);
      throw e;
    }
  }

  pause() {
    if (this.state === 'running') this.setState('paused');
  }

  resume() {
    if (this.state === 'paused') this.setState('running');
  }

  /** Stop is synchronous and idempotent: after it returns, no further order can be submitted. */
  stop(reason = 'stopped by user') {
    if (this.state === 'stopped') return;
    this.setState('stopping');
    this.teardownStream();
    this.setState('stopped', reason);
  }

  private teardownStream() {
    if (this.stopDisposer) {
      try {
        this.stopDisposer();
      } catch {
        /* already disposed */
      }
      this.stopDisposer = null;
    }
  }

  destroy() {
    this.stop('destroyed');
    this.provider.disconnect();
  }

  private async handleQuote(q: Quote) {
    if (this.state !== 'running') return;

    // Cooldown
    const now = Date.now();
    if (now - this.lastTradeAt < this.strategy.cooldownSeconds * 1000) return;

    // Provider health — never pretend to trade on a dead connection.
    if (!this.provider.isConnected()) {
      this.setState('halted', 'Provider connection lost. The bot stopped rather than simulate live trades.');
      this.teardownStream();
      return;
    }

    const window: DigitWindow = { digits: this.digits, prices: this.prices, symbol: q.symbol, pipSize: this.pipSize };
    const gate = evaluateGroup(this.strategy.entry, window);
    this.events.onGate?.(gate.satisfied, gate.reasons);
    if (!gate.satisfied) return;

    // Risk gate BEFORE pricing or purchase.
    const mode = this.provider.mode;
    // A configured progression owns the stake; otherwise fall back to the
    // legacy recovery escalation. Never both — that would compound them.
    const progression = this.strategy.progression;
    const baseStake = progression
      ? progressionStake(
          progression,
          this.trades.filter((t) => !t.error).map((t) => ({ won: t.profit > 0, profit: t.profit })),
        )
      : this.strategy.stake;
    const suggested = progression ? baseStake : this.risk.suggestRecoveryStake(baseStake);
    const decision = this.risk.evaluate(suggested, mode);
    this.events.onRisk?.(decision);

    if (decision.halt) {
      this.setState('halted', decision.haltReason ? `${decision.haltReason}: ${decision.reasons.join(' ')}` : decision.reasons.join(' '));
      this.teardownStream();
      return;
    }
    if (!decision.allowed) return;

    // Re-check state immediately before committing funds — a stop() may have landed mid-quote.
    if (this.state !== 'running') return;

    const key = `${this.strategy.id}:${this.strategy.version}:${this.tradeIndex}`;
    if (this.executedKeys.has(key)) {
      // A restart replayed this index. Skip rather than double-spend.
      this.tradeIndex += 1;
      return;
    }

    this.lastTradeAt = now;
    const index = this.tradeIndex++;
    const balanceBefore = this.balance;

    const leg = nextContract(this.strategy, this.strategy.contractRotation, this.trades.filter((t) => !t.error));
    let reservedStake = 0;
    let record: TradeRecord;
    try {
      const priced = await this.provider.price({
        symbol: this.strategy.market,
        contractType: leg.contractType,
        stake: decision.stake,
        duration: this.strategy.duration,
        durationUnit: this.strategy.durationUnit,
        barrier: leg.barrier !== undefined ? String(leg.barrier) : undefined,
        currency: this.strategy.currency,
      });
      // Stop/permission changes can arrive while a proposal is pending.
      if (this.state !== 'running') return;
      const finalRisk = this.risk.evaluate(priced.stake, mode);
      if (!finalRisk.allowed || Math.abs(finalRisk.stake - priced.stake) > 1e-8) {
        this.events.onRisk?.(finalRisk);
        if (finalRisk.halt) { this.setState('halted', finalRisk.reasons.join(' ')); this.teardownStream(); }
        return;
      }
      this.risk.openExposure(priced.stake);
      reservedStake = priced.stake;
      const settled: SettledContract = await this.provider.execute(priced, { authorized: true, shouldExecute: () => { const d = this.risk.evaluateReserved(priced.stake, mode); return this.state === 'running' && d.allowed && Math.abs(d.stake - priced.stake) < 1e-8; } });
      this.risk.closeExposure(priced.stake, settled.profit);
      this.balance = round2(this.balance + settled.profit);
      this.risk.setEquity(this.balance);

      record = {
        id: `tr_${Date.now().toString(36)}_${index}`,
        idempotencyKey: `${this.strategy.id}:${this.strategy.version}:${index}`,
        strategyId: this.strategy.id,
        strategyName: this.strategy.name,
        strategyVersion: this.strategy.version,
        symbol: this.strategy.market,
        contractType: leg.contractType,
        barrier: priced.barrier,
        stake: priced.stake,
        payout: settled.payout,
        profit: settled.profit,
        won: settled.won,
        openedAt: now,
        closedAt: Date.now(),
        entryDigit: settled.entryDigit,
        exitDigit: settled.exitDigit,
        entryPrice: settled.entryPrice,
        exitPrice: settled.exitPrice,
        mode,
        source: 'deriv_live',
        balanceBefore,
        balanceAfter: this.balance,
        riskReasons: decision.reasons,
        gateReasons: gate.reasons,
      };
    } catch (e) {
      if (e instanceof OrderCancelledError) { this.risk.releaseReservation(reservedStake); return; }
      const msg = (e as Error).message;
      record = {
        id: `tr_err_${Date.now().toString(36)}_${index}`,
        idempotencyKey: `${this.strategy.id}:${this.strategy.version}:${index}`,
        strategyId: this.strategy.id,
        strategyName: this.strategy.name,
        strategyVersion: this.strategy.version,
        symbol: this.strategy.market,
        contractType: leg.contractType,
        barrier: leg.barrier !== undefined ? String(leg.barrier) : undefined,
        stake: 0,
        payout: 0,
        profit: 0,
        won: false,
        openedAt: now,
        closedAt: Date.now(),
        mode,
        source: 'deriv_live',
        balanceBefore,
        balanceAfter: this.balance,
        riskReasons: decision.reasons,
        gateReasons: gate.reasons,
        error: msg,
      };
      this.events.onError?.(e as Error);
      // A fatal authorization/connection problem must stop the bot, not loop forever.
      { // An uncertain order outcome must not trigger automatic duplicate buys.
        this.setState('halted', msg);
        this.teardownStream();
      }
    }

    this.executedKeys.add(record.idempotencyKey);
    this.trades.push(record);
    this.events.onTrade?.(record);

    if (this.state === 'running' && this.trades.filter((t) => !t.error).length >= this.strategy.maxTrades) {
      this.setState('halted', `maxTrades (${this.strategy.maxTrades}) reached`);
      this.teardownStream();
    }
    if (this.state === 'running') {
      const after = this.risk.evaluate(this.strategy.stake, mode);
      if (after.halt) { this.setState('halted', `${after.haltReason}: ${after.reasons.join(' ')}`); this.teardownStream(); }
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Single-flight registry. Prevents a browser refresh or a double-click from launching two
 * bots for the same strategy: the second request receives the already-running instance.
 */
const registry = new Map<string, TradingBot>();

export function registerBot(strategyId: string, bot: TradingBot) {
  const existing = registry.get(strategyId);
  if (existing && existing.state === 'running') {
    throw new Error(`A bot for strategy ${strategyId} is already running.`);
  }
  registry.set(strategyId, bot);
}
export function getBot(strategyId: string): TradingBot | undefined {
  return registry.get(strategyId);
}
export function releaseBot(strategyId: string) {
  registry.delete(strategyId);
}
export function runningBotIds(): string[] {
  return [...registry.entries()].filter(([, b]) => b.state === 'running').map(([id]) => id);
}
