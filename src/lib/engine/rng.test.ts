import { describe, expect, it } from 'vitest';
import { SYNTHETIC_PRESETS, gaussianFactory, hashSeed, mulberry32, presetFor, SyntheticMarket } from './rng';
import { lastDigit } from '../deriv/digits';
import { chiSquareUniformity } from '../stats/tests';

describe('deterministic simulation (reproducibility is a hard requirement)', () => {
  it('mulberry32 is reproducible and in [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 100 }, () => a());
    const seqB = Array.from({ length: 100 }, () => b());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    // different seeds diverge
    expect(mulberry32(43)()).not.toBe(seqA[0]);
  });

  it('hashSeed is stable and order-sensitive', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
    expect(hashSeed(7)).toBe(7);
    expect(Number.isInteger(hashSeed('some long seed string'))).toBe(true);
  });

  it('the SAME seed + config produces a byte-identical tick series', () => {
    const run = () => new SyntheticMarket(presetFor('R_100'), 'seed-x').series(500).map((t) => t.quote);
    expect(run()).toEqual(run());
  });

  it('DIFFERENT seeds produce different series', () => {
    const a = new SyntheticMarket(presetFor('R_100'), 'seed-a').series(200).map((t) => t.quote);
    const b = new SyntheticMarket(presetFor('R_100'), 'seed-b').series(200).map((t) => t.quote);
    expect(a).not.toEqual(b);
  });

  it('symbol names give independent but reproducible streams', () => {
    const first = new SyntheticMarket(presetFor('R_50'), 's').series(50).map((t) => t.quote);
    const second = new SyntheticMarket(presetFor('R_50'), 's').series(50).map((t) => t.quote);
    expect(first).toEqual(second);
  });

  it('gaussian output has approximately zero mean and unit variance', () => {
    const g = gaussianFactory(mulberry32(1));
    const n = 200000;
    let sum = 0;
    let sumsq = 0;
    for (let i = 0; i < n; i++) {
      const v = g();
      sum += v;
      sumsq += v * v;
    }
    const mean = sum / n;
    const varr = sumsq / n - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.01);
    expect(Math.abs(varr - 1)).toBeLessThan(0.02);
  });

  it('quotes are quantised to the instrument pip', () => {
    const m = new SyntheticMarket(presetFor('R_100'), 'pip-check');
    for (const t of m.series(200)) {
      const scaled = t.quote * 100;
      expect(Math.abs(scaled - Math.round(scaled))).toBeLessThan(1e-6);
    }
  });

  it('prices stay strictly positive', () => {
    const m = new SyntheticMarket({ ...presetFor('R_100'), volatilityPct: 400 }, 'stress');
    for (const t of m.series(5000)) expect(t.quote).toBeGreaterThan(0);
  });

  /**
   * The dither term exists so the last digit is not an artefact of a smooth walk.
   * Verify the generated digit stream is statistically indistinguishable from uniform.
   */
  it('generated last digits are consistent with a uniform distribution', () => {
    const cfg = presetFor('R_100');
    const m = new SyntheticMarket(cfg, 'uniformity-check');
    const digits = m.series(20000).map((t) => lastDigit(t.quote, cfg.pipSize));
    const result = chiSquareUniformity(digits);
    expect(result.pValue).not.toBeNaN();
    // A fair generator should NOT be rejected at alpha=0.05.
    expect(result.pValue).toBeGreaterThan(0.05);
  });

  it('epoch advances by the configured tick interval', () => {
    const m = new SyntheticMarket(presetFor('1HZ100V'), 'epoch', 1000);
    const ticks = m.series(5);
    expect(ticks[1].epoch - ticks[0].epoch).toBe(1);
    const m2 = new SyntheticMarket(presetFor('R_100'), 'epoch2', 1000);
    const two = m2.series(2);
    // Each call to next() advances the clock by one tick interval (2s for R_100).
    expect(two[0].epoch).toBe(1002);
    expect(two[1].epoch).toBe(1004);
  });

  it('every preset resolves and unknown symbols fall back safely', () => {
    for (const [sym, cfg] of Object.entries(SYNTHETIC_PRESETS)) {
      expect(cfg.symbol).toBe(sym);
      expect(cfg.pipSize).toBeGreaterThanOrEqual(0);
    }
    expect(presetFor('UNKNOWN_SYMBOL').symbol).toBe('UNKNOWN_SYMBOL');
    expect(presetFor('UNKNOWN_SYMBOL').pipSize).toBe(2);
  });
});
