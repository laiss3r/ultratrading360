import { describe, expect, it } from 'vitest';
import { benjaminiHochberg, bonferroni, correct, correctLabeled, expectedFalsePositives, holm } from './multiple';

describe('Bonferroni', () => {
  it('multiplies by the test count and caps at 1', () => {
    expect(bonferroni([0.01, 0.02, 0.5])).toEqual([0.03, 0.06, 1]);
    expect(bonferroni([0.4, 0.4])).toEqual([0.8, 0.8]);
    expect(bonferroni([])).toEqual([]);
  });
});

describe('Holm-Bonferroni', () => {
  it('reproduces the textbook worked example', () => {
    // m=4. Sorted: .01,.02,.03,.04 -> adj: .04,.06,.06,.04? No: (m-k)*p with monotonicity.
    // k=0: 4*.01=.04 ; k=1: 3*.02=.06 ; k=2: 2*.03=.06 ; k=3: 1*.04=.04 -> max running = .06
    const p = [0.03, 0.01, 0.04, 0.02];
    const adj = holm(p);
    expect(adj[1]).toBeCloseTo(0.04, 12); // p=.01 smallest
    expect(adj[3]).toBeCloseTo(0.06, 12); // p=.02
    expect(adj[0]).toBeCloseTo(0.06, 12); // p=.03 -> 2*.03=.06
    expect(adj[2]).toBeCloseTo(0.06, 12); // p=.04 -> 1*.04=.04, but monotone => .06
  });

  it('is never more conservative than Bonferroni', () => {
    const p = [0.001, 0.01, 0.03, 0.2, 0.7];
    const h = holm(p);
    const b = bonferroni(p);
    h.forEach((v, i) => expect(v).toBeLessThanOrEqual(b[i] + 1e-12));
  });

  it('produces a monotone non-decreasing sequence in sorted order', () => {
    const p = [0.9, 0.001, 0.05, 0.2, 0.0001];
    const adj = holm(p);
    const sorted = adj.map((_, i) => i).sort((a, b) => p[a] - p[b]).map((i) => adj[i]);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]).toBeGreaterThanOrEqual(sorted[i - 1] - 1e-12);
  });

  it('caps at 1', () => {
    expect(holm([0.8, 0.9]).every((v) => v <= 1)).toBe(true);
  });
});

describe('Benjamini-Hochberg', () => {
  it('matches an independently derived reference on unsorted input', () => {
    // m=5. Ascending order is .001, .008, .023, .039, .041 -- note that p[4]=.023 is the
    // THIRD smallest, so this input deliberately defeats any implementation that assumes the
    // array arrives pre-sorted.
    // BH adj = min over ranks >= r of (p*m/rank), enforced monotonically from the largest p down:
    //   rank5 .041 -> .041 ; rank4 .039 -> min(.041, .04875) = .041
    //   rank3 .023 -> min(.041, .038333) = .038333 ; rank2 .008 -> .02 ; rank1 .001 -> .005
    const p = [0.001, 0.008, 0.039, 0.041, 0.023];
    const adj = benjaminiHochberg(p);
    expect(adj[0]).toBeCloseTo(0.005, 10);
    expect(adj[1]).toBeCloseTo(0.02, 10);
    expect(adj[2]).toBeCloseTo(0.041, 10);
    expect(adj[3]).toBeCloseTo(0.041, 10);
    expect(adj[4]).toBeCloseTo(0.0383333333, 8);
  });

  it('matches the reference on already-ascending input', () => {
    const q = [0.001, 0.008, 0.023, 0.039, 0.041];
    const adj = benjaminiHochberg(q);
    const expected = [0.005, 0.02, 0.0383333333, 0.041, 0.041];
    expected.forEach((v, i) => expect(adj[i]).toBeCloseTo(v, 8));
  });

  it('BH adjusted p-values are monotone in the raw p-values', () => {
    const p = [0.9, 0.001, 0.05, 0.2, 0.0001, 0.31];
    const adj = benjaminiHochberg(p);
    const order = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
    for (let i = 1; i < order.length; i++) {
      expect(adj[order[i]]).toBeGreaterThanOrEqual(adj[order[i - 1]] - 1e-12);
    }
  });

  it('is never more conservative than Holm (controls FDR, not FWER)', () => {
    const p = [0.001, 0.01, 0.03, 0.2, 0.7];
    const bh = benjaminiHochberg(p);
    const h = holm(p);
    bh.forEach((v, i) => expect(v).toBeLessThanOrEqual(h[i] + 1e-9));
  });

  it('handles an empty input', () => {
    expect(benjaminiHochberg([])).toEqual([]);
  });
});

describe('correct() dispatch and labelling', () => {
  it('dispatches to every method', () => {
    const p = [0.01, 0.04];
    expect(correct(p, 'none')).toEqual(p);
    expect(correct(p, 'bonferroni')).toEqual(bonferroni(p));
    expect(correct(p, 'holm')).toEqual(holm(p));
    expect(correct(p, 'benjamini_hochberg')).toEqual(benjaminiHochberg(p));
  });

  it('labels significance against the corrected p-value, not the raw one', () => {
    const items = [
      { label: 'digit 3', pValue: 0.03 },
      { label: 'digit 7', pValue: 0.04 },
      { label: 'digit 9', pValue: 0.6 },
    ];
    const raw = correctLabeled(items, 'none');
    const bonf = correctLabeled(items, 'bonferroni');
    expect(raw[0].significant).toBe(true);
    expect(bonf[0].significant).toBe(false); // .03*3 = .09 > .05
    expect(bonf[2].adjustedP).toBe(1);
  });

  it('reports the false positives expected by chance alone', () => {
    expect(expectedFalsePositives(100)).toBeCloseTo(5, 10);
    expect(expectedFalsePositives(10, 0.01)).toBeCloseTo(0.1, 10);
  });
});
