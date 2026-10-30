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
  | 'consecutiveUnder'
  /* Indicator conditions over the tick price series, the way Deriv Bot's
     Indicators subtab gates a purchase: period in ticks, evaluated on the
     latest price against the indicator's own line. */
  | 'smaAbove'
  | 'smaBelow'
  | 'rsiAbove'
  | 'rsiBelow'
  | 'bbAboveUpper'
  | 'bbBelowLower';

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
import { bollinger, rsi, sma, type BollingerBands } from './indicators';

export interface DigitWindow {
  digits: number[];
  symbol: string;
  pipSize: number;
  /**
   * Tick prices, oldest first. Digit conditions ignore this; indicator
   * conditions need it, and report insufficient data when the series is
   * shorter than their period rather than evaluating a partial window.
   */
  prices?: number[];
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

    case 'smaAbove':
    case 'smaBelow': {
      const p = c.n ?? 20;
      const prices = w.prices ?? [];
      if (prices.length < p) return res(false, [`SMA(${p}) needs ${p} prices, have ${prices.length}`], 0, true);
      const m = sma(prices, p) as number;
      const lastP = prices[prices.length - 1];
      const above = c.kind === 'smaAbove';
      return res(above ? lastP > m : lastP < m, [`last price ${lastP} ${above ? '>' : '<'} SMA(${p}) ${m.toFixed(4)}`], 0, false);
    }

    case 'rsiAbove':
    case 'rsiBelow': {
      const p = c.n ?? 14;
      const level = c.threshold ?? (c.kind === 'rsiAbove' ? 70 : 30);
      const prices = w.prices ?? [];
      if (prices.length < p + 1) return res(false, [`RSI(${p}) needs ${p + 1} prices, have ${prices.length}`], 0, true);
      const v = rsi(prices, p) as number;
      const above = c.kind === 'rsiAbove';
      return res(above ? v >= level : v <= level, [`RSI(${p}) ${v.toFixed(1)} ${above ? '>=' : '<='} ${level}`], 0, false);
    }

    case 'bbAboveUpper':
    case 'bbBelowLower': {
      const p = c.n ?? 20;
      const prices = w.prices ?? [];
      if (prices.length < p) return res(false, [`Bollinger(${p}) needs ${p} prices, have ${prices.length}`], 0, true);
      const bb = bollinger(prices, p, 2) as BollingerBands;
      const lastP = prices[prices.length - 1];
      const upper = c.kind === 'bbAboveUpper';
      return res(
        upper ? lastP > bb.upper : lastP < bb.lower,
        [`last price ${lastP} ${upper ? '>' : '<'} Bollinger(${p}) ${upper ? 'upper' : 'lower'} ${ (upper ? bb.upper : bb.lower).toFixed(4)}`],
        0,
        false,
      );
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
    case 'smaAbove': return `Last price above SMA(${c.n ?? 20})`;
    case 'smaBelow': return `Last price below SMA(${c.n ?? 20})`;
    case 'rsiAbove': return `RSI(${c.n ?? 14}) at or above ${c.threshold ?? 70}`;
    case 'rsiBelow': return `RSI(${c.n ?? 14}) at or below ${c.threshold ?? 30}`;
    case 'bbAboveUpper': return `Last price above upper Bollinger(${c.n ?? 20}) band`;
    case 'bbBelowLower': return `Last price below lower Bollinger(${c.n ?? 20}) band`;
    default: return c.kind;
  }
}

/** Validation — run before a strategy may be saved or executed. */
export function validateCondition(c: Condition): string[] {
  const errs: string[] = [];
  const needsBarrier = ['over', 'under', 'match', 'differ', 'consecutiveOver', 'consecutiveUnder'];
  const needsPeriod = ['smaAbove', 'smaBelow', 'rsiAbove', 'rsiBelow', 'bbAboveUpper', 'bbBelowLower'];
  if (needsPeriod.includes(c.kind)) {
    const n = c.n ?? 20;
    if (!Number.isFinite(n) || n < 2 || n > 1000) errs.push('indicator period must be between 2 and 1000 ticks');
  }
  if ((c.kind === 'rsiAbove' || c.kind === 'rsiBelow') && c.threshold != null && (c.threshold < 0 || c.threshold > 100)) {
    errs.push('RSI level must be between 0 and 100');
  }
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
