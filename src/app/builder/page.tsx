'use client';

import { useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, Download, Redo2, RotateCcw, Save, Upload, Zap } from 'lucide-react';
import { Badge, Banner, Button } from '@/components/ui';
import { CATEGORY_META, ConditionTree, KINDS, addChild, defaultsFor, emptyGroup } from '@/components/ConditionTree';
import { useApp } from '@/state/store';
import { createStrategy, newStrategyId, validateStrategy, type Strategy } from '@/lib/engine/strategies';
import { evaluateGroup, type ConditionGroup, type ConditionKind } from '@/lib/engine/conditions';
import type { ContractType } from '@/lib/deriv/contracts';
import { PROGRESSIONS, PROGRESSION_ORDER, worstCaseStake } from '@/lib/engine/progressions';

const TRADE_TYPES: { value: ContractType; label: string; barrier: 'none' | 'required' }[] = [
  { value: 'CALL', label: 'Rise', barrier: 'none' },
  { value: 'PUT', label: 'Fall', barrier: 'none' },
  { value: 'DIGITODD', label: 'Odd', barrier: 'none' },
  { value: 'DIGITEVEN', label: 'Even', barrier: 'none' },
  { value: 'DIGITOVER', label: 'Over', barrier: 'required' },
  { value: 'DIGITUNDER', label: 'Under', barrier: 'required' },
  { value: 'DIGITMATCH', label: 'Matches', barrier: 'required' },
  { value: 'DIGITDIFF', label: 'Differs', barrier: 'required' },
];

const DURATIONS = [
  { value: 't', label: 'ticks' },
  { value: 's', label: 'seconds' },
  { value: 'm', label: 'minutes' },
  { value: 'h', label: 'hours' },
  { value: 'd', label: 'days' },
] as const;

const BLOCK_COLOUR = {
  root: 'var(--color-block-root)',
  purchase: 'var(--color-block-purchase)',
  sell: 'var(--color-block-sell)',
  restart: 'var(--color-block-restart)',
} as const;

/**
 * Bot Builder.
 *
 * Laid out the way Deriv Bot lays it out: a toolbar across the top, a block
 * toolbox on the left, and the strategy itself in the centre as four stacked
 * root blocks — Trade parameters, Purchase conditions, Sell conditions and
 * Restart trading conditions. Those four sections are Deriv Bot's own root
 * blocks, so a trader who has used DBot reads this immediately.
 *
 * The condition tree stays plain JSON underneath, which keeps it serialisable,
 * versionable and identical to the object the engine evaluates.
 */
export default function BuilderPage() {
  const s = useApp();
  const [draft, setDraft] = useState<Strategy | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Undo/redo over the whole draft. Deriv Bot's toolbar offers both, and a
  // builder that can destroy an unsaved condition tree with one misclick is not
  // a builder anyone will trust. Declared above the render-time sync below,
  // which clears both when the selection changes.
  const [past, setPast] = useState<Strategy[]>([]);
  const [future, setFuture] = useState<Strategy[]>([]);

  const selected = s.strategies.find((x) => x.id === s.activeStrategyId) ?? s.strategies[0] ?? null;
  const selectedId = selected?.id ?? null;

  // Load the selected strategy into the editor when the selection changes.
  //
  // This uses React's documented "adjust state during render" pattern instead of an effect. The
  // editor contents are derived from WHICH strategy is selected, so an effect would first commit a
  // render showing the previous strategy and then correct it in a second render. Comparing against
  // the id we last loaded from is what keeps this from looping.
  //
  // It deliberately does not consult `dirty`: editing the draft never resets it, because the id has
  // not changed. Only switching strategies (or losing the selection) reloads.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (selectedId !== loadedId) {
    setLoadedId(selectedId);
    setDraft(selected ? structuredClone(selected) : null);
    setDirty(false);
    setPast([]);
    setFuture([]);
  }

  // First run: nothing saved yet, so offer a starter rather than an empty screen.
  const [starterOffered, setStarterOffered] = useState(false);
  if (s.hydrated && !starterOffered && s.strategies.length === 0 && !draft) {
    setStarterOffered(true);
    setDraft(createStrategy({ name: 'My first strategy' }));
    setDirty(true);
  }

  const validation = useMemo(() => (draft ? validateStrategy(draft) : null), [draft]);

  // Live gate evaluation against the actual digit buffer — proves the condition language works
  // on real data before a single order is placed.
  const gateEval = useMemo(() => {
    if (!draft) return null;
    return evaluateGroup(draft.entry, {
      digits: s.digits,
      prices: s.quotes.map((q) => q.price),
      symbol: s.activeSymbol,
      pipSize: s.pipSize,
    });
  }, [draft, s.digits, s.activeSymbol, s.pipSize, s.quotes]);

  const patch = (p: Partial<Strategy>) => {
    if (!draft) return;
    setPast((h) => [...h.slice(-49), draft]);
    setFuture([]);
    setDraft({ ...draft, ...p });
    setDirty(true);
    setMsg(null);
  };

  const undo = () => {
    if (!draft || past.length === 0) return;
    const prev = past[past.length - 1];
    setPast((h) => h.slice(0, -1));
    setFuture((f) => [draft, ...f].slice(0, 50));
    setDraft(prev);
    setDirty(true);
  };

  const redo = () => {
    if (!draft || future.length === 0) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((h) => [...h, draft]);
    setDraft(next);
    setDirty(true);
  };

  async function save() {
    if (!draft) return;
    const r = await s.saveStrategy(draft);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) {
      setDirty(false);
      s.setActiveStrategy(draft.id);
    }
  }

  async function saveAsNew() {
    if (!draft) return;
    const copy: Strategy = {
      ...structuredClone(draft),
      id: newStrategyId(),
      name: `${draft.name} (copy)`,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const r = await s.saveStrategy(copy);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) {
      setDraft(copy);
      setDirty(false);
      s.setActiveStrategy(copy.id);
    }
  }

  function exportJson() {
    if (!draft) return;
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${draft.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'strategy'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<Strategy>;
      const imported = createStrategy({ ...parsed, id: newStrategyId(), version: 1, updatedAt: Date.now() });
      const v = validateStrategy(imported);
      setDraft(imported);
      setDirty(true);
      setMsg(
        v.valid
          ? { ok: true, text: `Imported "${imported.name}". Check the blocks, then save.` }
          : { ok: false, text: `Imported with problems: ${v.errors.join(' · ')}` },
      );
    } catch (e) {
      setMsg({ ok: false, text: `Could not read that file: ${(e as Error).message}` });
    }
  }

  const contractMeta = TRADE_TYPES.find((c) => c.value === draft?.contractType);
  const progression = draft?.progression ?? { kind: 'flat' as const, unit: draft?.stake ?? 0.35, multiplier: 2 };
  const progInfo = PROGRESSIONS[progression.kind];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ------------------------------------------------------- toolbar */}
      <Toolbar
        draft={draft}
        dirty={dirty}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        strategies={s.strategies}
        activeId={s.activeStrategyId}
        onPick={(id) => {
          const st = s.strategies.find((x) => x.id === id);
          if (!st) return;
          if (dirty && !window.confirm('Discard unsaved changes to the current strategy?')) return;
          s.setActiveStrategy(id);
          setDraft(structuredClone(st));
          setDirty(false);
          setPast([]);
          setFuture([]);
          setMsg(null);
        }}
        onNew={() => {
          if (dirty && !window.confirm('Discard unsaved changes?')) return;
          const fresh = createStrategy({ id: newStrategyId(), name: 'New strategy', entry: emptyGroup() });
          setDraft(fresh);
          setDirty(true);
          setPast([]);
          setFuture([]);
        }}
        onUndo={undo}
        onRedo={redo}
        onExport={exportJson}
        onImport={() => fileRef.current?.click()}
        onSaveAsNew={() => void saveAsNew()}
        onSave={() => void save()}
        onQuick={s.openQuickStrategy}
      />
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importJson(f);
          e.target.value = '';
        }}
      />

      {msg && (
        <div className="px-3 pt-3">
          <Banner tone={msg.ok ? 'success' : 'danger'}>{msg.text}</Banner>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ------------------------------------------------------ toolbox */}
        <Toolbox
          onAdd={(kind) => {
            if (!draft) return;
            patch({ entry: addChild(draft.entry, draft.entry.id, defaultsFor(kind)) });
          }}
          onAddGroup={() => {
            if (!draft) return;
            const g: ConditionGroup = {
              id: `g${Date.now().toString(36)}`,
              op: draft.entry.op === 'AND' ? 'OR' : 'AND',
              children: [defaultsFor('even')],
            };
            patch({ entry: addChild(draft.entry, draft.entry.id, g) });
          }}
        />

        {/* ---------------------------------------------------- workspace */}
        <div className="dt-workspace">
          {!draft ? (
            <div className="mx-auto max-w-md rounded border border-dashed border-line bg-main-1 p-6 text-center">
              <p className="text-sm font-bold text-prominent">No strategy open</p>
              <p className="mt-1 text-xs text-less-prominent">
                Pick a bot from the toolbar, create a new one, or launch a preset with Quick strategy.
              </p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-[820px] flex-col gap-2.5">
              {validation && !validation.valid && (
                <Banner tone="danger">
                  <strong>Cannot save or run:</strong>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {validation.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </Banner>
              )}
              {validation && validation.valid && validation.warnings.length > 0 && (
                <Banner tone="warn">
                  <strong>Warnings (saving is still allowed):</strong>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {validation.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </Banner>
              )}

              {/* ---- 1. Trade parameters ---- */}
              <RootBlock colour={BLOCK_COLOUR.root} title="Trade parameters" subtitle="What to buy, on which market, for how long and how much">
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  <In label="Strategy name" className="col-span-2 sm:col-span-3">
                    <input type="text" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Descriptive name" />
                  </In>
                  <In label="Market">
                    {s.symbols.length > 0 ? (
                      <select value={draft.market} onChange={(e) => patch({ market: e.target.value })}>
                        {Array.from(new Set([draft.market, ...s.symbols.map((x) => x.underlying_symbol)])).map((m) => (
                          <option key={m} value={m}>
                            {s.symbols.find((x) => x.underlying_symbol === m)?.underlying_symbol_name ?? m} ({m})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={draft.market}
                        onChange={(e) => patch({ market: e.target.value })}
                        title="The market list loads from Deriv once the connection is open"
                      />
                    )}
                  </In>
                  <In label="Trade type">
                    <select value={draft.contractType} onChange={(e) => patch({ contractType: e.target.value as ContractType })}>
                      {TRADE_TYPES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </In>
                  {contractMeta?.barrier === 'required' && (
                    <In label="Barrier (digit)" hint="Strict inequality — the barrier digit loses both ways.">
                      <input
                        type="number"
                        min={0}
                        max={9}
                        value={draft.barrier ?? 5}
                        onChange={(e) => patch({ barrier: Math.min(9, Math.max(0, Number(e.target.value) || 0)) })}
                      />
                    </In>
                  )}
                  {contractMeta && (contractMeta.value === 'CALL' || contractMeta.value === 'PUT') && (
                    <p className="text-xs leading-relaxed text-faint">
                      Rise / Fall is a direction contract — no fair-draw probability applies. Deriv quotes the payout at
                      purchase, and whether that quote is worth taking depends on your entry conditions. The Signals tab
                      computes expected value from live quotes.
                    </p>
                  )}
                  <In label="Duration">
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        min={1}
                        className="min-w-0 flex-1"
                        value={draft.duration}
                        onChange={(e) => patch({ duration: Math.max(1, Number(e.target.value) || 1) })}
                      />
                      <select
                        className="w-[92px] shrink-0"
                        value={draft.durationUnit}
                        onChange={(e) => patch({ durationUnit: e.target.value as Strategy['durationUnit'] })}
                      >
                        {DURATIONS.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </In>
                  <In label={`Stake (${draft.currency})`} hint="One unit for the progression below.">
                    <input
                      type="number"
                      min={0.35}
                      step={0.05}
                      value={draft.stake}
                      onChange={(e) => patch({ stake: Number(e.target.value) || 0, progression: draft.progression ? { ...draft.progression, unit: Number(e.target.value) || 0 } : undefined })}
                    />
                  </In>
                  <In label="Stake progression" className="col-span-2">
                    <div className="flex gap-1.5">
                      <select
                        value={progression.kind}
                        onChange={(e) => patch({ progression: { kind: e.target.value as typeof progression.kind, unit: draft.stake, multiplier: progression.multiplier ?? 2 } })}
                      >
                        {PROGRESSION_ORDER.map((k) => (
                          <option key={k} value={k}>
                            {PROGRESSIONS[k].name}
                          </option>
                        ))}
                      </select>
                      {(progression.kind === 'martingale' || progression.kind === 'reverse_martingale') && (
                        <input
                          type="number"
                          className="w-[76px] shrink-0"
                          min={1.01}
                          step={0.1}
                          value={progression.multiplier ?? 2}
                          onChange={(e) => patch({ progression: { ...progression, multiplier: Math.max(1.01, Number(e.target.value) || 2) } })}
                          title="Multiplier"
                        />
                      )}
                    </div>
                  </In>
                </div>
                <p className="mt-2 text-xxs leading-snug text-white/85">
                  {progInfo.rule} After 10 consecutive losses the stake would reach{' '}
                  <strong className="num">{worstCaseStake(progression, 10).toFixed(2)}</strong>, capped by your risk limit of{' '}
                  <strong className="num">{draft.limits.maxStake.toFixed(2)}</strong>.
                </p>
              </RootBlock>

              {/* ---- 2. Purchase conditions ---- */}
              <div className="mb-1 flex items-center gap-2">
                <span className="dt-section-title">Purchase conditions</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <ConditionTree group={draft.entry} onChange={(entry) => patch({ entry })} />

              {gateEval && (
                <div className="dt-card p-3">
                  <div className="flex items-center gap-2">
                    <Badge tone={gateEval.satisfied ? 'profit' : 'neutral'}>{gateEval.satisfied ? 'Gate OPEN now' : 'Gate closed now'}</Badge>
                    <span className="text-xxs text-less-prominent">
                      Evaluated live against {s.digits.length} digits on {s.activeSymbol}
                    </span>
                  </div>
                  {gateEval.reasons.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {gateEval.reasons.map((r, i) => (
                        <li key={i} className="text-xxs leading-snug text-general">
                          · {r}
                        </li>
                      ))}
                    </ul>
                  )}
                  {gateEval.insufficientData && (
                    <p className="mt-2 text-xxs text-orange">
                      Needs {gateEval.requiredDigits} digits, {s.digits.length} available. The bot waits rather than guessing.
                    </p>
                  )}
                </div>
              )}

              {/* ---- 3. Sell conditions ---- */}
              <RootBlock colour={BLOCK_COLOUR.sell} title="Sell conditions" subtitle="When the session stops, not when an individual contract is sold">
                <p className="mb-2 text-xxs leading-snug text-white/85">
                  Every contract is held to settlement — this engine does not sell a contract early, and pretending
                  otherwise would misreport your results. Take profit and stop loss below are session-level limits
                  enforced by the risk manager across all contracts.
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  <In label="Take profit (session)">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={draft.limits.maxSessionProfit}
                      onChange={(e) => patch({ limits: { ...draft.limits, maxSessionProfit: Math.max(0, Number(e.target.value) || 0) } })}
                    />
                  </In>
                  <In label="Stop loss (session)">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={draft.limits.maxSessionLoss}
                      onChange={(e) => patch({ limits: { ...draft.limits, maxSessionLoss: Math.max(0, Number(e.target.value) || 0) } })}
                    />
                  </In>
                </div>
              </RootBlock>

              {/* ---- 4. Restart trading conditions ---- */}
              <RootBlock colour={BLOCK_COLOUR.restart} title="Restart trading conditions" subtitle="Pacing and how far the bot is allowed to go">
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <In label="Cooldown (s)">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={draft.cooldownSeconds}
                      onChange={(e) => patch({ cooldownSeconds: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </In>
                  <In label="Max trades">
                    <input
                      type="number"
                      min={1}
                      value={draft.maxTrades}
                      onChange={(e) => patch({ maxTrades: Math.max(1, Number(e.target.value) || 1), limits: { ...draft.limits, maxTrades: Math.max(1, Number(e.target.value) || 1) } })}
                    />
                  </In>
                  <In label="Max exposure">
                    <input
                      type="number"
                      min={0}
                      value={draft.maxExposure}
                      onChange={(e) => patch({ maxExposure: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </In>
                  <In label="Max stake cap">
                    <input
                      type="number"
                      min={0.35}
                      step={0.5}
                      value={draft.limits.maxStake}
                      onChange={(e) => patch({ limits: { ...draft.limits, maxStake: Math.max(0.35, Number(e.target.value) || 0.35) } })}
                    />
                  </In>
                </div>
                <p className="mt-2 text-xxs leading-snug text-white/85">
                  On a provider error or a lost connection the bot halts rather than continuing. A halted bot never
                  resumes by itself.
                </p>
              </RootBlock>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- toolbar */

function Toolbar(props: {
  draft: Strategy | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  strategies: Strategy[];
  activeId: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  onImport: () => void;
  onSaveAsNew: () => void;
  onSave: () => void;
  onQuick: () => void;
}) {
  const { draft, dirty, canUndo, canRedo, strategies, activeId } = props;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-main-1 px-3 py-2">
      <select
        className="w-[210px]"
        value={activeId ?? ''}
        onChange={(e) => props.onPick(e.target.value)}
        aria-label="Open a saved strategy"
        title="Open a saved strategy"
      >
        <option value="">{strategies.length === 0 ? 'No saved strategies' : 'Open a bot…'}</option>
        {strategies.map((st) => (
          <option key={st.id} value={st.id}>
            {st.name} (v{st.version})
          </option>
        ))}
      </select>

      <ToolButton label="Quick strategy" onClick={props.onQuick} icon={<Zap size={13} />} />
      <ToolButton label="New" onClick={props.onNew} icon={<Copy size={13} />} />
      <span className="mx-1 h-5 w-px bg-line" />
      <ToolButton label="Undo" onClick={props.onUndo} disabled={!canUndo} icon={<RotateCcw size={13} />} />
      <ToolButton label="Redo" onClick={props.onRedo} disabled={!canRedo} icon={<Redo2 size={13} />} />
      <span className="mx-1 h-5 w-px bg-line" />
      <ToolButton label="Import" onClick={props.onImport} icon={<Upload size={13} />} />
      <ToolButton label="Export" onClick={props.onExport} disabled={!draft} icon={<Download size={13} />} />
      <ToolButton label="Save as new" onClick={props.onSaveAsNew} disabled={!draft} icon={<Copy size={13} />} />

      <span className="ml-auto flex items-center gap-2">
        {dirty && <Badge tone="warn">Unsaved</Badge>}
        {draft && <span className="num text-xxs text-less-prominent">v{draft.version + (dirty ? 1 : 0)}</span>}
        <Button
          variant="primary"
          size="sm"
          disabled={!draft || !dirty || (draft ? !validateStrategy(draft).valid : true)}
          onClick={props.onSave}
          title="Save this strategy as a new version"
        >
          <Save size={13} /> Save
        </Button>
      </span>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  icon,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="inline-flex items-center gap-1.5 rounded border border-transparent px-2 py-1.5 text-xs text-general transition-colors hover:border-line hover:bg-state-hover hover:text-prominent disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-transparent disabled:hover:bg-transparent"
    >
      {icon}
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------- toolbox */

function Toolbox({ onAdd, onAddGroup }: { onAdd: (kind: ConditionKind) => void; onAddGroup: () => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ digits: true, history: true, flow: true, logic: true, indicators: true });
  const cats = Object.keys(CATEGORY_META) as (keyof typeof CATEGORY_META)[];

  return (
    <nav className="dt-toolbox" aria-label="Block toolbox">
      <div className="border-b border-line px-3 py-2">
        <span className="dt-section-title">Toolbox</span>
        <p className="mt-0.5 text-xxs leading-snug text-less-prominent">Click a block to add it to the purchase conditions.</p>
      </div>

      {cats.map((cat) => (
        <ToolboxCategory
          key={cat}
          label={CATEGORY_META[cat].label}
          colour={CATEGORY_META[cat].colour}
          open={Boolean(open[cat])}
          onToggle={() => setOpen((o) => ({ ...o, [cat]: !o[cat] }))}
        >
          {KINDS.filter((k) => k.category === cat).map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => onAdd(k.value)}
              title={k.hint}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-opacity hover:opacity-80"
              style={{ background: CATEGORY_META[cat].colour, color: '#fff' }}
            >
              <span className="text-xxs font-bold">{k.label}</span>
            </button>
          ))}
        </ToolboxCategory>
      ))}

      <ToolboxCategory
        label="Logic"
        colour={GROUP_COLOUR_TOOLBOX}
        open={Boolean(open.logic)}
        onToggle={() => setOpen((o) => ({ ...o, logic: !o.logic }))}
      >
        <button
          type="button"
          onClick={onAddGroup}
          title="Add a nested AND/OR group so conditions can be combined"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xxs font-bold text-white transition-opacity hover:opacity-80"
          style={{ background: GROUP_COLOUR_TOOLBOX }}
        >
          AND / OR group
        </button>
      </ToolboxCategory>
    </nav>
  );
}

const GROUP_COLOUR_TOOLBOX = 'var(--color-block-var)';

function ToolboxCategory({
  label,
  colour,
  open,
  onToggle,
  children,
}: {
  label: string;
  colour: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-line">
      <button type="button" className="dt-toolbox__cat" onClick={onToggle} aria-expanded={open}>
        <span className="dt-toolbox__swatch" style={{ background: colour }} />
        {label}
        {open ? <ChevronDown size={13} className="ml-auto text-less-prominent" /> : <ChevronRight size={13} className="ml-auto text-less-prominent" />}
      </button>
      {open && <div className="flex flex-col gap-1 p-2">{children}</div>}
    </div>
  );
}

/* --------------------------------------------------------- block pieces */

function RootBlock({
  colour,
  title,
  subtitle,
  children,
}: {
  colour: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="dt-block dt-block--notch" style={{ background: colour }}>
      <div className="dt-block__head">
        <Check size={13} className="opacity-80" />
        <span className="text-xs">{title}</span>
        {subtitle && <span className="text-xxs font-normal opacity-75">· {subtitle}</span>}
      </div>
      <div className="dt-block__body">{children}</div>
    </div>
  );
}

/** A field inside a coloured block: white-on-colour label, inset control. */
function In({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-1 block text-xxs font-bold tracking-wide text-white/85 uppercase">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xxs leading-snug text-white/70">{hint}</span>}
    </label>
  );
}
