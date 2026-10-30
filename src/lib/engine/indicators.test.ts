import { describe, expect, it } from 'vitest';
import { bollinger, ema, rsi, sma } from './indicators';

describe('simple moving average', () => {
  it('averages exactly the last `period` values', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toBe(4);
    expect(sma([10, 20], 2)).toBe(15);
  });
  it('refuses a window shorter than the period instead of guessing', () => {
    expect(sma([1, 2], 3)).toBeNull();
    expect(sma([], 1)).toBeNull();
  });
  it('rejects nonsense periods', () => {
    expect(sma([1, 2, 3], 0)).toBeNull();
    expect(sma([1, 2, 3], NaN)).toBeNull();
  });
});

describe('exponential moving average', () => {
  it('seeds with the SMA then smooths with k = 2/(p+1)', () => {
    const v = [1, 2, 3, 4];
    const p = 2;
    const k = 2 / (p + 1);
    let e = (1 + 2) / 2; // seed
    e = 3 * k + e * (1 - k);
    e = 4 * k + e * (1 - k);
    expect(ema(v, p)).toBeCloseTo(e, 10);
  });
  it('equals the SMA on a constant series', () => {
    expect(ema([5, 5, 5, 5, 5], 3)).toBe(5);
  });
  it('needs at least `period` values', () => {
    expect(ema([1], 2)).toBeNull();
  });
});

describe('relative strength index', () => {
  it('is 100 on an all-gain window and 0 on an all-loss window', () => {
    const up = Array.from({ length: 20 }, (_, i) => i + 1);
    const down = Array.from({ length: 20 }, (_, i) => 20 - i);
    expect(rsi(up, 14)).toBe(100);
    expect(rsi(down, 14)).toBe(0);
  });
  it('is 50 when gains and losses cancel', () => {
    // The seed window balances (+1,-1,+1,-1); a flat tail then decays both
    // Wilder averages by the same factor each step, so they stay equal and the
    // index sits exactly at 50. An alternating tail would oscillate around 50
    // instead, which is Wilder smoothing behaving as defined.
    const v = [10, 11, 10, 11, 10, 10, 10, 10, 10, 10];
    expect(rsi(v, 4)).toBeCloseTo(50, 8);
  });
  it('stays inside 0-100 on a mixed series', () => {
    const v = [44, 44.5, 44.25, 43.75, 44.5, 44.25, 43.5, 43.75, 44.25, 44.5, 44.0, 43.5, 44.25, 44.5, 44.75, 45.0];
    const r = rsi(v, 14) as number;
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(100);
  });
  it('needs period + 1 values because the first change is unobservable', () => {
    expect(rsi([1, 2, 3], 5)).toBeNull();
  });
});

describe('bollinger bands', () => {
  it('centres on the SMA and widens by mult x population stddev', () => {
    const v = [1, 2, 3, 4, 5];
    const bb = bollinger(v, 5, 2) as { upper: number; middle: number; lower: number };
    expect(bb.middle).toBe(3);
    const sd = Math.sqrt(2); // population stddev of 1..5
    expect(bb.upper).toBeCloseTo(3 + 2 * sd, 10);
    expect(bb.lower).toBeCloseTo(3 - 2 * sd, 10);
  });
  it('collapses to a single line on a constant series', () => {
    const bb = bollinger([7, 7, 7, 7], 4) as { upper: number; middle: number; lower: number };
    expect(bb.upper).toBe(7);
    expect(bb.lower).toBe(7);
  });
  it('is null on a short window', () => {
    expect(bollinger([1, 2], 5)).toBeNull();
  });
});
