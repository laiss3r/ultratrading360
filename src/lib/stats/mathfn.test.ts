import { describe, expect, it } from 'vitest';
import {
  betaI, binomialCdf, chiSquarePValue, erf, logGamma, normalCdf, normalQuantile, normalTwoSidedP, tTestPValue,
} from './mathfn';

describe('special functions against published reference values', () => {
  it('erf matches A&S table values', () => {
    expect(erf(0)).toBeCloseTo(0, 12);
    expect(erf(1)).toBeCloseTo(0.8427007929, 8);
    expect(erf(2)).toBeCloseTo(0.9953222650, 8);
    expect(erf(-1)).toBeCloseTo(-0.8427007929, 8);
  });

  it('logGamma matches known values', () => {
    expect(logGamma(1)).toBeCloseTo(0, 10);
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 8);
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 8);
  });

  it('normalCdf matches the 1.96 => 0.975 identity', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 12);
    expect(normalCdf(1.959963985)).toBeCloseTo(0.975, 7);
    expect(normalCdf(-1.959963985)).toBeCloseTo(0.025, 7);
  });

  it('normalTwoSidedP gives 0.05 at z=1.96', () => {
    expect(normalTwoSidedP(1.959963985)).toBeCloseTo(0.05, 6);
  });

  it('chi-square p-value matches standard tables', () => {
    // df=9: 3.325 -> 0.95, 16.919 -> 0.05, 21.666 -> 0.01
    expect(chiSquarePValue(3.325, 9)).toBeCloseTo(0.95, 3);
    expect(chiSquarePValue(16.919, 9)).toBeCloseTo(0.05, 3);
    expect(chiSquarePValue(21.666, 9)).toBeCloseTo(0.01, 3);
    // df=1: 3.841 -> 0.05
    expect(chiSquarePValue(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquarePValue(0, 5)).toBe(1);
  });

  it('chi-square rejects bad inputs', () => {
    expect(() => chiSquarePValue(1, 0)).toThrow(RangeError);
  });

  it('regularised incomplete beta is symmetric at 0.5', () => {
    expect(betaI(0.5, 5, 5)).toBeCloseTo(0.5, 10);
    expect(betaI(0, 2, 3)).toBe(0);
    expect(betaI(1, 2, 3)).toBe(1);
    expect(betaI(0.3, 2, 3) + betaI(0.7, 3, 2)).toBeCloseTo(1, 8);
  });

  it('binomial CDF matches exact enumeration', () => {
    // P(X <= 5) for n=10, p=0.5 = 0.623046875
    expect(binomialCdf(5, 10, 0.5)).toBeCloseTo(0.623046875, 9);
    // brute-force check for n=12,p=0.3,k=4
    let exact = 0;
    const binom = (n: number, k: number) => { let r = 1; for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1); return r; };
    for (let k = 0; k <= 4; k++) exact += binom(12, k) * Math.pow(0.3, k) * Math.pow(0.7, 12 - k);
    expect(binomialCdf(4, 12, 0.3)).toBeCloseTo(exact, 8);
    expect(binomialCdf(-1, 10, 0.5)).toBe(0);
    expect(binomialCdf(10, 10, 0.5)).toBe(1);
  });

  it('t distribution matches tables', () => {
    expect(tTestPValue(2.228, 10)).toBeCloseTo(0.05, 3);
    expect(tTestPValue(1.96, 100000)).toBeCloseTo(0.05, 2); // -> normal
    expect(() => tTestPValue(1, 0)).toThrow(RangeError);
  });

  it('normalQuantile inverts normalCdf', () => {
    for (const p of [0.001, 0.025, 0.1, 0.5, 0.9, 0.975, 0.999]) {
      expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 6);
    }
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1)).toBe(Infinity);
  });
});
