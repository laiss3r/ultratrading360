'use client';

import { Fragment } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { describeCondition, isGroup, type Condition, type ConditionGroup, type ConditionKind } from '@/lib/engine/conditions';

let seq = 0;
const nid = (p: string) => `${p}${++seq}${Date.now().toString(36).slice(-3)}`;

/** Toolbox grouping, mirroring how Deriv Bot files its blocks into categories. */
export type ConditionCategory = 'flow' | 'digits' | 'history';

export const KINDS: { value: ConditionKind; label: string; hint: string; category: ConditionCategory }[] = [
  { value: 'always', label: 'Always (no filter)', hint: 'Passes unconditionally. Trade every eligible tick, limited only by cooldown and the risk manager.', category: 'flow' },
  { value: 'odd', label: 'Digit ODD', hint: 'Most recent digit is odd (1,3,5,7,9).', category: 'digits' },
  { value: 'even', label: 'Digit EVEN', hint: 'Most recent digit is even (0,2,4,6,8).', category: 'digits' },
  { value: 'over', label: 'Digit OVER barrier', hint: 'Most recent digit is strictly greater than the barrier.', category: 'digits' },
  { value: 'under', label: 'Digit UNDER barrier', hint: 'Most recent digit is strictly less than the barrier.', category: 'digits' },
  { value: 'match', label: 'Digit MATCHES', hint: 'Most recent digit equals a chosen digit.', category: 'digits' },
  { value: 'differ', label: 'Digit DIFFERS', hint: 'Most recent digit is not a chosen digit.', category: 'digits' },
  { value: 'lastNContains', label: 'Last N contains digit', hint: 'A digit appears at least K times in the last N ticks.', category: 'history' },
  { value: 'rollingFrequency', label: 'Rolling frequency band', hint: "A digit's share of the last N ticks falls inside a % band.", category: 'history' },
  { value: 'consecutiveParity', label: 'N consecutive parity', hint: 'The last N digits are all odd or all even.', category: 'history' },
  { value: 'consecutiveOver', label: 'N consecutive OVER', hint: 'The last N digits are all above a barrier.', category: 'history' },
  { value: 'consecutiveUnder', label: 'N consecutive UNDER', hint: 'The last N digits are all below a barrier.', category: 'history' },
];

export const CATEGORY_META: Record<ConditionCategory, { label: string; colour: string }> = {
  flow: { label: 'Trade flow', colour: 'var(--color-block-market)' },
  digits: { label: 'Last digit', colour: 'var(--color-block-purchase)' },
  history: { label: 'Digit history', colour: 'var(--color-block-math)' },
};

const LOGIC_COLOUR = 'var(--color-block-logic)';
const GROUP_COLOUR = 'var(--color-block-var)';

export function defaultsFor(kind: ConditionKind): Condition {
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

export function addChild(root: ConditionGroup, parentId: string, node: Condition | ConditionGroup): ConditionGroup {
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

/**
 * Purchase-condition editor, drawn as interlocking blocks.
 *
 * Deriv Bot's builder is a Blockly workspace; this is the same idea without the
 * dependency. Each condition is a coloured block whose colour tells you its
 * category, groups nest with an indentation guide, and the AND/OR operator sits
 * on the group header exactly where a Blockly hat block sits. Every block also
 * prints its own plain-English meaning, so the gate is never a black box.
 *
 * The editing logic below is unchanged from the tested version — the same
 * immutable tree walks, the same defaults — because a restyle must not silently
 * alter behaviour.
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
  const colour = group.op === 'AND' ? LOGIC_COLOUR : GROUP_COLOUR;

  return (
    <div className={cn('dt-block dt-block--notch', depth > 0 && 'ml-4')} style={{ background: colour }}>
      <div className="dt-block__head">
        <span className="text-xxs font-bold tracking-wide uppercase opacity-80">{isRoot ? 'Purchase conditions' : 'Group'}</span>
        <span className="inline-flex overflow-hidden rounded-sm bg-black/20">
          {(['AND', 'OR'] as const).map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => onChange(setOp(group, group.id, op))}
              aria-pressed={group.op === op}
              className={cn(
                'px-2 py-0.5 text-xxs font-bold transition-colors',
                group.op === op ? 'bg-white/90 text-[#333]' : 'text-white/75 hover:bg-white/15',
              )}
            >
              {op}
            </button>
          ))}
        </span>
        <span className="text-xxs font-normal opacity-80">
          {group.op === 'AND' ? 'all must pass' : 'any may pass'} · {group.children.length} block
          {group.children.length === 1 ? '' : 's'}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {!isRoot && (
            <button
              type="button"
              onClick={() => onChange(removeNode(group, group.id))}
              className="rounded p-1 text-white/80 hover:bg-black/25 hover:text-white"
              title="Delete this group"
              aria-label="Delete this group"
            >
              <Trash2 size={12} />
            </button>
          )}
        </span>
      </div>

      <div className="dt-block__body flex flex-col gap-1.5">
        {group.children.length === 0 && (
          <div className="rounded-sm border border-dashed border-white/40 px-2 py-2.5 text-center text-xxs text-white/85">
            Empty group. An empty AND passes vacuously; an empty OR never passes.
          </div>
        )}
        {group.children.map((child, i) => (
          <Fragment key={child.id}>
            {i > 0 && (
              <div className="flex items-center gap-2">
                <span className="num text-xxs font-bold text-white/70">{group.op}</span>
                <span className="h-px flex-1 bg-white/25" />
              </div>
            )}
            {isGroup(child) ? (
              <ConditionTree group={child} onChange={(g) => onChange(patchGroup(group, child.id, g))} depth={depth + 1} />
            ) : (
              <ConditionBlock
                condition={child}
                onChange={(c) => onChange(patchNode(group, child.id, () => c))}
                onDelete={() => onChange(removeNode(group, child.id))}
              />
            )}
          </Fragment>
        ))}

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <select
            className="w-auto min-w-[168px] rounded-sm border-0 bg-black/25 py-1 pl-2 text-xxs font-bold text-white"
            value=""
            onChange={(e) => {
              const kind = e.target.value as ConditionKind;
              if (kind) onChange(addChild(group, group.id, defaultsFor(kind)));
              e.target.value = '';
            }}
            title="Add a condition block to this group"
            aria-label={`Add a condition to ${isRoot ? 'purchase conditions' : 'this group'}`}
          >
            <option value="" className="text-[#333]">
              + add block…
            </option>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value} className="text-[#333]">
                {k.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() =>
              onChange(
                addChild(group, group.id, {
                  id: nid('g'),
                  op: group.op === 'AND' ? 'OR' : 'AND',
                  children: [defaultsFor('even')],
                }),
              )
            }
            className="inline-flex items-center gap-1 rounded-sm bg-black/25 px-2 py-1 text-xxs font-bold text-white hover:bg-black/40"
            title="Add a nested AND/OR group"
          >
            <Plus size={11} /> group
          </button>
        </div>
      </div>
    </div>
  );
}

function ConditionBlock({
  condition,
  onChange,
  onDelete,
}: {
  condition: Condition;
  onChange: (c: Condition) => void;
  onDelete: () => void;
}) {
  const meta = KINDS.find((k) => k.value === condition.kind);
  const colour = CATEGORY_META[meta?.category ?? 'digits'].colour;
  const needsBarrier = ['over', 'under', 'match', 'differ'].includes(condition.kind);
  const needsN = ['lastNContains', 'rollingFrequency', 'consecutiveParity', 'consecutiveOver', 'consecutiveUnder'].includes(condition.kind);
  const needsDigit = ['lastNContains', 'rollingFrequency'].includes(condition.kind);
  const parityDigit = condition.kind === 'consecutiveParity';

  return (
    <div className="rounded-sm" style={{ background: colour }}>
      <div className="flex flex-wrap items-center gap-2 px-2.5 py-1.5">
        <span className="shrink-0 text-xs font-bold text-white">{meta?.label ?? condition.kind}</span>

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

        <button
          type="button"
          onClick={onDelete}
          className="ml-auto shrink-0 rounded p-1 text-white/80 transition-colors hover:bg-black/25 hover:text-white"
          title="Delete block"
          aria-label={`Delete ${meta?.label ?? condition.kind} block`}
        >
          <X size={12} />
        </button>
      </div>
      <div className="border-t border-black/15 px-2.5 py-1 text-xxs text-white/90">{describeCondition(condition)}</div>
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
      <span className="text-xxs tracking-wide text-white/80 uppercase">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="num w-[58px] rounded-sm border-0 bg-black/25 py-0.5 text-xs font-bold text-white focus:bg-black/40"
      />
    </label>
  );
}
