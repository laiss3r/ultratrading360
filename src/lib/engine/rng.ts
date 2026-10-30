/**
 * Deterministic pseudo-random utilities.
 *
 * mulberry32 and hashSeed are engine-identical across JS runtimes, which is what makes a
 * seeded test or a replayed backtest byte-for-byte repeatable. They are general utilities:
 * the platform has no simulation mode and generates no market data of its own — prices and
 * digits always come from Deriv.
 */

/** mulberry32 — small, fast, and identical across JS engines, so runs are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 32-bit hash of a string seed, so users can seed by name. */
export function hashSeed(input: string | number): number {
  if (typeof input === 'number') return input >>> 0;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Box-Muller standard normal from a uniform source. */
