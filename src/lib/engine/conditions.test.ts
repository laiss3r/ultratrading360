import { describe, expect, it } from 'vitest';
import {
  describeCondition, evaluateCondition, evaluateGroup, isGroup, validateCondition, validateGroup,
  type Condition, type ConditionGroup, type DigitWindow,
} from './conditions';

const win = (digits: number[]): DigitWindow => ({ digits, symbol: 'R_100', pipSize: 2 });

describe('single conditions', () => {
  it('odd / even read the most recent digit', () => {
    expect(evaluateCondition({ id: '1', kind: 'odd' }, win([2, 4, 7])).satisfied).toBe(true);
    expect(evaluateCondition({ id: '1', kind: 'odd' }, win([2, 4, 6])).satisfied).toBe(false);
    expect(evaluateCondition({ id: '1', kind: 'even' }, win([1, 3, 8])).satisfied).toBe(true);
  });

  it('over / under use STRICT inequality against the barrier', () => {
    // digit 5, barrier 5 -> over is false, under is false
    expect(evaluateCondition({ id: '1', kind: 'over', barrier: 5 }, win([5])).satisfied).toBe(false);
    expect(evaluateCondition({ id: '1', kind: 'over', barrier: 5 }, win([6])).satisfied).toBe(true);
    expect(evaluateCondition({ id: '1', kind: 'under', barrier: 5 }, win([5])).satisfied).toBe(false);
    expect(evaluateCondition({ id: '1', kind: 'under', barrier: 5 }, win([4])).satisfied).toBe(true);
  });

  it('match / differ', () => {
    expect(evaluateCondition({ id: '1', kind: 'match', barrier: 7 }, win([7])).satisfied).toBe(true);
    expect(evaluateCondition({ id: '1', kind: 'match', barrier: 7 }, win([6])).satisfied).toBe(false);
    expect(evaluateCondition({ id: '1', kind: 'differ', barrier: 7 }, win([6])).satisfied).toBe(true);
    expect(evaluateCondition({ id: '1', kind: 'differ', barrier: 7 }, win([7])).satisfied).toBe(false);
  });

  it('lastNContains counts within the window only', () => {
    const c: Condition = { id: '1', kind: 'lastNContains', n: 5, digit: 3, threshold: 2 };
    expect(evaluateCondition(c, win([3, 3, 0, 0, 0])).satisfied).toBe(true);
    expect(evaluateCondition(c, win([3, 0, 0, 0, 0])).satisfied).toBe(false);
    // a 3 outside the trailing window must not count
    expect(evaluateCondition(c, win([3, 3, 3, 9, 9, 9, 9, 9])).satisfied).toBe(false);
  });

  it('rollingFrequency applies a percentage band', () => {
    const c: Condition = { id: '1', kind: 'rollingFrequency', n: 10, digit: 5, minPct: 20, maxPct: 40 };
    expect(evaluateCondition(c, win([5, 5, 5, 0, 0, 0, 0, 0, 0, 0])).satisfied).toBe(true); // 30%
    expect(evaluateCondition(c, win([5, 5, 5, 5, 5, 0, 0, 0, 0, 0])).satisfied).toBe(false); // 50%
    expect(evaluateCondition(c, win([5, 0, 0, 0, 0, 0, 0, 0, 0, 0])).satisfied).toBe(false); // 10%
  });

  it('consecutiveParity requires the whole run', () => {
    const odd3: Condition = { id: '1', kind: 'consecutiveParity', n: 3, digit: 1 };
    expect(evaluateCondition(odd3, win([1, 3, 5])).satisfied).toBe(true);
    expect(evaluateCondition(odd3, win([1, 3, 4])).satisfied).toBe(false);
    const even2: Condition = { id: '2', kind: 'consecutiveParity', n: 2, digit: 0 };
    expect(evaluateCondition(even2, win([8, 2])).satisfied).toBe(true);
  });

  it('consecutiveOver / consecutiveUnder', () => {
    const c: Condition = { id: '1', kind: 'consecutiveOver', n: 3, barrier: 5 };
    expect(evaluateCondition(c, win([6, 7, 9])).satisfied).toBe(true);
    expect(evaluateCondition(c, win([6, 7, 5])).satisfied).toBe(false);
    const u: Condition = { id: '2', kind: 'consecutiveUnder', n: 3, barrier: 5 };
    expect(evaluateCondition(u, win([0, 1, 4])).satisfied).toBe(true);
  });

  it('reports insufficient data instead of silently passing', () => {
    const c: Condition = { id: '1', kind: 'lastNContains', n: 50, digit: 5, threshold: 5 };
    const r = evaluateCondition(c, win([5, 5, 5]));
    expect(r.satisfied).toBe(false);
    expect(r.insufficientData).toBe(true);
    expect(r.requiredDigits).toBe(50);
  });

  it('produces a human-readable trace', () => {
    const r = evaluateCondition({ id: '1', kind: 'over', barrier: 5 }, win([7]));
    expect(r.reasons[0]).toMatch(/7/);
    expect(r.reasons[0]).toMatch(/>/);
  });
});

describe('AND / OR groups', () => {
  const odd: Condition = { id: 'a', kind: 'odd' };
  const over5: Condition = { id: 'b', kind: 'over', barrier: 5 };

  it('AND requires every child', () => {
    const g: ConditionGroup = { id: 'g', op: 'AND', children: [odd, over5] };
    expect(evaluateGroup(g, win([7])).satisfied).toBe(true); // odd and >5
    expect(evaluateGroup(g, win([3])).satisfied).toBe(false); // odd but not >5
    expect(evaluateGroup(g, win([8])).satisfied).toBe(false); // >5 but even
  });

  it('OR requires one child', () => {
    const g: ConditionGroup = { id: 'g', op: 'OR', children: [odd, over5] };
    expect(evaluateGroup(g, win([3])).satisfied).toBe(true);
    expect(evaluateGroup(g, win([8])).satisfied).toBe(true);
    expect(evaluateGroup(g, win([2])).satisfied).toBe(false);
  });

  it('nests groups correctly', () => {
    const inner: ConditionGroup = { id: 'i', op: 'OR', children: [odd, over5] };
    const outer: ConditionGroup = {
      id: 'o',
      op: 'AND',
      children: [inner, { id: 'c', kind: 'lastNContains', n: 4, digit: 9, threshold: 1 }],
    };
    expect(isGroup(inner)).toBe(true);
    expect(isGroup(odd)).toBe(false);
    expect(evaluateGroup(outer, win([9, 9, 9, 7])).satisfied).toBe(true);
    expect(evaluateGroup(outer, win([9, 9, 9, 2])).satisfied).toBe(false);
  });

  it('propagates requiredDigits as the max across children', () => {
    const g: ConditionGroup = {
      id: 'g', op: 'AND',
      children: [{ id: '1', kind: 'odd' }, { id: '2', kind: 'rollingFrequency', n: 200, digit: 5 }],
    };
    expect(evaluateGroup(g, win([5, 5, 5])).requiredDigits).toBe(200);
  });
});

describe('validation', () => {
  it('rejects out-of-range barriers', () => {
    expect(validateCondition({ id: '1', kind: 'over', barrier: 10 })).not.toHaveLength(0);
    expect(validateCondition({ id: '1', kind: 'over', barrier: -1 })).not.toHaveLength(0);
    expect(validateCondition({ id: '1', kind: 'over' })).not.toHaveLength(0); // missing
    expect(validateCondition({ id: '1', kind: 'over', barrier: 5 })).toHaveLength(0);
  });

  it('rejects barriers that can never be satisfied', () => {
    expect(validateCondition({ id: '1', kind: 'over', barrier: 9 })).not.toHaveLength(0);
    expect(validateCondition({ id: '1', kind: 'under', barrier: 0 })).not.toHaveLength(0);
  });

  it('rejects bad windows and inverted bands', () => {
    expect(validateCondition({ id: '1', kind: 'odd', n: 0 })).not.toHaveLength(0);
    expect(validateCondition({ id: '1', kind: 'odd', n: 99999 })).not.toHaveLength(0);
    expect(validateCondition({ id: '1', kind: 'rollingFrequency', digit: 12 })).not.toHaveLength(0);
    expect(validateCondition({ id: '1', kind: 'rollingFrequency', minPct: 80, maxPct: 20 })).not.toHaveLength(0);
  });

  it('rejects empty groups and recurses into nested groups', () => {
    expect(validateGroup({ id: 'g', op: 'AND', children: [] })).not.toHaveLength(0);
    const nested: ConditionGroup = {
      id: 'o', op: 'AND',
      children: [{ id: 'i', op: 'OR', children: [{ id: 'x', kind: 'over', barrier: 99 }] }],
    };
    const errs = validateGroup(nested);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/\(OR\)/);
  });

  it('describes every condition kind', () => {
    const kinds: Condition['kind'][] = ['odd','even','over','under','match','differ','lastNContains','rollingFrequency','consecutiveParity','consecutiveOver','consecutiveUnder'];
    for (const kind of kinds) {
      expect(describeCondition({ id: 'x', kind, barrier: 5, n: 3, digit: 5, threshold: 1, minPct: 0, maxPct: 100 })).toBeTruthy();
    }
  });
});

describe("the 'always' condition (unconditional entry)", () => {
  it('passes with zero digits buffered and never claims insufficient data', () => {
    const r = evaluateCondition({ id: 'a', kind: 'always' }, { digits: [], symbol: 'R_100', pipSize: 2 });
    expect(r.satisfied).toBe(true);
    expect(r.insufficientData).toBe(false);
    expect(r.requiredDigits).toBe(0);
  });

  it('passes regardless of what the digits actually are', () => {
    for (const digits of [[0], [9], [1, 2, 3], [5, 5, 5, 5, 5]]) {
      const r = evaluateCondition({ id: 'a', kind: 'always' }, { digits, symbol: 'R_100', pipSize: 2 });
      expect(r.satisfied).toBe(true);
    }
  });

  it('is valid on its own and inside a group', () => {
    expect(validateCondition({ id: 'a', kind: 'always' })).toEqual([]);
    expect(validateGroup({ id: 'g', op: 'AND', children: [{ id: 'a', kind: 'always' }] })).toEqual([]);
  });

  it('has a human-readable description so the gate is never a black box', () => {
    expect(describeCondition({ id: 'a', kind: 'always' })).toMatch(/always/i);
  });

  it('ANDs and ORs predictably with a real condition', () => {
    const w = { digits: [4], symbol: 'R_100', pipSize: 2 };
    const andGroup = { id: 'g', op: 'AND' as const, children: [{ id: 'a', kind: 'always' as const }, { id: 'b', kind: 'odd' as const }] };
    expect(evaluateGroup(andGroup, w).satisfied).toBe(false); // 4 is even
    const orGroup = { id: 'g', op: 'OR' as const, children: [{ id: 'a', kind: 'always' as const }, { id: 'b', kind: 'odd' as const }] };
    expect(evaluateGroup(orGroup, w).satisfied).toBe(true);
  });
});
