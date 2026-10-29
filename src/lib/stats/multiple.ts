/**
 * Multiple-testing corrections.
 *
 * A digit analysis typically tests 10 digits x several statistics x several windows. At
 * alpha = 0.05 that is dozens of chances to find a "significant" result purely by luck.
 * Reporting uncorrected p-values here is how fake edges get invented.
 */

export type CorrectionMethod = 'none' | 'bonferroni' | 'holm' | 'benjamini_hochberg';

export interface CorrectedResult {
  index: number;
  label: string;
  pValue: number;
  adjustedP: number;
  significant: boolean;
}

/** Bonferroni: p * m, capped at 1. Controls FWER, very conservative. */
export function bonferroni(pValues: number[]): number[] {
  const m = pValues.length;
  return pValues.map((p) => Math.min(1, p * m));
}

/** Holm-Bonferroni step-down. Uniformly more powerful than Bonferroni at the same FWER. */
export function holm(pValues: number[]): number[] {
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const out = new Array<number>(m).fill(1);
  let running = 0;
  for (let k = 0; k < m; k++) {
    const adj = Math.min(1, (m - k) * order[k].p);
    running = Math.max(running, adj); // enforce monotonicity
    out[order[k].i] = running;
  }
  return out;
}

/**
 * Benjamini-Hochberg step-up. Controls the FALSE DISCOVERY RATE rather than FWER —
 * the right choice when screening many digits and you can tolerate some false positives.
 */
export function benjaminiHochberg(pValues: number[]): number[] {
  const m = pValues.length;
  if (m === 0) return [];
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p); // descending
  const out = new Array<number>(m).fill(1);
  let running = 1;
  for (let k = 0; k < m; k++) {
    const rank = m - k; // 1..m in ascending order
    const adj = Math.min(1, (order[k].p * m) / rank);
    running = Math.min(running, adj); // enforce monotonicity from the largest p down
    out[order[k].i] = running;
  }
  return out;
}

export function correct(pValues: number[], method: CorrectionMethod): number[] {
  switch (method) {
    case 'none': return pValues.map((p) => Math.min(1, p));
    case 'bonferroni': return bonferroni(pValues);
    case 'holm': return holm(pValues);
    case 'benjamini_hochberg': return benjaminiHochberg(pValues);
  }
}

export function correctLabeled(
  items: Array<{ label: string; pValue: number }>,
  method: CorrectionMethod,
  alpha = 0.05,
): CorrectedResult[] {
  const adj = correct(items.map((i) => i.pValue), method);
  return items.map((it, i) => ({
    index: i,
    label: it.label,
    pValue: it.pValue,
    adjustedP: adj[i],
    significant: adj[i] < alpha,
  }));
}

/**
 * How many false positives to expect by chance alone at this alpha and test count.
 * Displayed next to every "significant" finding so the user can calibrate.
 */
export function expectedFalsePositives(testCount: number, alpha = 0.05): number {
  return testCount * alpha;
}
