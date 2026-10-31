import { describe, expect, it } from 'vitest';
import { breakdown, computeMetrics, dominantSource, drawdown, equityCurve } from './metrics';
import type { TradeRecord } from './engine/bot';

const tr = (o: Partial<TradeRecord>): TradeRecord => ({
  id: 'x', idempotencyKey: 'k', strategyId: 's', strategyName: 'S', strategyVersion: 1,
  symbol: 'R_100', contractType: 'DIGITODD', stake: 1, payout: 1.96, profit: 0.96, won: true,
  openedAt: 0, closedAt: 0, mode: 'deriv_demo', source: 'deriv_live',
  balanceBefore: 0, balanceAfter: 0, riskReasons: [], gateReasons: [], ...o,
});

describe('performance metrics from contract records', () => {
  it('computes win rate, net profit and profit factor', () => {
    const trades = [
      tr({ won: true, stake: 1, payout: 1.96, profit: 0.96 }),
      tr({ won: true, stake: 1, payout: 1.96, profit: 0.96 }),
      tr({ won: false, stake: 1, payout: 0, profit: -1 }),
      tr({ won: false, stake: 1, payout: 0, profit: -1 }),
    ];
    const m = computeMetrics(trades, 100);
    expect(m.settledCount).toBe(4);
    expect(m.wins).toBe(2);
    expect(m.losses).toBe(2);
    expect(m.winRate).toBe(0.5);
    expect(m.netProfit).toBeCloseTo(-0.08, 10);
    expect(m.grossWin).toBeCloseTo(1.92, 10);
    expect(m.grossLoss).toBeCloseTo(2, 10);
    expect(m.profitFactor).toBeCloseTo(0.96, 10);
    expect(m.totalStaked).toBe(4);
    expect(m.totalPayout).toBeCloseTo(3.92, 10);
    expect(m.endingBalance).toBeCloseTo(99.92, 10);
  });

  it('EV per trade reflects the payout asymmetry, not just the win rate', () => {
    // 90% win rate at 1.05x payout is a LOSER.
    const trades = [
      ...Array.from({ length: 9 }, () => tr({ won: true, stake: 1, payout: 1.05, profit: 0.05 })),
      tr({ won: false, stake: 1, payout: 0, profit: -1 }),
    ];
    const m = computeMetrics(trades, 100);
    expect(m.winRate).toBeCloseTo(0.9, 10);
    expect(m.expectedValuePerTrade).toBeLessThan(0);
    expect(m.netProfit).toBeCloseTo(9 * 0.05 - 1, 6);
  });

  it('profitFactor is null with no losses and Infinity with no losses but wins', () => {
    expect(computeMetrics([], 100).profitFactor).toBeNull();
    expect(computeMetrics([tr({ won: true, profit: 1 })], 100).profitFactor).toBe(Infinity);
  });

  it('excludes errored trades from win rate but counts them', () => {
    const trades = [tr({ won: true, profit: 1 }), tr({ won: false, profit: 0, error: 'NOT AUTHORIZED', stake: 0 })];
    const m = computeMetrics(trades, 100);
    expect(m.tradeCount).toBe(2);
    expect(m.settledCount).toBe(1);
    expect(m.errorCount).toBe(1);
    expect(m.winRate).toBe(1);
    expect(m.totalStaked).toBe(1); // errored trade staked nothing
  });

  it('tracks consecutive streaks', () => {
    const trades = [
      tr({ won: false, profit: -1 }), tr({ won: false, profit: -1 }), tr({ won: false, profit: -1 }),
      tr({ won: true, profit: 1 }), tr({ won: true, profit: 1 }),
      tr({ won: false, profit: -1 }),
    ];
    const m = computeMetrics(trades, 100);
    expect(m.maxConsecutiveLosses).toBe(3);
    expect(m.maxConsecutiveWins).toBe(2);
  });

  it('handles an empty ledger without NaN', () => {
    const m = computeMetrics([], 500);
    expect(m.tradeCount).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.netProfit).toBe(0);
    expect(m.maxDrawdown).toBe(0);
    expect(m.endingBalance).toBe(500);
    expect(Number.isNaN(m.expectedValuePerTrade)).toBe(false);
  });
});

describe('drawdown', () => {
  it('measures peak-to-trough, not start-to-end', () => {
    // +10 then -15 then +20: peak 110, trough 95 -> DD 15 even though it ends up.
    const d = drawdown([10, -15, 20], 100);
    expect(d.maxDrawdown).toBe(15);
    expect(d.endingBalance).toBe(115);
    expect(d.maxDrawdownPct).toBeCloseTo(15 / 110, 6);
  });

  it('is zero for a monotonic gain', () => {
    expect(drawdown([1, 2, 3], 100).maxDrawdown).toBe(0);
  });

  it('tracks the running peak across multiple drawdowns', () => {
    const d = drawdown([5, -2, 10, -20, 1], 100);
    // equity: 105,103,113,93,94 -> peak 113, trough 93 -> DD 20
    expect(d.maxDrawdown).toBe(20);
    expect(d.endingBalance).toBe(94);
  });

  it('equityCurve has one more point than there are trades', () => {
    expect(equityCurve([1, 2, 3], 100)).toEqual([100, 101, 103, 106]);
  });

  it('returns the starting balance alone for an empty series', () => {
    expect(equityCurve([], 100)).toEqual([100]);
  });
});

describe('provenance labelling', () => {
  it('every executed contract is Deriv-executed', () => {
    expect(dominantSource([tr({})])).toBe('deriv_live');
    expect(dominantSource([tr({ mode: 'deriv_real' })])).toBe('deriv_live');
  });
  it('reports none for an empty set', () => {
    expect(dominantSource([])).toBe('none');
  });
  it('keeps the account mode on every record so the UI can separate demo from real', () => {
    expect(tr({ mode: 'deriv_real' }).mode).toBe('deriv_real');
    expect(tr({}).mode).toBe('deriv_demo');
  });
});

describe('breakdown by market, strategy and contract type', () => {
  it('partitions correctly and sorts by profit', () => {
    const trades = [
      tr({ symbol: 'R_100', strategyName: 'A', contractType: 'DIGITODD', profit: 5, won: true }),
      tr({ symbol: 'R_100', strategyName: 'A', contractType: 'DIGITODD', profit: -2, won: false }),
      tr({ symbol: '1HZ100V', strategyName: 'B', contractType: 'DIGITEVEN', profit: 10, won: true }),
    ];
    const b = breakdown(trades);
    expect(b.byMarket).toHaveLength(2);
    expect(b.byMarket[0].name).toBe('1HZ100V'); // higher profit first
    expect(b.byMarket[0].metrics.netProfit).toBe(10);
    expect(b.byStrategy.map((x) => x.name)).toEqual(['B v1', 'A v1']);
    expect(b.byContractType).toHaveLength(2);
    expect(b.byMarket.find((x) => x.name === 'R_100')!.metrics.settledCount).toBe(2);
  });

  it('labels every bucket as Deriv-executed and preserves the account mode of each record', () => {
    const trades = [tr({ symbol: 'R_100', mode: 'deriv_demo', profit: 5 }), tr({ symbol: 'R_100', mode: 'deriv_real', profit: -5 })];
    const bucket = breakdown(trades).byMarket[0];
    expect(bucket.source).toBe('deriv_live');
    expect(trades.map((t) => t.mode)).toEqual(['deriv_demo', 'deriv_real']);
  });
});


it('counts actual partial gross returns on losing sold contracts and separates zero-net settlements',()=>{
 const m=computeMetrics([tr({won:false,stake:1,payout:.5,profit:-.5}),tr({won:false,stake:1,payout:1,profit:0})]);
 expect(m.totalPayout).toBe(1.5);expect(m.netProfit).toBe(-.5);expect(m.losses).toBe(1);expect(m.wins).toBe(0);expect(m.settledCount).toBe(2);
});
