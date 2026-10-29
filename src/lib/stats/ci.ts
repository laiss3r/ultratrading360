import { betaI, normalQuantile, normalTwoSidedP, tTestPValue } from './mathfn';

export interface Interval {
  lower: number;
  upper: number;
  point: number;
  level: number;
}

/**
 * Wilson score interval for a binomial proportion.
 * Preferred over the naive Wald interval: Wald misbehaves near 0/1 and at small n, which is
 * exactly the regime a digit-frequency estimate lives in.
 */
export function wilsonInterval(successes: number, n: number, level = 0.95): Interval {
  if (n <= 0) return { lower: 0, upper: 1, point: 0, level };
  const z = normalQuantile(1 - (1 - level) / 2);
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lower: Math.max(0, centre - half), upper: Math.min(1, centre + half), point: p, level };
}

/**
 * Quantile (inverse CDF) of the Beta(a,b) distribution, found by bisection on betaI.
 *
 * betaI is strictly increasing in x on (0,1), so bisection is safe and needs no derivative.
 * This is the function Clopper-Pearson actually requires: the interval bounds are beta
 * QUANTILES, not values of the incomplete beta function. Passing alpha/2 straight into betaI
 * (a first-implementation mistake caught by the test suite) returns numbers near 0 or 1 and
 * silently produces a useless interval.
 */
export function betaQuantile(p: number, a: number, b: number): number {
  if (!(p >= 0 && p <= 1)) throw new RangeError(`p must be in [0,1], got ${p}`);
  if (a <= 0 || b <= 0) throw new RangeError('Beta parameters must be positive');
  if (p === 0) return 0;
  if (p === 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (betaI(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Clopper-Pearson exact interval. Conservative; used as the reference implementation.
 *   lower = B(alpha/2;     k,     n-k+1)
 *   upper = B(1 - alpha/2; k+1,   n-k  )
 * where B(p; a, b) is the Beta quantile.
 */
export function clopperPearson(successes: number, n: number, level = 0.95): Interval {
  if (n <= 0) return { lower: 0, upper: 1, point: 0, level };
  if (successes < 0 || successes > n) throw new RangeError('successes must be in [0, n]');
  const alpha = 1 - level;
  const p = successes / n;
  const lower = successes === 0 ? 0 : betaQuantile(alpha / 2, successes, n - successes + 1);
  const upper = successes === n ? 1 : betaQuantile(1 - alpha / 2, successes + 1, n - successes);
  return { lower, upper, point: p, level };
}

/**
 * Does an observed proportion differ from a theoretical one?
 * Normal approximation with continuity correction — adequate at digit-analysis sample sizes.
 */
export function proportionTest(
  successes: number,
  n: number,
  p0: number,
  continuityCorrect = true,
): { z: number; pValue: number; observed: number; expected: number } {
  if (n <= 0 || p0 <= 0 || p0 >= 1) return { z: 0, pValue: 1, observed: 0, expected: p0 };
  const p = successes / n;
  const se = Math.sqrt((p0 * (1 - p0)) / n);
  const adj = continuityCorrect ? 0.5 / n : 0;
  const z = (Math.abs(p - p0) - adj) / se;
  return { z, pValue: normalTwoSidedP(z), observed: p, expected: p0 };
}

/**
 * Two-sided Student-t critical value for a CONFIDENCE LEVEL (0.95 -> 2.228 at df=10).
 * Takes the level rather than the two-sided p-value because every caller naturally holds a
 * level; accepting a p-value here produced silently wrong intervals.
 * Found by bisection on the monotone decreasing two-sided p-value.
 */
export function tCritical(level: number, df: number): number {
  if (!(level > 0 && level < 1)) throw new RangeError(`level must be in (0,1), got ${level}`);
  if (df <= 0) throw new RangeError(`df must be positive, got ${df}`);
  const target = 1 - level;
  let lo = 0;
  let hi = 1e4;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tTestPValue(mid, df) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface MeanInterval extends Interval {
  mean: number;
  sd: number;
  se: number;
  n: number;
}

/** CI for a mean using Student-t. */
export function meanInterval(values: number[], level = 0.95): MeanInterval {
  const n = values.length;
  if (n === 0) return { lower: NaN, upper: NaN, point: 0, level, mean: 0, sd: 0, se: 0, n: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { lower: NaN, upper: NaN, point: mean, level, mean, sd: 0, se: 0, n };
  const varr = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(varr);
  const se = sd / Math.sqrt(n);
  const t = tCritical(level, n - 1);
  return { lower: mean - t * se, upper: mean + t * se, point: mean, level, mean, sd, se, n };
}

/**
 * Does a confidence interval exclude the theoretical value? This is the honest way to say
 * "this looks anomalous" — as opposed to claiming predictive power.
 */
export function excludesTheoretical(iv: Interval, theoretical: number): boolean {
  return iv.upper < theoretical || iv.lower > theoretical;
}
