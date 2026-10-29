import { describe, expect, it } from 'vitest';
import { expectedValue, kellyFraction, observedEv, riskOfRuin, theoreticalEv } from './ev';

describe('payout-aware expected value', () => {
  it('is exactly fair when the payout matches the true odds', () => {
    // 50% win at 2.0x payout -> EV 0
    const ev = expectedValue(0.5, 1, 2);
    expect(ev.evPerTrade).toBeCloseTo(0, 10);
    expect(ev.breakEvenProbability).toBeCloseTo(0.5, 10);
    expect(ev.edge).toBeCloseTo(0, 10);
  });

  it('captures the house edge on a realistic digit-odd quote', () => {
    // Deriv typically quotes ~1.96x on DIGITODD, not 2.00x.
    const ev = theoreticalEv('DIGITODD', 1, 1.96);
    expect(ev.winProbability).toBe(0.5);
    expect(ev.evPerTrade).toBeCloseTo(-0.02, 10);
    expect(ev.evPctOfStake).toBeCloseTo(-0.02, 10);
    expect(ev.houseEdgePct).toBeCloseTo(2, 10);
    expect(ev.verdict).toMatch(/NEGATIVE expected value/i);
  });

  it('shows that a 90% win rate can still lose money', () => {
    // DIGITDIFF wins 90% but pays only ~1.09x
    const ev = theoreticalEv('DIGITDIFF', 1, 1.09);
    expect(ev.winProbability).toBe(0.9);
    expect(ev.evPerTrade).toBeCloseTo(0.9 * 0.09 - 0.1 * 1, 6);
    expect(ev.evPerTrade).toBeLessThan(0);
    expect(ev.verdict).toMatch(/NEGATIVE/);
  });

  it('shows that a 10% win rate can be fair', () => {
    // DIGITMATCH at a fair 10x payout
    const ev = theoreticalEv('DIGITMATCH', 1, 10, 7);
    expect(ev.winProbability).toBe(0.1);
    expect(ev.evPerTrade).toBeCloseTo(0, 10);
  });

  it('computes the break-even probability from the quoted payout', () => {
    // stake 1, payout 2.4 -> break even at 1/2.4 = 41.67%
    const ev = expectedValue(0.5, 1, 2.4);
    expect(ev.breakEvenProbability).toBeCloseTo(1 / 2.4, 4);
    expect(ev.edge).toBeCloseTo(0.5 - 1 / 2.4, 4);
    expect(ev.evPerTrade).toBeGreaterThan(0);
    expect(ev.verdict).toMatch(/POSITIVE/);
  });

  it('over/under EV uses the barrier-specific fair probability', () => {
    // DIGITOVER 5 wins on 6,7,8,9 = 40%
    expect(theoreticalEv('DIGITOVER', 1, 2.4, 5).winProbability).toBeCloseTo(0.4, 10);
    // DIGITUNDER 5 wins on 0..4 = 50%
    expect(theoreticalEv('DIGITUNDER', 1, 1.96, 5).winProbability).toBeCloseTo(0.5, 10);
    // barrier 8 -> only digit 9 wins = 10%
    expect(theoreticalEv('DIGITOVER', 1, 9.2, 8).winProbability).toBeCloseTo(0.1, 10);
  });

  it('rejects invalid inputs', () => {
    expect(() => expectedValue(0.5, 0, 2)).toThrow(RangeError);
    expect(() => expectedValue(0.5, -1, 2)).toThrow(RangeError);
    expect(() => expectedValue(0.5, 1, -1)).toThrow(RangeError);
  });

  it('clamps probabilities into [0,1]', () => {
    expect(expectedValue(1.5, 1, 2).winProbability).toBe(1);
    expect(expectedValue(-0.2, 1, 2).winProbability).toBe(0);
  });

  it('observedEv uses the sample win rate', () => {
    const ev = observedEv(30, 100, 1, 1.9);
    expect(ev.winProbability).toBe(0.3);
    expect(ev.evPerTrade).toBeCloseTo(0.3 * 0.9 - 0.7 * 1, 6);
  });
});

describe('Kelly criterion (reported, never auto-applied)', () => {
  it('is zero for a negative-edge bet', () => {
    expect(kellyFraction(0.5, 1, 1.96)).toBe(0); // b=.96, f=(.96*.5-.5)/.96 < 0 -> clamped 0
  });
  it('matches the closed form f = (bp - q)/b', () => {
    const b = 2 - 1;
    const p = 0.55;
    expect(kellyFraction(p, 1, 2)).toBeCloseTo((b * p - (1 - p)) / b, 10);
  });
  it('is zero when the payout does not exceed the stake', () => {
    expect(kellyFraction(0.9, 1, 1)).toBe(0);
    expect(kellyFraction(0.9, 1, 0.5)).toBe(0);
  });
});

describe('risk of ruin', () => {
  it('is 1 for a negative-edge game', () => {
    expect(riskOfRuin(0.5, 1, 1.96, 100)).toBe(1);
  });
  it('falls as the bankroll grows, for a positive-edge game', () => {
    const small = riskOfRuin(0.55, 1, 2, 20);
    const large = riskOfRuin(0.55, 1, 2, 2000);
    expect(large).toBeLessThan(small);
  });
  it('is 1 when the bankroll cannot cover one stake', () => {
    expect(riskOfRuin(0.6, 10, 20, 5)).toBe(1);
  });
});
