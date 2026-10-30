import { chiSquarePValue, normalTwoSidedP } from './mathfn';
import { wilsonInterval } from './ci';

export interface TestResult {
  name: string;
  statistic: number;
  pValue: number;
  df?: number;
  /** Plain-language reading. Deliberately avoids the word "predictive". */
  interpretation: string;
  significant: boolean;
  sampleSize: number;
}

/* ---------------------------------------------------------------- *
 * 1. Digit frequency + chi-square goodness of fit against uniform
 * ---------------------------------------------------------------- */

export interface DigitFrequency {
  digit: number;
  count: number;
  observedPct: number;
  expectedPct: number;
  deviation: number;
  ciLower: number;
  ciUpper: number;
  /** True when the Wilson CI excludes 10%. An anomaly, NOT proof of predictability. */
  anomalous: boolean;
}

export function digitFrequency(digits: number[], level = 0.95): DigitFrequency[] {
  const counts = new Array(10).fill(0);
  for (const d of digits) if (d >= 0 && d <= 9) counts[d]++;
  const valid = counts.reduce((a, b) => a + b, 0);
  return counts.map((count, digit) => {
    const ci = wilsonInterval(count, valid, level);
    return {
      digit,
      count,
      observedPct: valid ? (count / valid) * 100 : 0,
      expectedPct: 10,
      deviation: valid ? (count / valid) * 100 - 10 : 0,
      ciLower: ci.lower * 100,
      ciUpper: ci.upper * 100,
      anomalous: valid > 0 && (ci.upper < 0.1 || ci.lower > 0.1),
    };
  });
}

/**
 * Chi-square goodness of fit of the digit distribution against the uniform null.
 * H0: each digit occurs with probability 1/10. df = 9.
 */
export function chiSquareUniformity(digits: number[]): TestResult {
  const counts = new Array(10).fill(0);
  for (const d of digits) if (d >= 0 && d <= 9) counts[d]++;
  const valid = counts.reduce((a, b) => a + b, 0);
  if (valid < 50) {
    return {
      name: 'Chi-square goodness of fit vs uniform',
      statistic: NaN,
      pValue: NaN,
      df: 9,
      interpretation: `Insufficient sample (${valid} digits, need >= 50). No conclusion.`,
      significant: false,
      sampleSize: valid,
    };
  }
  const expected = valid / 10;
  let chi2 = 0;
  for (const c of counts) chi2 += (c - expected) ** 2 / expected;
  const p = chiSquarePValue(chi2, 9);
  return {
    name: 'Chi-square goodness of fit vs uniform',
    statistic: round4(chi2),
    pValue: p,
    df: 9,
    significant: p < 0.05,
    sampleSize: valid,
    interpretation:
      p < 0.05
        ? `The digit distribution deviates from uniform (chi2=${chi2.toFixed(2)}, df=9, p=${p.toExponential(2)}). This is an OBSERVED ANOMALY over ${valid} ticks. It does not establish that the deviation will persist — synthetic index RNG is re-drawn every tick, and a sample anomaly is not a forecastable edge.`
        : `No evidence of deviation from uniform (chi2=${chi2.toFixed(2)}, df=9, p=${p.toFixed(3)}). Digits are consistent with a fair 1-in-10 draw over ${valid} ticks.`,
  };
}

/* ---------------------------------------------- *
 * 2. Runs test (Wald-Wolfowitz) on digit parity
 * ---------------------------------------------- */

/**
 * Counts runs in a binary sequence and tests against the randomness null.
 * Too few runs => clustering/trending. Too many => excessive alternation.
 */
export function runsTest(binary: boolean[]): TestResult {
  const n = binary.length;
  if (n < 20) {
    return {
      name: 'Runs test (Wald-Wolfowitz)',
      statistic: NaN,
      pValue: NaN,
      interpretation: `Insufficient sample (${n}, need >= 20). No conclusion.`,
      significant: false,
      sampleSize: n,
    };
  }
  const n1 = binary.filter((b) => b).length;
  const n2 = n - n1;
  if (n1 === 0 || n2 === 0) {
    return {
      name: 'Runs test (Wald-Wolfowitz)',
      statistic: 1,
      pValue: 0,
      interpretation: 'Degenerate sequence: all values identical. The test is not applicable.',
      significant: false,
      sampleSize: n,
    };
  }
  let runs = 1;
  for (let i = 1; i < n; i++) if (binary[i] !== binary[i - 1]) runs++;
  const mean = (2 * n1 * n2) / n + 1;
  const variance = (2 * n1 * n2 * (2 * n1 * n2 - n)) / (n * n * (n - 1));
  if (variance <= 0) {
    return {
      name: 'Runs test (Wald-Wolfowitz)',
      statistic: runs,
      pValue: 1,
      interpretation: 'Variance is zero; the test is undefined for this sequence.',
      significant: false,
      sampleSize: n,
    };
  }
  const z = (runs - mean) / Math.sqrt(variance);
  const p = normalTwoSidedP(z);
  return {
    name: 'Runs test (Wald-Wolfowitz)',
    statistic: round4(z),
    pValue: p,
    interpretation:
      p < 0.05
        ? `${runs} runs observed vs ${mean.toFixed(1)} expected (z=${z.toFixed(2)}, p=${p.toFixed(4)}). The sequence is ${runs < mean ? 'more clustered' : 'more alternating'} than independent draws would produce — evidence of DEPENDENCE between consecutive outcomes.`
        : `${runs} runs vs ${mean.toFixed(1)} expected (z=${z.toFixed(2)}, p=${p.toFixed(3)}). Consistent with independent outcomes; no evidence of serial dependence.`,
    significant: p < 0.05,
    sampleSize: n,
  };
}

/* ------------------------------------------------- *
 * 3. Lag-k autocorrelation of the digit series
 * ------------------------------------------------- */

export interface Autocorrelation {
  lag: number;
  acf: number;
  /** Approximate 95% band: +-1.96/sqrt(n). */
  bound: number;
  significant: boolean;
}

export function autocorrelation(series: number[], maxLag = 5): Autocorrelation[] {
  const n = series.length;
  if (n < 30) return [];
  const mean = series.reduce((a, b) => a + b, 0) / n;
  const denom = series.reduce((a, b) => a + (b - mean) ** 2, 0);
  const bound = 1.96 / Math.sqrt(n);
  const out: Autocorrelation[] = [];
  for (let lag = 1; lag <= maxLag; lag++) {
    if (denom === 0) {
      out.push({ lag, acf: 0, bound, significant: false });
      continue;
    }
    let num = 0;
    for (let i = 0; i < n - lag; i++) num += (series[i] - mean) * (series[i + lag] - mean);
    const acf = num / denom;
    out.push({ lag, acf: round4(acf), bound: round4(bound), significant: Math.abs(acf) > bound });
  }
  return out;
}

/** Ljung-Box portmanteau test for overall serial dependence up to `maxLag`. */
export function ljungBox(series: number[], maxLag = 10): TestResult {
  const n = series.length;
  if (n < 50) {
    return {
      name: 'Ljung-Box portmanteau',
      statistic: NaN,
      pValue: NaN,
      df: maxLag,
      interpretation: `Insufficient sample (${n}, need >= 50). No conclusion.`,
      significant: false,
      sampleSize: n,
    };
  }
  const mean = series.reduce((a, b) => a + b, 0) / n;
  const denom = series.reduce((a, b) => a + (b - mean) ** 2, 0);
  if (denom === 0) {
    return {
      name: 'Ljung-Box portmanteau',
      statistic: 0,
      pValue: 1,
      df: maxLag,
      interpretation: 'Constant series; the test is undefined.',
      significant: false,
      sampleSize: n,
    };
  }
  let q = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let num = 0;
    for (let i = 0; i < n - lag; i++) num += (series[i] - mean) * (series[i + lag] - mean);
    const r = num / denom;
    q += (r * r) / (n - lag);
  }
  q *= n * (n + 2);
  const p = chiSquarePValue(q, maxLag);
  return {
    name: 'Ljung-Box portmanteau',
    statistic: round4(q),
    pValue: p,
    df: maxLag,
    significant: p < 0.05,
    sampleSize: n,
    interpretation:
      p < 0.05
        ? `Serial dependence detected up to lag ${maxLag} (Q=${q.toFixed(2)}, p=${p.toExponential(2)}). Consecutive digits are NOT independent in this sample.`
        : `No serial dependence up to lag ${maxLag} (Q=${q.toFixed(2)}, p=${p.toFixed(3)}). Digits behave as independent draws in this sample.`,
  };
}

/* ------------------------------------------------- *
 * 4. Transition matrix: does digit t predict t+1?
 * ------------------------------------------------- */

export interface TransitionResult {
  matrix: number[][];
  chiSquare: number;
  df: number;
  pValue: number;
  significant: boolean;
  cramersV: number;
  sampleSize: number;
  interpretation: string;
}

export function transitionMatrix(digits: number[]): TransitionResult {
  const n = digits.length;
  const m: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0));
  let pairs = 0;
  for (let i = 0; i < n - 1; i++) {
    const a = digits[i];
    const b = digits[i + 1];
    if (a >= 0 && a <= 9 && b >= 0 && b <= 9) {
      m[a][b]++;
      pairs++;
    }
  }
  if (pairs < 100) {
    return {
      matrix: m,
      chiSquare: NaN,
      df: 81,
      pValue: NaN,
      significant: false,
      cramersV: NaN,
      sampleSize: pairs,
      interpretation: `Insufficient pairs (${pairs}, need >= 100). No conclusion.`,
    };
  }
  const rowTotals = m.map((r) => r.reduce((a, b) => a + b, 0));
  const colTotals = m[0].map((_, c) => m.reduce((a, r) => a + r[c], 0));
  let chi2 = 0;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const e = (rowTotals[r] * colTotals[c]) / pairs;
      if (e > 0) chi2 += (m[r][c] - e) ** 2 / e;
    }
  }
  const df = 81;
  const p = chiSquarePValue(chi2, df);
  const cramersV = Math.sqrt(chi2 / (pairs * 9));
  return {
    matrix: m,
    chiSquare: round4(chi2),
    df,
    pValue: p,
    significant: p < 0.05,
    cramersV: round4(cramersV),
    sampleSize: pairs,
    interpretation:
      p < 0.05
        ? `Current digit and next digit are not independent (chi2=${chi2.toFixed(1)}, df=81, p=${p.toExponential(2)}, Cramer's V=${cramersV.toFixed(4)}). Note V is tiny unless it exceeds ~0.1 — statistical significance at large n does not imply a tradeable effect size.`
        : `No evidence that the current digit predicts the next (chi2=${chi2.toFixed(1)}, df=81, p=${p.toFixed(3)}).`,
  };
}

/* ------------------------------------------------- *
 * 5. Rolling frequency (drift detection)
 * ------------------------------------------------- */

export interface RollingPoint {
  index: number;
  windowStart: number;
  pct: number;
}

export function rollingDigitFrequency(digits: number[], digit: number, window = 100): RollingPoint[] {
  const out: RollingPoint[] = [];
  for (let i = window; i <= digits.length; i++) {
    const slice = digits.slice(i - window, i);
    const pct = (slice.filter((d) => d === digit).length / window) * 100;
    out.push({ index: i, windowStart: i - window, pct: round4(pct) });
  }
  return out;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
