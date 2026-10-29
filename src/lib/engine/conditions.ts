/**
 * Entry-condition language for the strategy builder.
 *
 * A strategy has ONE gate (an AND/OR tree of conditions) and ONE contract to buy when the
 * gate opens. Keeping the gate separate from the contract is what makes AND/OR groups
 * composable and the whole thing serialisable, versionable and testable.
 */

export type ConditionKind =
  /**
   * Unconditional entry. Used by quick-launch flows that trade every eligible tick rather than
   * waiting for a pattern. Requires 0 digits, so it never reports insufficient data.
   */
  | 'always'
  | 'odd'
  | 'even'
  | 'over'
  | 'under'
  | 'match'
  | 'differ'
  | 'lastNContains'
  | 'rollingFrequency'
  | 'consecutiveParity'
  | 'consecutiveOver'
  | 'consecutiveUnder';

export interface Condition {
  id: string;
  kind: ConditionKind;
  /** Barrier digit 0..9 for over/under/match/differ. */
  barrier?: number;
  /** Window length for rolling conditions. */
  n?: number;
  /** Digit of interest for lastNContains / rollingFrequency. */
  digit?: number;
  /** Count threshold for lastNContains. */
  threshold?: number;
  /** Percent band for rollingFrequency. */
  minPct?: number;
  maxPct?: number;
  label?: string;
}

export interface ConditionGroup {
  id: string;
  op: 'AND' | 'OR';
  children: Array<Condition | ConditionGroup>;
}

export function isGroup(x: Condition | ConditionGroup): x is ConditionGroup {
  return (x as ConditionGroup).op !== undefined && Array.isArray((x as ConditionGroup).children);
}

/** Digits, oldest first, newest last. */
export interface DigitWindow {
  digits: number[];
  symbol: string;
  pipSize: number;
}

export interface EvaluationResult {
  satisfied: boolean;
  /** Human-readable trace — shown in the UI so a signal is never a black box. */
  reasons: string[];
  /** How many digits were needed vs available. */
  requiredDigits: number;
  insufficientData: boolean;
}

export function evaluateCondition(c: Condition, w: DigitWindow): EvaluationResult {
  const d = w.digits;
  const last = d[d.length - 1];
  const reasons: string[] = [];
  const need = (n: number): { ok: boolean } => {
    if (d.length < n) {
      return { ok: false };
    }
    return { ok: true };
  };

  switch (c.kind) {
    case 'always':
      return res(true, ['unconditional entry — no digit pattern required'], 0, false);
    case 'odd':
      return res(last % 2 === 1, [`last digit ${last} is odd`], 1, d.length < 1);
    case 'even':
      return res(last % 2 === 0, [`last digit ${last} is even`], 1, d.length < 1);

    case 'over': {
      const b = c.barrier ?? 5;
      return res(last > b, [`last digit ${last} ${last > b ? '>' : '<='} barrier ${b}`], 1, d.length < 1);
    }
    case 'under': {
      const b = c.barrier ?? 5;
      return res(last < b, [`last digit ${last} ${last < b ? '<' : '>='} barrier ${b}`], 1, d.length < 1);
    }
    case 'match': {
      const b = c.barrier ?? 5;
      return res(last === b, [`last digit ${last} ${last === b ? '==' : '!='} ${b}`], 1, d.length < 1);
    }
    case 'differ': {
      const b = c.barrier ?? 5;
      return res(last !== b, [`last digit ${last} ${last !== b ? '!=' : '=='} ${b}`], 1, d.length < 1);
    }

    case 'lastNContains': {
      const n = c.n ?? 10;
      const digit = c.digit ?? 5;
      const thr = c.threshold ?? 1;
      if (!need(n).ok) return res(false, [`need ${n} digits, have ${d.length}`], n, true);
      const window = d.slice(-n);
      const count = window.filter((x) => x === digit).length;
      return res(count >= thr, [`${count}/${n} of last ${n} digits equal ${digit} (threshold ${thr})`], n, false);
    }

    case 'rollingFrequency': {
      const n = c.n ?? 50;
      const digit = c.digit ?? 5;
      const min = c.minPct ?? 0;
      const max = c.maxPct ?? 100;
      if (!need(n).ok) return res(false, [`need ${n} digits, have ${d.length}`], n, true);
      const window = d.slice(-n);
      const pct = (window.filter((x) => x === digit).length / n) * 100;
      return res(pct >= min && pct <= max, [`digit ${digit} at ${pct.toFixed(1)}% of last ${n} (band ${min}-${max}%)`], n, false);
    }

    case 'consecutiveParity': {
      const n = c.n ?? 3;
      const parity = (c.digit ?? 0) % 2 === 0 ? 'even' : 'odd';
      if (!need(n).ok) return res(false, [`need ${n} digits, have ${d.length}`], n, true);
      const window = d.slice(-n);
      const allSame = window.every((x) => (parity === 'odd' ? x % 2 === 1 : x % 2 === 0));
      return res(allSame, [`last ${n} digits [${window.join(',')}] all ${parity}`], n, false);
    }

    case 'consecutiveOver':
    case 'consecutiveUnder': {
      const n = c.n ?? 3;
      const b = c.barrier ?? 5;
      if (!need(n).ok) return res(false, [`need ${n} digits, have ${d.length}`], n, true);
      const window = d.slice(-n);
      const over = c.kind === 'consecutiveOver';
      const allMatch = window.every((x) => (over ? x > b : x < b));
      return res(allMatch, [`last ${n} digits [${window.join(',')}] all ${over ? '>' : '<'} ${b}`], n, false);
    }

    default:
      return res(false, [`unknown condition kind: ${(c as Condition).kind}`], 0, false);
  }
}

function res(satisfied: boolean, reasons: string[], requiredDigits: number, insufficientData: boolean): EvaluationResult {
  return { satisfied, reasons, requiredDigits, insufficientData };
}

export function evaluateGroup(g: ConditionGroup, w: DigitWindow): EvaluationResult {
  const childResults = g.children.map((ch) => (isGroup(ch) ? evaluateGroup(ch, w) : evaluateCondition(ch, w)));
  const satisfied =
    g.op === 'AND' ? childResults.every((r) => r.satisfied) : childResults.some((r) => r.satisfied);
  const reasons = childResults.flatMap((r, i) => {
    const child = g.children[i];
    const name = isGroup(child) ? `(${child.op} group)` : describeCondition(child);
    return [`${r.satisfied ? '✓' : '✗'} ${name}: ${r.reasons.join('; ') || 'no detail'}`];
  });
  const requiredDigits = Math.max(0, ...childResults.map((r) => r.requiredDigits));
  const insufficientData = childResults.some((r) => r.insufficientData);
  return { satisfied, reasons, requiredDigits, insufficientData };
}

export function describeCondition(c: Condition): string {
  switch (c.kind) {
    case 'always': return 'Always (no entry filter — trades every eligible tick)';
    case 'odd': return 'Last digit ODD';
    case 'even': return 'Last digit EVEN';
    case 'over': return `Last digit OVER ${c.barrier ?? 5}`;
    case 'under': return `Last digit UNDER ${c.barrier ?? 5}`;
    case 'match': return `Last digit MATCHES ${c.barrier ?? 5}`;
    case 'differ': return `Last digit DIFFERS from ${c.barrier ?? 5}`;
    case 'lastNContains': return `Digit ${c.digit ?? 5} appears >= ${c.threshold ?? 1}x in last ${c.n ?? 10}`;
    case 'rollingFrequency': return `Digit ${c.digit ?? 5} frequency within ${c.minPct ?? 0}-${c.maxPct ?? 100}% over last ${c.n ?? 50}`;
    case 'consecutiveParity': return `${c.n ?? 3} consecutive ${(c.digit ?? 0) % 2 === 0 ? 'EVEN' : 'ODD'} digits`;
    case 'consecutiveOver': return `${c.n ?? 3} consecutive digits OVER ${c.barrier ?? 5}`;
    case 'consecutiveUnder': return `${c.n ?? 3} consecutive digits UNDER ${c.barrier ?? 5}`;
  }
}

/** Validation — run before a strategy may be saved or executed. */
export function validateCondition(c: Condition): string[] {
  const errs: string[] = [];
  const needsBarrier = ['over', 'under', 'match', 'differ', 'consecutiveOver', 'consecutiveUnder'];
  if (needsBarrier.includes(c.kind)) {
    if (c.barrier === undefined || !Number.isInteger(c.barrier) || c.barrier < 0 || c.barrier > 9) {
      errs.push(`${c.kind}: barrier must be an integer 0..9`);
    }
    if ((c.kind === 'over' && c.barrier === 9) || (c.kind === 'under' && c.barrier === 0)) {
      errs.push(`${c.kind}: barrier ${c.barrier} can never be satisfied`);
    }
  }
  if (c.n !== undefined && (!Number.isInteger(c.n) || c.n < 1 || c.n > 5000)) {
    errs.push(`${c.kind}: window n must be an integer 1..5000`);
  }
  if (c.digit !== undefined && (!Number.isInteger(c.digit) || c.digit < 0 || c.digit > 9)) {
    errs.push(`${c.kind}: digit must be 0..9`);
  }
  if (c.minPct !== undefined && c.maxPct !== undefined && c.minPct > c.maxPct) {
    errs.push('rollingFrequency: minPct > maxPct');
  }
  return errs;
}

export function validateGroup(g: ConditionGroup): string[] {
  const errs: string[] = [];
  if (!g.children.length) errs.push('condition group is empty');
  for (const ch of g.children) {
    if (isGroup(ch)) errs.push(...validateGroup(ch).map((e) => `(${ch.op}) ${e}`));
    else errs.push(...validateCondition(ch).map((e) => `[${ch.id}] ${e}`));
  }
  return errs;
}
