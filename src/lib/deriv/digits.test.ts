import { describe, expect, it } from 'vitest';
import { digitSeries, isOver, isUnder, lastDigit, lastDigitByScaling, theoreticalDigitProbability } from './digits';

describe('pip-size-aware last-digit extraction', () => {
  it('uses the hundredths place for pip_size 2 (R_100 / 1HZ100V)', () => {
    expect(lastDigit(571.94, 2)).toBe(4);
    expect(lastDigit(1172.05, 2)).toBe(5);
    expect(lastDigit(571.9, 2)).toBe(0); // 571.90 -> trailing zero is significant
    expect(lastDigit(100, 2)).toBe(0);
  });

  it('uses the correct place for other precisions', () => {
    expect(lastDigit(6000.123, 3)).toBe(3);
    expect(lastDigit(250.1234, 4)).toBe(4);
    expect(lastDigit(90000.1234, 4)).toBe(4);
    expect(lastDigit(7, 0)).toBe(7);
  });

  it('does NOT return the last character of naive float formatting', () => {
    // 571.94 * 100 === 57194.00000000001 in IEEE754. A naive approach that stringifies the
    // raw float would produce garbage; toFixed(2) is stable.
    expect((571.94 * 100).toString()).not.toBe('57194');
    expect(lastDigit(571.94, 2)).toBe(4);
  });

  it('agrees with independent scaled-rounding across a wide sweep', () => {
    let mismatches = 0;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 20000; i++) {
      const pip = [0, 1, 2, 3, 4][i % 5];
      const price = Math.round(rnd() * 1e6) / Math.pow(10, pip);
      if (lastDigit(price, pip) !== lastDigitByScaling(price, pip)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it('rejects invalid input rather than guessing', () => {
    expect(() => lastDigit(NaN, 2)).toThrow(RangeError);
    expect(() => lastDigit(Infinity, 2)).toThrow(RangeError);
    expect(() => lastDigit(1, -1)).toThrow(RangeError);
    expect(() => lastDigit(1, 11)).toThrow(RangeError);
    expect(() => lastDigit(1, 2.5)).toThrow(RangeError);
  });

  it('extracts a series', () => {
    expect(digitSeries([571.91, 571.92, 571.93], 2)).toEqual([1, 2, 3]);
  });

  it('theoretical probabilities are correct for each digit contract', () => {
    expect(theoreticalDigitProbability('DIGITODD')).toBe(0.5);
    expect(theoreticalDigitProbability('DIGITEVEN')).toBe(0.5);
    expect(theoreticalDigitProbability('DIGITMATCH', 7)).toBe(0.1);
    expect(theoreticalDigitProbability('DIGITDIFF', 7)).toBe(0.9);
    expect(theoreticalDigitProbability('DIGITOVER', 5)).toBe(0.4); // 6,7,8,9
    expect(theoreticalDigitProbability('DIGITUNDER', 5)).toBe(0.5); // 0..4
    expect(theoreticalDigitProbability('DIGITOVER', 9)).toBe(0); // impossible
    expect(theoreticalDigitProbability('DIGITUNDER', 0)).toBe(0); // impossible
  });

  it('over/under predicates use strict inequalities', () => {
    expect(isOver(6, 5)).toBe(true);
    expect(isOver(5, 5)).toBe(false); // barrier itself loses
    expect(isUnder(4, 5)).toBe(true);
    expect(isUnder(5, 5)).toBe(false);
  });
});
