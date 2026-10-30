import type { ConditionGroup, DigitWindow } from '../engine/conditions';
import { evaluateGroup } from '../engine/conditions';
import type { ContractType } from '../deriv/contracts';
import { expectedValue, type ExpectedValue } from './ev';
import { drawdown } from '../metrics';

export interface BacktestConfig {
  digits: number[];
  symbol: string;
  pipSize: number;
  entry: ConditionGroup;
  contractType: ContractType;
  barrier?: number;
  stake: number;
  /** Payout multiplier actually quoted by the broker, never an assumed 2x. */
  payoutMultiplier: number;
  /** Fraction of the sample reserved for out-of-sample evaluation. */
  holdoutFraction?: number;
  cooldownTicks?: number;
}

export interface BacktestTrade {
  index: number;
  entryDigit: number;
  exitDigit: number;
  won: boolean;
  stake: number;
  payout: number;
  profit: number;
  gateReasons: string[];
}

export interface BacktestSegment {
  label: 'in-sample' | 'out-of-sample' | 'full';
  tradeList: BacktestTrade[];
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netProfit: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  ev: ExpectedValue;
  /** True when the out-of-sample win rate holds up relative to in-sample. */
  degraded?: boolean;
}

export interface BacktestResult {
  config: Omit<BacktestConfig, 'digits'>;
  sampleSize: number;
  splitIndex: number;
  inSample: BacktestSegment;
  outOfSample: BacktestSegment;
  full: BacktestSegment;
  equityCurve: number[];
  /** Explicit statement of what this backtest does and does not demonstrate. */
  honesty: string[];
}

/**
 * Backtest a strategy against a digit series with a proper out-of-sample holdout.
 *
 * The holdout is the point. A digit pattern found by searching a sample will usually not
 * survive being tested on data it was not selected from; if it does not, there is no edge.
 * Reporting in-sample performance alone is how false signals get sold.
 */
export function backtest(cfg: BacktestConfig): BacktestResult {
  const holdout = cfg.holdoutFraction ?? 0.3;
  if (holdout < 0 || holdout >= 1) throw new RangeError('holdoutFraction must be in [0,1)');
  const n = cfg.digits.length;
  if (n < 50) throw new RangeError(`Backtest needs at least 50 digits, got ${n}`);
  const splitIndex = Math.floor(n * (1 - holdout));

  const runRange = (from: number, to: number, label: 'in-sample' | 'out-of-sample' | 'full'): BacktestSegment => {
    const trades: BacktestTrade[] = [];
    let lastTrade = -Infinity;
    const cooldown = cfg.cooldownTicks ?? 0;
    for (let i = from + 1; i < to; i++) {
      const windowDigits = cfg.digits.slice(Math.max(0, i - 500), i); // data available BEFORE the trade
      const w: DigitWindow = { digits: windowDigits, symbol: cfg.symbol, pipSize: cfg.pipSize };
      const gate = evaluateGroup(cfg.entry, w);
      if (!gate.satisfied) continue;
      if (i - lastTrade < cooldown) continue;
      lastTrade = i;
      const entryDigit = cfg.digits[i - 1];
      const exitDigit = cfg.digits[i]; // the digit the contract settles on
      const won = settle(cfg.contractType, cfg.barrier, exitDigit);
      const stake = cfg.stake;
      const payout = round2(stake * cfg.payoutMultiplier);
      trades.push({
        index: i,
        entryDigit,
        exitDigit,
        won,
        stake,
        payout,
        profit: won ? round2(payout - stake) : round2(-stake),
        gateReasons: gate.reasons,
      });
    }
    const wins = trades.filter((t) => t.won).length;
    const losses = trades.length - wins;
    const netProfit = round2(trades.reduce((a, t) => a + t.profit, 0));
    const dd = drawdown(trades.map((t) => t.profit), 0);
    return {
      label,
      tradeList: trades,
      trades: trades.length,
      wins,
      losses,
      winRate: trades.length ? wins / trades.length : 0,
      netProfit,
      maxDrawdown: round2(dd.maxDrawdown),
      maxDrawdownPct: round4(dd.maxDrawdownPct),
      ev: expectedValue(trades.length ? wins / trades.length : 0, cfg.stake, round2(cfg.stake * cfg.payoutMultiplier)),
    };
  };

  // runRange(from, to) evaluates indices from+1 .. to-1, so the out-of-sample segment must start
  // at splitIndex-1 to cover index splitIndex itself. Without that shift the boundary index is
  // claimed by neither segment and in-sample + out-of-sample no longer equals full.
  // The gate window is digits.slice(i-500, i) -- strictly PAST data -- so widening the range
  // introduces no lookahead: the holdout still never sees a future digit.
  const inSample = runRange(0, splitIndex, 'in-sample');
  const outOfSample = runRange(splitIndex - 1, n, 'out-of-sample');
  const full = runRange(0, n, 'full');

  // Degradation check: did the edge survive unseen data?
  if (inSample.trades >= 20 && outOfSample.trades >= 10) {
    outOfSample.degraded = outOfSample.ev.evPctOfStake < inSample.ev.evPctOfStake - 0.01;
  }

  // Real equity curve from the realised P/L of every trade in chronological order.
  const equityCurve = drawdown(
    full.tradeList.map((t) => t.profit),
    0,
  ).curve;

  const honesty = buildHonesty(inSample, outOfSample, cfg);

  return {
    config: {
      symbol: cfg.symbol,
      pipSize: cfg.pipSize,
      entry: cfg.entry,
      contractType: cfg.contractType,
      barrier: cfg.barrier,
      stake: cfg.stake,
      payoutMultiplier: cfg.payoutMultiplier,
      holdoutFraction: cfg.holdoutFraction ?? 0.3,
      cooldownTicks: cfg.cooldownTicks ?? 0,
    },
    sampleSize: n,
    splitIndex,
    inSample,
    outOfSample,
    full,
    equityCurve,
    honesty,
  };
}

function settle(type: ContractType, barrier: number | undefined, exitDigit: number): boolean {
  const b = barrier ?? 5;
  switch (type) {
    case 'DIGITODD': return exitDigit % 2 === 1;
    case 'DIGITEVEN': return exitDigit % 2 === 0;
    case 'DIGITOVER': return exitDigit > b;
    case 'DIGITUNDER': return exitDigit < b;
    case 'DIGITMATCH': return exitDigit === b;
    case 'DIGITDIFF': return exitDigit !== b;
    case 'CALL':
    case 'PUT':
      // Rise/fall cannot be settled from digits alone; the caller must supply prices.
      return false;
  }
}

function buildHonesty(i: BacktestSegment, o: BacktestSegment, cfg: BacktestConfig): string[] {
  const out: string[] = [];
  out.push(
    `In-sample: ${i.trades} trades, ${(i.winRate * 100).toFixed(1)}% win rate, EV ${i.ev.evPctOfStake >= 0 ? '+' : ''}${(i.ev.evPctOfStake * 100).toFixed(2)}% per trade.`,
  );
  out.push(
    `Out-of-sample (${Math.round((1 - (cfg.holdoutFraction ?? 0.3)) * 100)}% split): ${o.trades} trades, ${(o.winRate * 100).toFixed(1)}% win rate, EV ${o.ev.evPctOfStake >= 0 ? '+' : ''}${(o.ev.evPctOfStake * 100).toFixed(2)}% per trade.`,
  );
  if (o.trades < 10) {
    out.push('WARNING: fewer than 10 out-of-sample trades. This backtest cannot distinguish luck from edge. Collect more data before believing any result.');
  } else if (o.degraded) {
    out.push('DEGRADATION: the out-of-sample EV is materially worse than in-sample. The pattern was most likely fitted to noise. Do not deploy this on a real account on the strength of this backtest.');
  } else if (o.ev.evPctOfStake > 0) {
    out.push('The out-of-sample EV is positive, which is necessary but NOT sufficient evidence of an edge. Confirm on a Deriv demo account, with the broker\'s real quoted payouts, before risking money.');
  } else {
    out.push('The out-of-sample EV is negative. At these payout terms this strategy is expected to lose money over time.');
  }
  out.push('Payouts used here are the configured multiplier. Real Deriv payouts float with market conditions — always re-price from a live proposal before trading.');
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
