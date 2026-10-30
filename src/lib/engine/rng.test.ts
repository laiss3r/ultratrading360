import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32 } from './rng';

describe('deterministic pseudo-random utilities', () => {
  it('mulberry32 is reproducible from a seed', () => {
    const a = Array.from({ length: 50 }, mulberry32(1234));
    const b = Array.from({ length: 50 }, mulberry32(1234));
    expect(a).toEqual(b);
  });

  it('different seeds diverge', () => {
    const a = Array.from({ length: 20 }, mulberry32(1));
    const b = Array.from({ length: 20 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it('stays inside [0,1)', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 10000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is roughly uniform, not clustered', () => {
    const r = mulberry32(7);
    let below = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) if (r() < 0.5) below++;
    expect(Math.abs(below / n - 0.5)).toBeLessThan(0.02);
  });

  it('hashSeed is stable and distinguishes inputs', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
    // Numbers pass through untouched (they are already seeds); strings are hashed.
    expect(hashSeed(42)).toBe(42);
    expect(hashSeed('42')).not.toBe(42);
  });
});
