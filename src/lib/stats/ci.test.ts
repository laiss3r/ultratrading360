import { describe, expect, it } from 'vitest';
import { clopperPearson, excludesTheoretical, meanInterval, proportionTest, tCritical, wilsonInterval } from './ci';

describe('Wilson score interval', () => {
  it('matches the Wilson bounds for n=100, k=50 at 95%', () => {
    const iv = wilsonInterval(50, 100, 0.95);
    expect(iv.point).toBe(0.5);
    expect(iv.lower).toBeCloseTo(0.403832, 5);
    expect(iv.upper).toBeCloseTo(0.596168, 5);
  });

  /**
   * Cross-check against the DEFINING property of the Wilson interval: its bounds are the two
   * roots of (p - p_hat)^2 = z^2 * p(1-p)/n. Deriving them by solving the quadratic is an
   * independent path to the same numbers, so this catches any algebra slip in the closed form.
   */
  it('equals the roots of the defining quadratic', () => {
    const z = 1.959963985;
    const roots = (k: number, n: number) => {
      const p = k / n;
      const a = 1 + (z * z) / n;
      const b = -2 * p - (z * z) / n;
      const c = p * p;
      const disc = b * b - 4 * a * c;
      return [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)];
    };
    for (const [k, n] of [[50, 100], [1, 10], [30, 100], [500, 1000], [7, 37], [99, 100]] as const) {
      const iv = wilsonInterval(k, n, 0.95);
      const [lo, hi] = roots(k, n);
      expect(iv.lower).toBeCloseTo(lo, 9);
      expect(iv.upper).toBeCloseTo(hi, 9);
    }
  });

  it('is well behaved at the boundaries where Wald fails', () => {
    const zero = wilsonInterval(0, 20);
    expect(zero.lower).toBe(0);
    expect(zero.upper).toBeGreaterThan(0); // Wald would give [0,0]
    const all = wilsonInterval(20, 20);
    expect(all.upper).toBe(1);
    expect(all.lower).toBeLessThan(1);
  });

  it('narrows as n grows', () => {
    const small = wilsonInterval(5, 10);
    const large = wilsonInterval(500, 1000);
    expect(small.upper - small.lower).toBeGreaterThan(large.upper - large.lower);
    expect(large.point).toBe(0.5);
  });

  it('widens at a higher confidence level', () => {
    const a = wilsonInterval(50, 100, 0.9);
    const b = wilsonInterval(50, 100, 0.99);
    expect(b.upper - b.lower).toBeGreaterThan(a.upper - a.lower);
  });

  it('handles n=0 without dividing by zero', () => {
    expect(wilsonInterval(0, 0)).toEqual({ lower: 0, upper: 1, point: 0, level: 0.95 });
  });
});

describe('Clopper-Pearson exact interval', () => {
  it('contains the Wilson interval (it is the conservative one)', () => {
    const cp = clopperPearson(50, 100);
    const w = wilsonInterval(50, 100);
    expect(cp.lower).toBeLessThanOrEqual(w.lower + 1e-9);
    expect(cp.upper).toBeGreaterThanOrEqual(w.upper - 1e-9);
  });

  it('matches the exact binomial definition', () => {
    // k=0, n=10, 95% -> upper = 1 - 0.025^(1/10) = 0.2589
    const cp = clopperPearson(0, 10, 0.95);
    expect(cp.lower).toBe(0);
    expect(cp.upper).toBeCloseTo(1 - Math.pow(0.025, 1 / 10), 4);
  });

  it('is exact at the extremes', () => {
    expect(clopperPearson(0, 5).lower).toBe(0);
    expect(clopperPearson(5, 5).upper).toBe(1);
  });
});

describe('proportion test', () => {
  it('does not reject a fair 50/50 outcome', () => {
    const r = proportionTest(500, 1000, 0.5);
    expect(r.pValue).toBeGreaterThan(0.05);
    expect(Math.abs(r.z)).toBeLessThan(1.96);
  });

  it('rejects a clearly biased proportion', () => {
    const r = proportionTest(600, 1000, 0.5);
    expect(r.pValue).toBeLessThan(0.001);
    expect(r.z).toBeGreaterThan(3);
  });

  it('applies the continuity correction', () => {
    const withCc = proportionTest(51, 100, 0.5, true);
    const withoutCc = proportionTest(51, 100, 0.5, false);
    expect(Math.abs(withCc.z)).toBeLessThan(Math.abs(withoutCc.z));
  });

  it('is safe on degenerate inputs', () => {
    expect(proportionTest(0, 0, 0.5).pValue).toBe(1);
    expect(proportionTest(5, 10, 0).pValue).toBe(1);
    expect(proportionTest(5, 10, 1).pValue).toBe(1);
  });
});

describe('mean interval (Student-t)', () => {
  it('covers the true mean for a normal sample', () => {
    const r = (() => { let s = 42; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();
    const vals = Array.from({ length: 200 }, () => r() * 10 - 5); // mean ~0
    const iv = meanInterval(vals);
    expect(iv.lower).toBeLessThan(0.5);
    expect(iv.upper).toBeGreaterThan(-0.5);
    expect(iv.n).toBe(200);
    expect(iv.sd).toBeGreaterThan(0);
  });

  it('matches the textbook t critical values', () => {
    expect(tCritical(0.95, 10)).toBeCloseTo(2.228, 2);
    expect(tCritical(0.95, 1)).toBeCloseTo(12.706, 1);
    expect(tCritical(0.99, 30)).toBeCloseTo(2.75, 1);
  });

  it('narrows with more data', () => {
    const vals = Array.from({ length: 100 }, (_, i) => (i % 7) - 3);
    const small = meanInterval(vals.slice(0, 20));
    const large = meanInterval(vals);
    expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower);
  });

  it('is defined for n<2', () => {
    expect(meanInterval([]).n).toBe(0);
    expect(Number.isNaN(meanInterval([5]).lower)).toBe(true);
  });
});

describe('excludesTheoretical', () => {
  it('detects an interval that excludes the fair value', () => {
    expect(excludesTheoretical({ lower: 0.12, upper: 0.18, point: 0.15, level: 0.95 }, 0.1)).toBe(true);
    expect(excludesTheoretical({ lower: 0.05, upper: 0.09, point: 0.07, level: 0.95 }, 0.1)).toBe(true);
  });
  it('does not flag an interval containing the fair value', () => {
    expect(excludesTheoretical({ lower: 0.08, upper: 0.12, point: 0.1, level: 0.95 }, 0.1)).toBe(false);
  });
});
