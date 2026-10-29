/**
 * Special functions needed for honest hypothesis testing.
 * Implemented from Numerical Recipes algorithms so results are reproducible with no
 * native/CDN dependency. All are unit-tested against known reference values.
 */

export function logGamma(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2,
    -0.5395239384953e-5,
  ];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/**
 * Error function via the exact identity erf(x) = P(1/2, x^2), where P is the regularised
 * lower incomplete gamma already implemented below.
 *
 * This is preferable to a polynomial approximation: it inherits gammaP's ~1e-15 accuracy
 * instead of the ~1.5e-7 ceiling of Abramowitz & Stegun 7.1.26, which would not survive the
 * 6-7 decimal places that p-values and confidence-interval bounds are asserted to.
 */
export function erf(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : -1;
  if (x === 0) return 0;
  const magnitude = gammaP(0.5, x * x);
  return x < 0 ? -magnitude : magnitude;
}

/** Standard normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Two-sided normal p-value. */
export function normalTwoSidedP(z: number): number {
  return 2 * (1 - normalCdf(Math.abs(z)));
}

/** Regularised lower incomplete gamma P(a,x) by series expansion. */
function gammaPSeries(a: number, x: number): number {
  const ITMAX = 500;
  const EPS = 3e-16;
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 0; n < ITMAX; n++) {
    ap++;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

/** Regularised upper incomplete gamma Q(a,x) by continued fraction. */
function gammaQCF(a: number, x: number): number {
  const ITMAX = 500;
  const EPS = 3e-16;
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= ITMAX; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Regularised lower incomplete gamma P(a,x). */
export function gammaP(a: number, x: number): number {
  if (x < 0 || a <= 0) throw new RangeError('gammaP requires x>=0 and a>0');
  if (x === 0) return 0;
  if (x < a + 1) return gammaPSeries(a, x);
  return 1 - gammaQCF(a, x);
}

/** Chi-square survival function: P(X > x) for df degrees of freedom. */
export function chiSquarePValue(x: number, df: number): number {
  if (df <= 0) throw new RangeError('df must be positive');
  if (x <= 0) return 1;
  return 1 - gammaP(df / 2, x / 2);
}

/** Continued fraction for the regularised incomplete beta. */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300;
  const EPS = 3e-16;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a,b). */
export function betaI(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided Student-t p-value. */
export function tTestPValue(t: number, df: number): number {
  if (df <= 0) throw new RangeError('df must be positive');
  return betaI(df / (df + t * t), df / 2, 0.5);
}

/**
 * Binomial CDF P(X <= k) via the incomplete beta identity.
 * Used for the exact runs test and Clopper-Pearson intervals.
 */
export function binomialCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  return betaI(1 - p, n - k, k + 1);
}

/** Quantile of the standard normal (Acklam's algorithm) — needed for CI bounds. */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}
