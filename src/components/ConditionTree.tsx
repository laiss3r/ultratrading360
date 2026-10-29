'use client';

import { Fragment } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';
import { describeCondition, isGroup, type Condition, type ConditionGroup, type ConditionKind } from '@/lib/engine/conditions';

let seq = 0;
const nid = (p: string) => `${p}${++seq}${Date.now().toString(36).slice(-3)}`;

const KINDS: { value: ConditionKind; label: string; hint: string }[] = [
  { value: 'always', label: 'Always (no filter)', hint: 'Passes unconditionally. Trade every eligible tick, limited only by cooldown and the risk manager.' },
  { value: 'odd', label: 'Digit ODD', hint: 'Most recent digit is odd (1,3,5,7,9).' },
  { value: 'even', label: 'Digit EVEN', hint: 'Most recent digit is even (0,2,4,6,8).' },
  { value: 'over', label: 'Digit OVER barrier', hint: 'Most recent digit is strictly greater than the barrier.' },
  { value: 'under', label: 'Digit UNDER barrier', hint: 'Most recent digit is strictly less than the barrier.' },
  { value: 'match', label: 'Digit MATCHES', hint: 'Most recent digit equals a chosen digit.' },
  { value: 'differ', label: 'Digit DIFFERS', hint: 'Most recent digit is not a chosen digit.' },
  { value: 'lastNContains', label: 'Last N contains digit', hint: 'A digit appears at least K times in the last N ticks.' },
  { value: 'rollingFrequency', label: 'Rolling frequency band', hint: 'A digit\'s share of the last N ticks falls inside a % band.' },
  { value: 'consecutiveParity', label: 'N consecutive parity', hint: 'The last N digits are all odd or all even.' },
  { value: 'consecutiveOver', label: 'N consecutive OVER', hint: 'The last N digits are all above a barrier.' },
  { value: 'consecutiveUnder', label: 'N consecutive UNDER', hint: 'The last N digits are all below a barrier.' },
];

function defaultsFor(kind: ConditionKind): Condition {
  const base: Condition = { id: nid('c'), kind };
  switch (kind) {
    case 'always':
      return base;
    case 'over':
    case 'under':
      return { ...base, barrier: 5 };
    case 'match':
    case 'differ':
      return { ...base, barrier: 5 };
    case 'lastNContains':
      return { ...base, digit: 5, n: 10, threshold: 2 };
    case 'rollingFrequency':
      return { ...base, digit: 5, n: 50, minPct: 0, maxPct: 8 };
    case 'consecutiveParity':
      return { ...base, digit: 1, n: 3 };
    case 'consecutiveOver':
    case 'consecutiveUnder':
      return { ...base, barrier: 5, n: 3 };
    default:
      return base;
  }
}

export function emptyGroup(): ConditionGroup {
  return { id: nid('g'), op: 'AND', children: [defaultsFor('odd')] };
}

/** Deep-clone + patch helpers, so edits never mutate the saved strategy object. */
function patchNode(root: ConditionGroup, id: string, fn: (n: Condition) => Condition): ConditionGroup {
  const walk = (g: ConditionGroup): ConditionGroup => ({
    ...g,
    children: g.children.map((c) => {
      if (isGroup(c)) return c.id === id ? patchNode(c, id, fn) : walk(c);
      return c.id === id ? fn(c) : c;
    }),
  });
  return walk(root);
}

function removeNode(root: ConditionGroup, id: string): ConditionGroup {
  const walk = (g: ConditionGroup): ConditionGroup => ({
    ...g,
    children: g.children.map((c) => (isGroup(c) ? walk(c) : c)).filter((c) => c.id !== id),
  });
  return walk(root);
}

function addChild(root: ConditionGroup, parentId: string, node: Condition | ConditionGroup): ConditionGroup {
  const walk = (g: ConditionGroup): ConditionGroup => {
    if (g.id === parentId) return { ...g, children: [...g.children, node] };
    return { ...g, children: g.children.map((c) => (isGroup(c) ? walk(c) : c)) };
  };
  return walk(root);
}

function setOp(root: ConditionGroup, id: string, op: 'AND' | 'OR'): ConditionGroup {
  const walk = (g: ConditionGroup): ConditionGroup => {
    if (g.id === id) return { ...g, op };
    return { ...g, children: g.children.map((c) => (isGroup(c) ? walk(c) : c)) };
  };
  return walk(root);
}

/**
 * Visual AND/OR tree editor.
 *
 * Every condition renders its own plain-English description next to its controls, so the gate is
 * never a black box. The tree is plain JSON — serialisable, versionable, and the same object the
 * engine evaluates.
 */
export function ConditionTree({
  group,
  onChange,
  depth = 0,
}: {
  group: ConditionGroup;
  onChange: (g: ConditionGroup) => void;
  depth?: number;
}) {
  const isRoot = depth === 0;

  return (
    <div
      className={cn(
        'rounded-lg border',
        isRoot ? 'border-line bg-base/30' : 'border-line-strong/60 bg-elevated/40',
        depth > 0 && 'ml-3 border-l-2 border-l-accent/30 pl-2.5',
      )}
    >
      <div className={cn('flex items-center gap-2 px-2.5', isRoot ? 'py-2' : 'py-1.5')}>
        <span className="text-[10px] font-semibold tracking-wider text-ink-4 uppercase">{isRoot ? 'Entry gate' : 'Group'}</span>
        <div className="inline-flex rounded-md border border-line bg-base/60 p-0.5">
          {(['AND', 'OR'] as const).map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => onChange(setOp(group, group.id, op))}
              className={cn(
                'rounded px-2 py-0.5 text-[10px] font-bold transition-colors',
                group.op === op ? (op === 'AND' ? 'bg-accent/18 text-accent' : 'bg-brand/18 text-brand') : 'text-ink-4 hover:text-ink-2',
              )}
            >
              {op}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-ink-4">
          {group.op === 'AND' ? 'all children must pass' : 'any child may pass'} · {group.children.length} condition(s)
        </span>
        <div className="ml-auto flex items-center gap-1">
          <select
            className="w-[172px] py-0.5 text-[10.5px]"
            value=""
            onChange={(e) => {
              const kind = e.target.value as ConditionKind;
              if (kind) onChange(addChild(group, group.id, defaultsFor(kind)));
              e.target.value = '';
            }}
            title="Add a condition to this group"
          >
            <option value="">+ condition…</option>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="ghost"
            title="Add a nested AND/OR group"
            onClick={() => onChange(addChild(group, group.id, { id: nid('g'), op: group.op === 'AND' ? 'OR' : 'AND', children: [defaultsFor('even')] }))}
          >
            <Plus className="h-3 w-3" /> group
          </Button>
          {!isRoot && (
            <Button size="sm" variant="ghost" title="Delete this group" onClick={() => onChange(removeNode(group, group.id))}>
              <Trash2 className="h-3 w-3 text-loss" />
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-1.5 px-2.5 pb-2.5">
        {group.children.length === 0 && (
          <div className="rounded border border-dashed border-line px-2 py-3 text-center text-[11px] text-ink-4">
            Empty group — add a condition, or delete the group. An empty AND passes vacuously; an empty OR never passes.
          </div>
        )}
        {group.children.map((child, i) => (
          <Fragment key={child.id}>
            {i > 0 && (
              <div className="flex items-center gap-2 pl-1">
                <span className={cn('num text-[9.5px] font-bold', group.op === 'AND' ? 'text-accent' : 'text-brand')}>{group.op}</span>
                <span className="h-px flex-1 bg-line" />
              </div>
            )}
            {isGroup(child) ? (
              <ConditionTree group={child} onChange={(g) => onChange(patchGroup(group, child.id, g))} depth={depth + 1} />
            ) : (
              <ConditionRow
                condition={child}
                onChange={(c) => onChange(patchNode(group, child.id, () => c))}
                onDelete={() => onChange(removeNode(group, child.id))}
              />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function patchGroup(root: ConditionGroup, id: string, replacement: ConditionGroup): ConditionGroup {
  const walk = (g: ConditionGroup): ConditionGroup => ({
    ...g,
    children: g.children.map((c) => {
      if (!isGroup(c)) return c;
      if (c.id === id) return replacement;
      return walk(c);
    }),
  });
  return walk(root);
}

function ConditionRow({ condition, onChange, onDelete }: { condition: Condition; onChange: (c: Condition) => void; onDelete: () => void }) {
  const meta = KINDS.find((k) => k.value === condition.kind);
  const needsBarrier = ['over', 'under', 'match', 'differ'].includes(condition.kind);
  const needsN = ['lastNContains', 'rollingFrequency', 'consecutiveParity', 'consecutiveOver', 'consecutiveUnder'].includes(condition.kind);
  const needsDigit = ['lastNContains', 'rollingFrequency'].includes(condition.kind);
  const parityDigit = condition.kind === 'consecutiveParity';

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5">
      <span className="min-w-[128px] shrink-0 text-[11px] font-medium text-ink">{meta?.label ?? condition.kind}</span>

      {needsBarrier && (
        <MiniNum label="barrier" value={condition.barrier ?? 5} min={0} max={9} step={1} onChange={(v) => onChange({ ...condition, barrier: v })} />
      )}
      {parityDigit && (
        <MiniNum
          label="parity"
          value={condition.digit ?? 1}
          min={0}
          max={9}
          step={1}
          onChange={(v) => onChange({ ...condition, digit: v })}
          title="Only the parity of this digit matters: even = all-even run, odd = all-odd run."
        />
      )}
      {needsDigit && <MiniNum label="digit" value={condition.digit ?? 5} min={0} max={9} step={1} onChange={(v) => onChange({ ...condition, digit: v })} />}
      {needsN && <MiniNum label="window N" value={condition.n ?? 10} min={1} max={1000} step={1} onChange={(v) => onChange({ ...condition, n: v })} />}
      {condition.kind === 'lastNContains' && (
        <MiniNum label="min count" value={condition.threshold ?? 1} min={1} max={1000} step={1} onChange={(v) => onChange({ ...condition, threshold: v })} />
      )}
      {condition.kind === 'rollingFrequency' && (
        <>
          <MiniNum label="min %" value={condition.minPct ?? 0} min={0} max={100} step={0.5} onChange={(v) => onChange({ ...condition, minPct: v })} />
          <MiniNum label="max %" value={condition.maxPct ?? 100} min={0} max={100} step={0.5} onChange={(v) => onChange({ ...condition, maxPct: v })} />
        </>
      )}

      <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-4" title={describeCondition(condition)}>
        → {describeCondition(condition)}
      </span>

      <button type="button" onClick={onDelete} className="shrink-0 rounded p-1 text-ink-4 transition-colors hover:bg-loss/12 hover:text-loss" title="Delete condition">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function MiniNum({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  title,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  title?: string;
}) {
  return (
    <label className="flex shrink-0 items-center gap-1" title={title}>
      <span className="text-[9.5px] tracking-wide text-ink-4 uppercase">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="num w-[62px] py-0.5 text-[11px]"
      />
    </label>
  );
}

export { KINDS };
