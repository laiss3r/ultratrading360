import type { TradeRecord } from './engine/bot';

export interface PerformanceMetrics {
  tradeCount: number;
  settledCount: number;
  errorCount: number;
  wins: number;
  losses: number;
  winRate: number;
  totalStaked: number;
  totalPayout: number;
  netProfit: number;
  grossWin: number;
  grossLoss: number;
  profitFactor: number | null;
  expectedValuePerTrade: number;
  averageStake: number;
  averageWin: number;
  averageLoss: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  maxConsecutiveLosses: number;
  maxConsecutiveWins: number;
  startingBalance: number;
  endingBalance: number;
  returnPct: number;
}

/**
 * Compute real results from contract records.
 *
 * Conventions:
 *  - profit = payout - stake on a win, -stake on a loss (taken from the settled contract,
 *    never recomputed from an assumed payout).
 *  - profitFactor = grossWin / |grossLoss|, null when there are no losses.
 *  - drawdown is measured on the realised equity curve, peak-to-trough, in currency and %.
 *  - EV per trade is the mean realised profit — which, unlike win rate, already accounts for
 *    the payout asymmetry. A 90% win rate at 1.05x payout is a losing proposition and this
 *    metric shows it.
 */
export function computeMetrics(trades: TradeRecord[], startingBalance = 0): PerformanceMetrics {
  const settled = trades.filter((t) => !t.error);
  const errors = trades.filter((t) => !!t.error);
  const wins = settled.filter((t) => t.won);
  const losses = settled.filter((t) => !t.won);

  const totalStaked = round2(settled.reduce((a, t) => a + t.stake, 0));
  const totalPayout = round2(settled.reduce((a, t) => a + (t.won ? t.payout : 0), 0));
  const netProfit = round2(settled.reduce((a, t) => a + t.profit, 0));
  const grossWin = round2(wins.reduce((a, t) => a + t.profit, 0));
  const grossLoss = round2(Math.abs(losses.reduce((a, t) => a + t.profit, 0)));

  const { maxDrawdown, maxDrawdownPct, endingBalance } = drawdown(
    settled.map((t) => t.profit),
    startingBalance,
  );

  const { maxConsecutiveLosses, maxConsecutiveWins } = streaks(settled.map((t) => t.won));

  const ending = round2(startingBalance + netProfit);
  return {
    tradeCount: trades.length,
    settledCount: settled.length,
    errorCount: errors.length,
    wins: wins.length,
    losses: losses.length,
    winRate: settled.length ? wins.length / settled.length : 0,
    totalStaked,
    totalPayout,
    netProfit,
    grossWin,
    grossLoss,
    profitFactor: grossLoss > 0 ? round4(grossWin / grossLoss) : grossWin > 0 ? Infinity : null,
    expectedValuePerTrade: settled.length ? round4(netProfit / settled.length) : 0,
    averageStake: settled.length ? round2(totalStaked / settled.length) : 0,
    averageWin: wins.length ? round2(grossWin / wins.length) : 0,
    averageLoss: losses.length ? round2(-grossLoss / losses.length) : 0,
    maxDrawdown: round2(maxDrawdown),
    maxDrawdownPct: round4(maxDrawdownPct),
    maxConsecutiveLosses,
    maxConsecutiveWins,
    startingBalance: round2(startingBalance),
    endingBalance: ending || round2(endingBalance),
    returnPct: startingBalance > 0 ? round4(netProfit / startingBalance) : 0,
  };
}

/** Peak-to-trough drawdown over a realised P/L series. */
export function drawdown(profits: number[], startingBalance = 0) {
  let equity = startingBalance;
  let peak = startingBalance;
  let maxDD = 0;
  let maxDDPct = 0;
  const curve: number[] = [startingBalance];
  for (const p of profits) {
    equity += p;
    curve.push(round2(equity));
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) {
      maxDD = dd;
      maxDDPct = peak > 0 ? dd / peak : 0;
    }
  }
  return { maxDrawdown: maxDD, maxDrawdownPct: maxDDPct, endingBalance: round2(equity), curve };
}

export function equityCurve(profits: number[], startingBalance = 0): number[] {
  return drawdown(profits, startingBalance).curve;
}

function streaks(outcomes: boolean[]) {
  let maxL = 0;
  let maxW = 0;
  let cl = 0;
  let cw = 0;
  for (const w of outcomes) {
    if (w) {
      cw++;
      cl = 0;
      maxW = Math.max(maxW, cw);
    } else {
      cl++;
      cw = 0;
      maxL = Math.max(maxL, cl);
    }
  }
  return { maxConsecutiveLosses: maxL, maxConsecutiveWins: maxW };
}

/** Per-market and per-strategy breakdown. */
export function breakdown(trades: TradeRecord[]) {
  const by = (key: (t: TradeRecord) => string) => {
    const m = new Map<string, TradeRecord[]>();
    for (const t of trades) {
      const k = key(t);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return [...m.entries()]
      .map(([name, list]) => ({ name, metrics: computeMetrics(list), source: dominantSource(list) }))
      .sort((a, b) => b.metrics.netProfit - a.metrics.netProfit);
  };
  return {
    byMarket: by((t) => t.symbol),
    byStrategy: by((t) => `${t.strategyName} v${t.strategyVersion}`),
    byContractType: by((t) => t.contractType),
  };
}

/**
 * Which provenance dominates a set of trades. Used to label a table so simulated and real
 * results are never silently aggregated together.
 */
export function dominantSource(trades: TradeRecord[]): 'simulation' | 'deriv_live' | 'mixed' | 'none' {
  const s = new Set(trades.map((t) => t.source));
  if (s.size === 0) return 'none';
  if (s.size === 1) return [...s][0];
  return 'mixed';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
