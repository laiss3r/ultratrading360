import { describe, expect, it } from 'vitest';
import {
  DERIV_STAKE_MAX,
  DERIV_STAKE_MIN,
  PROGRESSIONS,
  PROGRESSION_ORDER,
  progressionStake,
  worstCaseStake,
  type ProgressionConfig,
  type TradeOutcome,
} from './progressions';

const W = (profit: number): TradeOutcome => ({ won: true, profit });
const L = (profit: number): TradeOutcome => ({ won: false, profit });

const cfg = (kind: ProgressionConfig['kind'], unit = 1, multiplier?: number): ProgressionConfig => ({
  kind,
  unit,
  multiplier,
});

describe('flat progression', () => {
  it('ignores history entirely', () => {
    expect(progressionStake(cfg('flat', 2), [])).toBe(2);
    expect(progressionStake(cfg('flat', 2), [L(-2), L(-2), L(-2)])).toBe(2);
    expect(progressionStake(cfg('flat', 2), [W(2), W(2)])).toBe(2);
  });
});

describe('martingale', () => {
  it('doubles on each trailing loss and resets on a win', () => {
    expect(progressionStake(cfg('martingale'), [])).toBe(1);
    expect(progressionStake(cfg('martingale'), [L(-1)])).toBe(2);
    expect(progressionStake(cfg('martingale'), [L(-1), L(-2)])).toBe(4);
    expect(progressionStake(cfg('martingale'), [L(-1), L(-2), L(-4)])).toBe(8);
    // Only the TRAILING run matters: an earlier losing streak is already settled.
    expect(progressionStake(cfg('martingale'), [L(-1), L(-2), W(4), L(-1)])).toBe(2);
    expect(progressionStake(cfg('martingale'), [L(-1), L(-2), W(4)])).toBe(1);
  });

  it('honours a custom multiplier', () => {
    expect(progressionStake(cfg('martingale', 1, 1.5), [L(-1), L(-1.5)])).toBe(2.25);
    // A multiplier <= 1 is not a martingale; fall back to the Deriv default of 2.
    expect(progressionStake(cfg('martingale', 1, 1), [L(-1)])).toBe(2);
  });
});

describe('reverse martingale', () => {
  it('presses on wins and resets on a loss', () => {
    expect(progressionStake(cfg('reverse_martingale'), [])).toBe(1);
    expect(progressionStake(cfg('reverse_martingale'), [W(1)])).toBe(2);
    expect(progressionStake(cfg('reverse_martingale'), [W(1), W(2)])).toBe(4);
    expect(progressionStake(cfg('reverse_martingale'), [W(1), W(2), L(-4)])).toBe(1);
    expect(progressionStake(cfg('reverse_martingale'), [L(-1), W(1)])).toBe(2);
  });
});

describe("d'alembert", () => {
  it('moves one unit at a time and never below one unit', () => {
    expect(progressionStake(cfg('dalembert'), [])).toBe(1);
    expect(progressionStake(cfg('dalembert'), [L(-1)])).toBe(2);
    expect(progressionStake(cfg('dalembert'), [L(-1), L(-2)])).toBe(3);
    expect(progressionStake(cfg('dalembert'), [L(-1), W(1)])).toBe(1);
    expect(progressionStake(cfg('dalembert'), [L(-1), L(-2), W(3)])).toBe(2);
    // Floor: more wins than losses must not drive the stake below one unit.
    expect(progressionStake(cfg('dalembert'), [W(1), W(1), W(1)])).toBe(1);
  });

  it('is linear where martingale is geometric', () => {
    const five = Array.from({ length: 5 }, () => L(-1));
    expect(progressionStake(cfg('dalembert'), five)).toBe(6);
    expect(progressionStake(cfg('martingale'), five)).toBe(32);
  });
});

describe("reverse d'alembert", () => {
  it('mirrors d\u2019alembert', () => {
    expect(progressionStake(cfg('reverse_dalembert'), [W(1)])).toBe(2);
    expect(progressionStake(cfg('reverse_dalembert'), [W(1), W(2)])).toBe(3);
    expect(progressionStake(cfg('reverse_dalembert'), [W(1), L(-1)])).toBe(1);
    expect(progressionStake(cfg('reverse_dalembert'), [W(1), W(2), L(-3)])).toBe(2);
    expect(progressionStake(cfg('reverse_dalembert'), [L(-1), L(-1)])).toBe(1);
  });
});

describe("oscar's grind", () => {
  const unit = 1;

  it('closes the cycle as soon as one unit of profit is banked', () => {
    expect(progressionStake(cfg('oscars_grind', unit), [])).toBe(1);
    // First win at 1 unit stake banks exactly one unit -> cycle closes -> back to 1.
    expect(progressionStake(cfg('oscars_grind', unit), [W(1)])).toBe(1);
  });

  it('leaves the stake alone after a loss', () => {
    expect(progressionStake(cfg('oscars_grind', unit), [L(-1)])).toBe(1);
    expect(progressionStake(cfg('oscars_grind', unit), [L(-1), L(-1), L(-1)])).toBe(1);
  });

  it('raises by one unit after a win that does not yet meet the target', () => {
    // Down 1, then win 1 -> cycle profit 0, target not met, so stake goes to 2 units.
    expect(progressionStake(cfg('oscars_grind', unit), [L(-1), W(1)])).toBe(2);
    // Continue: stake 2 wins 2 -> cycle profit 2 >= 1 -> cycle closes.
    expect(progressionStake(cfg('oscars_grind', unit), [L(-1), W(1), W(2)])).toBe(1);
  });

  it('uses realised profit, so an off-even payout is handled correctly', () => {
    // A 1.95x contract staking 1 unit nets 0.95, not 1.00, so the target is NOT met
    // and the stake must rise rather than the cycle closing.
    expect(progressionStake(cfg('oscars_grind', unit), [W(0.95)])).toBe(2);
  });
});

describe('1-3-2-6', () => {
  it('walks the sequence on wins and restarts on any loss', () => {
    expect(progressionStake(cfg('one_three_two_six'), [])).toBe(1);
    expect(progressionStake(cfg('one_three_two_six'), [W(1)])).toBe(3);
    expect(progressionStake(cfg('one_three_two_six'), [W(1), W(3)])).toBe(2);
    expect(progressionStake(cfg('one_three_two_six'), [W(1), W(3), W(2)])).toBe(6);
    // Four consecutive wins close the cycle and start a fresh one.
    expect(progressionStake(cfg('one_three_two_six'), [W(1), W(3), W(2), W(6)])).toBe(1);
    expect(progressionStake(cfg('one_three_two_six'), [W(1), L(-3)])).toBe(1);
    expect(progressionStake(cfg('one_three_two_six'), [W(1), W(3), L(-2)])).toBe(1);
  });
});

describe('Deriv stake bounds', () => {
  it('never returns less than the 0.35 minimum', () => {
    expect(progressionStake(cfg('flat', 0.1), [])).toBe(DERIV_STAKE_MIN);
    expect(progressionStake(cfg('flat', 0), [])).toBe(DERIV_STAKE_MIN);
    expect(progressionStake(cfg('flat', -5), [])).toBe(DERIV_STAKE_MIN);
  });

  it('never returns more than the 50000 maximum', () => {
    const losses = Array.from({ length: 20 }, () => L(-1));
    expect(progressionStake(cfg('martingale', 1), losses)).toBe(DERIV_STAKE_MAX);
  });

  it('rounds to two decimals, the precision the API accepts', () => {
    // 0.35 * 1.5^3 = 1.18125
    expect(progressionStake(cfg('martingale', 0.35, 1.5), [L(-1), L(-1), L(-1)])).toBe(1.18);
  });

  it('survives a non-finite unit instead of producing NaN', () => {
    expect(progressionStake(cfg('flat', Number.NaN), [])).toBe(DERIV_STAKE_MIN);
    // A nonsense infinite unit fails SAFE to the smallest possible exposure.
    // Returning the maximum instead would turn a bad config into a maximal order.
    expect(progressionStake(cfg('flat', Number.POSITIVE_INFINITY), [])).toBe(DERIV_STAKE_MIN);
  });
});

describe('worstCaseStake', () => {
  it('matches the figure quoted in the Martingale risk copy', () => {
    // Ten straight losses from a 0.35 base at 2x is 358.40 — a thousand times the
    // starting stake, wagered to recover 0.35.
    expect(worstCaseStake(cfg('martingale', 0.35), 10)).toBe(358.4);
  });

  it('is flat for a fixed stake and grows for d\u2019alembert', () => {
    expect(worstCaseStake(cfg('flat', 0.35), 10)).toBe(0.35);
    expect(worstCaseStake(cfg('dalembert', 0.35), 10)).toBe(3.85); // 0.35 * 11
  });

  it('caps out at the Deriv maximum', () => {
    expect(worstCaseStake(cfg('martingale', 0.35), 40)).toBe(DERIV_STAKE_MAX);
  });
});

describe('purity and metadata', () => {
  it('does not mutate the history it is given', () => {
    const history = [L(-1), W(1), L(-1)];
    const snapshot = JSON.stringify(history);
    progressionStake(cfg('martingale'), history);
    progressionStake(cfg('oscars_grind'), history);
    progressionStake(cfg('one_three_two_six'), history);
    expect(JSON.stringify(history)).toBe(snapshot);
  });

  it('is deterministic — the same history always gives the same stake', () => {
    const history = [L(-1), L(-2), W(4), L(-1), W(1), W(2)];
    const a = progressionStake(cfg('oscars_grind', 0.35), history);
    const b = progressionStake(cfg('oscars_grind', 0.35), history);
    expect(a).toBe(b);
  });

  it('describes every progression it implements, with a risk statement', () => {
    for (const kind of PROGRESSION_ORDER) {
      const info = PROGRESSIONS[kind];
      expect(info).toBeDefined();
      expect(info.kind).toBe(kind);
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.rule.length).toBeGreaterThan(0);
      expect(info.detail.length).toBeGreaterThan(0);
      // No progression may be described without its downside.
      expect(info.risk.length).toBeGreaterThan(0);
      expect(['none', 'gradual', 'steep']).toContain(info.escalation);
    }
  });

  it('offers the six named Deriv strategies plus a fixed-stake baseline', () => {
    expect(PROGRESSION_ORDER).toHaveLength(7);
    expect(PROGRESSION_ORDER).toContain('martingale');
    expect(PROGRESSION_ORDER).toContain('dalembert');
    expect(PROGRESSION_ORDER).toContain('reverse_martingale');
    expect(PROGRESSION_ORDER).toContain('reverse_dalembert');
    expect(PROGRESSION_ORDER).toContain('oscars_grind');
    expect(PROGRESSION_ORDER).toContain('one_three_two_six');
  });
});
