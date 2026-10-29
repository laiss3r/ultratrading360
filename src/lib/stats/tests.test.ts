import { describe, expect, it } from 'vitest';
import {
  autocorrelation, chiSquareUniformity, digitFrequency, ljungBox, rollingDigitFrequency, runsTest, transitionMatrix,
} from './tests';
import { mulberry32 } from '../engine/rng';

const uniform = (n: number, seed = 7) => {
  const r = mulberry32(seed);
  return Array.from({ length: n }, () => Math.floor(r() * 10));
};

describe('chi-square goodness of fit vs uniform', () => {
  it('does NOT reject a genuinely uniform sample', () => {
    const res = chiSquareUniformity(uniform(5000));
    expect(res.df).toBe(9);
    expect(res.pValue).toBeGreaterThan(0.05);
    expect(res.significant).toBe(false);
  });

  it('DOES reject a biased sample', () => {
    // 40% sevens, 60% spread over the rest
    const r = mulberry32(3);
    const digits = Array.from({ length: 5000 }, () => (r() < 0.4 ? 7 : Math.floor(r() * 10)));
    const res = chiSquareUniformity(digits);
    expect(res.pValue).toBeLessThan(0.001);
    expect(res.significant).toBe(true);
  });

  it('reproduces a hand-computed statistic', () => {
    // 100 digits, each digit appearing exactly 10 times -> chi2 = 0
    const digits = Array.from({ length: 100 }, (_, i) => i % 10);
    const res = chiSquareUniformity(digits);
    expect(res.statistic).toBeCloseTo(0, 10);
    expect(res.pValue).toBeCloseTo(1, 6);
  });

  it('matches the textbook example: n=200, counts 30,20,20,20,20,20,20,20,15,15', () => {
    const counts = [30, 20, 20, 20, 20, 20, 20, 20, 15, 15];
    const digits: number[] = [];
    counts.forEach((c, d) => { for (let i = 0; i < c; i++) digits.push(d); });
    const res = chiSquareUniformity(digits);
    // expected 20 each: (100+0+0+0+0+0+0+0+25+25)/20 = 7.5
    expect(res.statistic).toBeCloseTo(7.5, 6);
    expect(res.df).toBe(9);
    expect(res.pValue).toBeGreaterThan(0.5); // 7.5 with df=9 is unremarkable
  });

  it('refuses to draw a conclusion from a small sample', () => {
    const res = chiSquareUniformity([1, 2, 3]);
    expect(Number.isNaN(res.pValue)).toBe(true);
    expect(res.significant).toBe(false);
    expect(res.interpretation).toMatch(/Insufficient sample/);
  });

  it('the interpretation never claims predictability', () => {
    const r = mulberry32(11);
    const biased = Array.from({ length: 3000 }, () => (r() < 0.35 ? 2 : Math.floor(r() * 10)));
    const res = chiSquareUniformity(biased);
    expect(res.significant).toBe(true);
    expect(res.interpretation).toMatch(/ANOMALY/i);
    expect(res.interpretation).not.toMatch(/will continue|guarantee|predictive edge/i);
  });
});

describe('digit frequency with confidence intervals', () => {
  it('returns all ten digits summing to the sample size', () => {
    const digits = uniform(1000);
    const freq = digitFrequency(digits);
    expect(freq).toHaveLength(10);
    expect(freq.reduce((a, f) => a + f.count, 0)).toBe(1000);
    expect(freq.reduce((a, f) => a + f.observedPct, 0)).toBeCloseTo(100, 6);
  });

  it('brackets the observed proportion inside the Wilson interval', () => {
    const freq = digitFrequency(uniform(2000));
    for (const f of freq) {
      // ciLower/ciUpper/observedPct are all expressed in PERCENT.
      expect(f.ciLower).toBeLessThanOrEqual(f.observedPct + 1e-9);
      expect(f.ciUpper).toBeGreaterThanOrEqual(f.observedPct - 1e-9);
      expect(f.expectedPct).toBe(10);
    }
  });

  it('flags a genuinely anomalous digit and not a fair one', () => {
    const fair = digitFrequency(uniform(5000, 99));
    expect(fair.some((f) => f.anomalous)).toBe(false);

    const r = mulberry32(5);
    const biased = Array.from({ length: 5000 }, () => (r() < 0.25 ? 4 : Math.floor(r() * 10)));
    const freq = digitFrequency(biased);
    expect(freq[4].anomalous).toBe(true);
    expect(freq[4].ciLower).toBeGreaterThan(10); // percent scale, above the fair 10%
  });

  it('handles an empty sample without dividing by zero', () => {
    const freq = digitFrequency([]);
    expect(freq.every((f) => f.count === 0 && f.observedPct === 0 && !f.anomalous)).toBe(true);
  });
});

describe('runs test (Wald-Wolfowitz)', () => {
  it('accepts independent alternating-coin randomness', () => {
    const r = mulberry32(21);
    const seq = Array.from({ length: 4000 }, () => r() < 0.5);
    const res = runsTest(seq);
    expect(res.pValue).toBeGreaterThan(0.05);
    expect(res.significant).toBe(false);
  });

  it('detects clustering (too few runs)', () => {
    // Long blocks -> very few runs
    const seq: boolean[] = [];
    for (let b = 0; b < 20; b++) for (let i = 0; i < 100; i++) seq.push(b % 2 === 0);
    const res = runsTest(seq);
    expect(res.pValue).toBeLessThan(0.001);
    expect(res.statistic).toBeLessThan(0);
    expect(res.interpretation).toMatch(/clustered/);
  });

  it('detects excessive alternation (too many runs)', () => {
    const seq = Array.from({ length: 2000 }, (_, i) => i % 2 === 0);
    const res = runsTest(seq);
    expect(res.pValue).toBeLessThan(0.001);
    expect(res.statistic).toBeGreaterThan(0);
    expect(res.interpretation).toMatch(/alternating/);
  });

  it('handles degenerate and short inputs without producing a false signal', () => {
    expect(runsTest(new Array(50).fill(true)).interpretation).toMatch(/Degenerate/);
    expect(runsTest([true, false, true]).interpretation).toMatch(/Insufficient/);
    expect(runsTest([]).sampleSize).toBe(0);
  });

  it('matches the textbook expectation formula', () => {
    // n1=n2=50 -> E(R) = 2*50*50/100 + 1 = 51
    const seq = Array.from({ length: 100 }, (_, i) => i < 50);
    const res = runsTest(seq);
    expect(res.interpretation).toMatch(/51\.0 expected/);
  });
});

describe('autocorrelation and Ljung-Box', () => {
  it('finds no autocorrelation in uniform digits', () => {
    const acf = autocorrelation(uniform(5000), 5);
    expect(acf).toHaveLength(5);
    for (const a of acf) expect(Math.abs(a.acf)).toBeLessThan(a.bound * 1.6);
  });

  it('detects a strongly autocorrelated series at lag 1', () => {
    // x_t = x_{t-1} mod 10 with a slow drift -> high lag-1 correlation
    const series: number[] = [];
    let v = 5;
    for (let i = 0; i < 3000; i++) {
      series.push(v);
      v = (v + (i % 50 < 25 ? 1 : -1) + 10) % 10;
    }
    const acf = autocorrelation(series, 3);
    expect(Math.abs(acf[0].acf)).toBeGreaterThan(acf[0].bound);
    expect(acf[0].significant).toBe(true);
  });

  it('the 95% band is 1.96/sqrt(n)', () => {
    const acf = autocorrelation(uniform(1000), 1);
    expect(acf[0].bound).toBeCloseTo(1.96 / Math.sqrt(1000), 3);
  });

  it('Ljung-Box agrees with per-lag results on random data', () => {
    const res = ljungBox(uniform(4000, 55), 10);
    expect(res.df).toBe(10);
    expect(res.pValue).toBeGreaterThan(0.05);
    expect(res.interpretation).toMatch(/No serial dependence/);
  });

  it('Ljung-Box flags dependence', () => {
    const series: number[] = [];
    for (let i = 0; i < 3000; i++) series.push(i % 3);
    const res = ljungBox(series, 10);
    expect(res.pValue).toBeLessThan(0.001);
    expect(res.significant).toBe(true);
  });

  it('refuses small samples', () => {
    expect(autocorrelation([1, 2, 3], 3)).toHaveLength(0);
    expect(ljungBox([1, 2, 3], 5).interpretation).toMatch(/Insufficient/);
  });
});

describe('transition matrix (does digit t predict t+1?)', () => {
  it('finds no dependence in uniform digits', () => {
    const res = transitionMatrix(uniform(8000, 123));
    expect(res.df).toBe(81);
    expect(res.pValue).toBeGreaterThan(0.05);
    expect(res.cramersV).toBeLessThan(0.05);
  });

  it('detects a deterministic successor rule', () => {
    const series = Array.from({ length: 2000 }, (_, i) => i % 10);
    const res = transitionMatrix(series);
    expect(res.pValue).toBeLessThan(0.001);
    expect(res.significant).toBe(true);
    expect(res.cramersV).toBeGreaterThan(0.5);
  });

  it('warns that significance at large n is not effect size', () => {
    const series = Array.from({ length: 2000 }, (_, i) => i % 10);
    expect(transitionMatrix(series).interpretation).toMatch(/effect size/);
  });

  it('refuses insufficient pairs', () => {
    const res = transitionMatrix([1, 2, 3]);
    expect(Number.isNaN(res.pValue)).toBe(true);
    expect(res.interpretation).toMatch(/Insufficient/);
  });
});

describe('rolling frequency', () => {
  it('produces one point per fully-populated window', () => {
    const digits = uniform(500);
    const roll = rollingDigitFrequency(digits, 5, 100);
    expect(roll).toHaveLength(401);
    expect(roll[0].windowStart).toBe(0);
    expect(roll.at(-1)!.index).toBe(500);
  });

  it('reports the percentage of the target digit inside each window', () => {
    const digits = new Array(100).fill(3);
    const roll = rollingDigitFrequency(digits, 3, 50);
    expect(roll.every((p) => p.pct === 100)).toBe(true);
    const none = rollingDigitFrequency(digits, 7, 50);
    expect(none.every((p) => p.pct === 0)).toBe(true);
  });
});
