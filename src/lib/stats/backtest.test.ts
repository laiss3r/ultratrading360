import { describe, expect, it } from 'vitest';
import { backtest, type BacktestConfig } from './backtest';
import { expectedValue } from './ev';
import type { ConditionGroup } from '../engine/conditions';

const always: ConditionGroup = { id: 'root', op: 'AND', children: [{ id: 'a', kind: 'always' }] };
const never: ConditionGroup = { id: 'root', op: 'AND', children: [{ id: 'b', kind: 'match', barrier: 5 }, { id: 'c', kind: 'differ', barrier: 5 }] };
const oddGate: ConditionGroup = { id: 'root', op: 'AND', children: [{ id: 'o', kind: 'odd' }] };

/** A digit series with a KNOWN structure so outcomes can be predicted exactly. */
function patterned(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i % 10);
}

function cfg(over: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    digits: patterned(400),
    symbol: 'R_100',
    pipSize: 2,
    entry: always,
    contractType: 'DIGITODD',
    stake: 1,
    payoutMultiplier: 1.96,
    holdoutFraction: 0.3,
    cooldownTicks: 0,
    ...over,
  };
}

describe('backtest input guards', () => {
  it('refuses a sample too small to mean anything', () => {
    expect(() => backtest(cfg({ digits: patterned(49) }))).toThrow(RangeError);
    expect(() => backtest(cfg({ digits: patterned(50) }))).not.toThrow();
  });

  it('rejects a holdout fraction outside [0,1)', () => {
    expect(() => backtest(cfg({ holdoutFraction: 1 }))).toThrow(RangeError);
    expect(() => backtest(cfg({ holdoutFraction: -0.1 }))).toThrow(RangeError);
    expect(() => backtest(cfg({ holdoutFraction: 0.9 }))).not.toThrow();
  });
});

describe('backtest sample splitting', () => {
  it('splits at floor(n * (1 - holdout))', () => {
    const r = backtest(cfg({ digits: patterned(400), holdoutFraction: 0.3 }));
    expect(r.sampleSize).toBe(400);
    expect(r.splitIndex).toBe(Math.floor(400 * 0.7));
    expect(r.splitIndex).toBe(280);
  });

  it('in-sample + out-of-sample trades exactly equal the full-sample trades', () => {
    // This is the boundary regression: the split index must be claimed by exactly one segment.
    for (const holdout of [0.1, 0.2, 0.3, 0.5, 0.7]) {
      const r = backtest(cfg({ digits: patterned(401), holdoutFraction: holdout }));
      expect(r.inSample.trades + r.outOfSample.trades).toBe(r.full.trades);
    }
  });

  it('keeps every out-of-sample trade index at or beyond the split', () => {
    const r = backtest(cfg());
    for (const t of r.outOfSample.tradeList) expect(t.index).toBeGreaterThanOrEqual(r.splitIndex);
    for (const t of r.inSample.tradeList) expect(t.index).toBeLessThan(r.splitIndex);
  });

  it('a larger holdout moves the split earlier and grows the holdout segment', () => {
    const small = backtest(cfg({ holdoutFraction: 0.2 }));
    const large = backtest(cfg({ holdoutFraction: 0.6 }));
    expect(large.splitIndex).toBeLessThan(small.splitIndex);
    expect(large.outOfSample.trades).toBeGreaterThan(small.outOfSample.trades);
  });
});

describe('backtest has no lookahead', () => {
  it('evaluates the gate only on digits strictly BEFORE the settled digit', () => {
    // A gate on the parity of the most recent digit, settling DIGITODD. If the gate could see the
    // settling digit the win rate would be 100%; correctly it must be near 50%.
    const r = backtest(cfg({ entry: oddGate, contractType: 'DIGITODD', digits: patterned(2000) }));
    expect(r.full.trades).toBeGreaterThan(100);
    expect(r.full.winRate).toBeLessThan(0.75);
    // Every trade's entryDigit is the digit at index-1 and exitDigit the digit at index.
    for (const t of r.full.tradeList.slice(0, 50)) {
      expect(t.entryDigit % 2).toBe(1); // gate required odd
    }
  });

  it('settlement uses the digit at the trade index, not the entry digit', () => {
    const digits = patterned(200);
    const r = backtest(cfg({ digits, contractType: 'DIGITMATCH', barrier: 7 }));
    for (const t of r.full.tradeList) {
      expect(t.won).toBe(t.exitDigit === 7);
      expect(t.exitDigit).toBe(digits[t.index]);
      expect(t.entryDigit).toBe(digits[t.index - 1]);
    }
  });
});

describe('backtest settlement rules', () => {
  it('applies strict inequality for DIGITOVER so the barrier digit itself loses', () => {
    const r = backtest(cfg({ digits: patterned(300), contractType: 'DIGITOVER', barrier: 5 }));
    expect(r.full.trades).toBeGreaterThan(0);
    for (const t of r.full.tradeList) expect(t.won).toBe(t.exitDigit > 5);
    expect(r.full.tradeList.some((t) => t.exitDigit === 5 && !t.won)).toBe(true);
  });

  it('wins DIGITDIFF on everything except the barrier, and DIGITMATCH only on it', () => {
    const d = backtest(cfg({ digits: patterned(300), contractType: 'DIGITDIFF', barrier: 3 }));
    const m = backtest(cfg({ digits: patterned(300), contractType: 'DIGITMATCH', barrier: 3 }));
    for (const t of d.full.tradeList) expect(t.won).toBe(t.exitDigit !== 3);
    for (const t of m.full.tradeList) expect(t.won).toBe(t.exitDigit === 3);
    // patterned(300) yields 299 candidate trades (i = 1..299) in which the digit 5 occurs exactly
    // 30 times, so DIFF wins 269/299 and MATCH 30/299 -- NOT a clean 0.9/0.1. Asserting the exact
    // counts is a stronger check than a loose approximation.
    expect(d.full.trades).toBe(299);
    expect(d.full.wins).toBe(269);
    expect(d.full.winRate).toBeCloseTo(269 / 299, 10);
    expect(m.full.wins).toBe(30);
    expect(m.full.winRate).toBeCloseTo(30 / 299, 10);
  });

  it('a gate that can never pass produces zero trades, not an error', () => {
    const r = backtest(cfg({ entry: never }));
    expect(r.full.trades).toBe(0);
    expect(r.inSample.trades).toBe(0);
    expect(r.outOfSample.trades).toBe(0);
    expect(r.full.winRate).toBe(0);
    expect(r.equityCurve.length).toBeGreaterThan(0);
  });
});

describe('backtest payout-aware arithmetic', () => {
  it('profit is payout - stake on a win and -stake on a loss', () => {
    const r = backtest(cfg({ stake: 2, payoutMultiplier: 1.96 }));
    for (const t of r.full.tradeList) {
      expect(t.payout).toBeCloseTo(3.92, 6);
      expect(t.profit).toBeCloseTo(t.won ? 1.92 : -2, 6);
    }
  });

  it('segment EV equals expectedValue() on that segment\'s own win rate and payout', () => {
    const r = backtest(cfg({ stake: 1, payoutMultiplier: 1.96 }));
    for (const seg of [r.inSample, r.outOfSample, r.full]) {
      const want = expectedValue(seg.trades ? seg.wins / seg.trades : 0, 1, 1.96);
      expect(seg.ev.evPerTrade).toBeCloseTo(want.evPerTrade, 10);
      // Compare against expectedValue()'s OWN break-even, which is reported rounded to 4dp.
      expect(seg.ev.breakEvenProbability).toBeCloseTo(want.breakEvenProbability, 10);
      expect(seg.ev.breakEvenProbability).toBeCloseTo(1 / 1.96, 3);
    }
  });

  it('net profit equals the sum of trade profits', () => {
    const r = backtest(cfg({ digits: patterned(500) }));
    const sum = r.full.tradeList.reduce((a, t) => a + t.profit, 0);
    expect(r.full.netProfit).toBeCloseTo(sum, 2);
  });

  it('a payout below break-even makes a 90% win rate lose money', () => {
    // DIGITDIFF wins 9/10. At 1.05x the break-even probability is 1/1.05 = 95.2%, so it loses.
    const r = backtest(cfg({ digits: patterned(1000), contractType: 'DIGITDIFF', barrier: 5, payoutMultiplier: 1.05 }));
    // 999 trades, barrier 5 hit 100 times => 899 wins.
    expect(r.full.trades).toBe(999);
    expect(r.full.wins).toBe(899);
    expect(r.full.winRate).toBeCloseTo(899 / 999, 10);
    expect(r.full.ev.breakEvenProbability).toBeCloseTo(1 / 1.05, 3);
    expect(r.full.ev.evPerTrade).toBeLessThan(0);
    expect(r.full.netProfit).toBeLessThan(0);
  });

  it('the same strategy is profitable above break-even and unprofitable below it', () => {
    const good = backtest(cfg({ contractType: 'DIGITDIFF', barrier: 5, payoutMultiplier: 1.2 }));
    const bad = backtest(cfg({ contractType: 'DIGITDIFF', barrier: 5, payoutMultiplier: 1.05 }));
    expect(good.full.netProfit).toBeGreaterThan(0);
    expect(bad.full.netProfit).toBeLessThan(0);
  });
});

describe('backtest cooldown', () => {
  it('an unconditional gate trades on nearly every tick with no cooldown', () => {
    const r = backtest(cfg({ digits: patterned(400), cooldownTicks: 0 }));
    // runRange evaluates i = 1..n-1 => 399 candidate indices.
    expect(r.full.trades).toBe(399);
  });

  it('enforces a minimum spacing between consecutive trades', () => {
    const r = backtest(cfg({ digits: patterned(400), cooldownTicks: 5 }));
    const idx = r.full.tradeList.map((t) => t.index);
    for (let i = 1; i < idx.length; i++) expect(idx[i] - idx[i - 1]).toBeGreaterThanOrEqual(5);
    expect(r.full.trades).toBeLessThan(399);
  });

  it('a longer cooldown produces strictly fewer trades', () => {
    const a = backtest(cfg({ cooldownTicks: 2 }));
    const b = backtest(cfg({ cooldownTicks: 10 }));
    expect(b.full.trades).toBeLessThan(a.full.trades);
  });
});

describe('backtest degradation detection', () => {
  it('leaves `degraded` undefined when either segment has too few trades to judge', () => {
    const r = backtest(cfg({ entry: never }));
    expect(r.outOfSample.degraded).toBeUndefined();
  });

  it('flags degradation when holdout EV falls materially below in-sample EV', () => {
    // In-sample (first 70%) is ALL ODD digits, so a DIGITODD contract wins every trade.
    // Out-of-sample (last 30%) is ALL EVEN, so it loses every trade.
    const digits = [...new Array(700).fill(1), ...new Array(300).fill(2)];
    const r = backtest(cfg({ digits, contractType: 'DIGITODD', payoutMultiplier: 1.96, holdoutFraction: 0.3 }));
    expect(r.inSample.trades).toBeGreaterThanOrEqual(20);
    expect(r.outOfSample.trades).toBeGreaterThanOrEqual(10);
    expect(r.inSample.winRate).toBe(1);
    expect(r.outOfSample.winRate).toBe(0);
    expect(r.outOfSample.degraded).toBe(true);
  });

  it('does NOT flag degradation on a stable series', () => {
    const r = backtest(cfg({ digits: patterned(1000), contractType: 'DIGITODD', payoutMultiplier: 1.96 }));
    expect(r.inSample.trades).toBeGreaterThanOrEqual(20);
    expect(r.outOfSample.trades).toBeGreaterThanOrEqual(10);
    expect(r.outOfSample.degraded).toBe(false);
  });
});

describe('backtest honesty reporting', () => {
  it('always returns non-empty, substantive caveats', () => {
    const r = backtest(cfg());
    expect(r.honesty.length).toBeGreaterThan(0);
    for (const h of r.honesty) expect(h.length).toBeGreaterThan(20);
  });

  it('mentions the out-of-sample holdout and refuses to claim prediction', () => {
    const r = backtest(cfg());
    const joined = r.honesty.join(' ').toLowerCase();
    expect(joined).toMatch(/out-of-sample|holdout/);
    expect(joined).not.toMatch(/guarantee[ds]? (a )?profit/);
  });

  it('calls out a small sample explicitly', () => {
    const tiny = backtest(cfg({ digits: patterned(60) }));
    expect(tiny.honesty.join(' ').toLowerCase()).toMatch(/sample|small|few/);
  });
});

describe('backtest determinism and reporting', () => {
  it('is a pure function of its configuration', () => {
    const a = backtest(cfg({ digits: patterned(500) }));
    const b = backtest(cfg({ digits: patterned(500) }));
    expect(a.full.tradeList).toEqual(b.full.tradeList);
    expect(a.equityCurve).toEqual(b.equityCurve);
    expect(a.splitIndex).toBe(b.splitIndex);
  });

  it('returns an equity curve whose length matches the full trade count', () => {
    const r = backtest(cfg({ digits: patterned(500) }));
    expect(r.equityCurve.length).toBe(r.full.trades + 1);
  });

  it('echoes the resolved configuration, including defaults', () => {
    const r = backtest({ ...cfg(), holdoutFraction: undefined, cooldownTicks: undefined });
    expect(r.config.holdoutFraction).toBe(0.3);
    expect(r.config.cooldownTicks).toBe(0);
    expect(r.config.symbol).toBe('R_100');
  });

  it('records the gate reasons on every trade so a signal is never a black box', () => {
    const r = backtest(cfg({ entry: oddGate, digits: patterned(400) }));
    expect(r.full.trades).toBeGreaterThan(0);
    for (const t of r.full.tradeList) expect(t.gateReasons.length).toBeGreaterThan(0);
  });
});
