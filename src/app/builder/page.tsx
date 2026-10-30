'use client';

import { useMemo, useState } from 'react';
import { Copy, Pause, Play, Plus, Save, Square, Trash2, Zap } from 'lucide-react';
import { Badge, Banner, Button, Card, Empty, Field } from '@/components/ui';
import { ConditionTree } from '@/components/ConditionTree';
import { DigitStrip, TickChart } from '@/components/charts';
import { useApp } from '@/state/store';
import { createStrategy, newStrategyId, validateStrategy, type Strategy } from '@/lib/engine/strategies';
import { evaluateGroup, type ConditionGroup } from '@/lib/engine/conditions';
import type { ContractType } from '@/lib/deriv/contracts';
import { ago, MODE_LABEL, money, signed } from '@/lib/format';

const DIGIT_CONTRACTS: { value: ContractType; label: string; barrier: 'none' | 'required' | 'optional' }[] = [
  { value: 'DIGITODD', label: 'Digit Odd', barrier: 'none' },
  { value: 'DIGITEVEN', label: 'Digit Even', barrier: 'none' },
  { value: 'DIGITOVER', label: 'Digit Over', barrier: 'required' },
  { value: 'DIGITUNDER', label: 'Digit Under', barrier: 'required' },
  { value: 'DIGITMATCH', label: 'Digit Matches', barrier: 'required' },
  { value: 'DIGITDIFF', label: 'Digit Differs', barrier: 'required' },
];

const DURATIONS = [
  { value: 't', label: 'ticks' },
  { value: 's', label: 'seconds' },
  { value: 'm', label: 'minutes' },
  { value: 'h', label: 'hours' },
  { value: 'd', label: 'days' },
] as const;

export default function BuilderPage() {
  const s = useApp();
  const [draft, setDraft] = useState<Strategy | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
  }

  // First run: nothing saved yet, so offer a starter rather than an empty screen. Also derived
  // during render so the empty state never flashes. Once per mount is enough — the "New strategy"
  // button covers the case where the user later deletes everything.
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
    return evaluateGroup(draft.entry, { digits: s.digits, symbol: s.activeSymbol, pipSize: s.pipSize });
  }, [draft, s.digits, s.activeSymbol, s.pipSize]);

  const patch = (p: Partial<Strategy>) => {
    if (!draft) return;
    setDraft({ ...draft, ...p });
    setDirty(true);
    setMsg(null);
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
    const copy: Strategy = { ...structuredClone(draft), id: newStrategyId(), name: `${draft.name} (copy)`, version: 1, createdAt: Date.now(), updatedAt: Date.now() };
    const r = await s.saveStrategy(copy);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) {
      setDraft(copy);
      setDirty(false);
      s.setActiveStrategy(copy.id);
    }
  }

  const contractMeta = DIGIT_CONTRACTS.find((c) => c.value === draft?.contractType);

  return (
    <div className="mx-auto max-w-[1600px] space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">Bot Builder · Elite Prime</h2>
          <p className="text-[11px] text-ink-3">
            Compose a versioned strategy from an AND/OR condition tree. Nothing executes until you press Run, and nothing executes at all in
            a mode you have not enabled in <span className="text-ink-2">Risk</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <Badge tone="warn">UNSAVED</Badge>}
          <Button variant="outline" size="sm" onClick={() => patch({ ...createStrategy({ id: draft?.id, name: 'New strategy' }), id: draft?.id ?? newStrategyId() } as Partial<Strategy>)}>
            <Plus className="h-3 w-3" /> Reset fields
          </Button>
          <Button variant="outline" size="sm" disabled={!draft} onClick={() => void saveAsNew()}>
            <Copy className="h-3 w-3" /> Save as new
          </Button>
          <Button variant="primary" size="sm" disabled={!draft || !dirty || (validation ? !validation.valid : true)} onClick={() => void save()}>
            <Save className="h-3 w-3" /> Save {draft ? `v${draft.version + 1}` : ''}
          </Button>
        </div>
      </div>

      {msg && <Banner tone={msg.ok ? 'success' : 'danger'}>{msg.text}</Banner>}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[260px_minmax(0,1fr)]">
        {/* ------------------------------------------------ saved strategies */}
        <Card title="Strategies" subtitle="Stored in IndexedDB in this browser." pad={false}>
          {s.strategies.length === 0 ? (
            <Empty title="No saved strategies">Create one to get started.</Empty>
          ) : (
            <ul className="max-h-[640px] overflow-auto p-1.5">
              {s.strategies.map((st) => {
                const active = st.id === s.activeStrategyId;
                const stTrades = s.trades.filter((t) => t.strategyId === st.id);
                const stNet = stTrades.reduce((a, t) => a + t.profit, 0);
                return (
                  <li key={st.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (dirty && !window.confirm('Discard unsaved changes to the current strategy?')) return;
                        s.setActiveStrategy(st.id);
                        setDraft(structuredClone(st));
                        setDirty(false);
                        setMsg(null);
                      }}
                      className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                        active ? 'border-brand/40 bg-brand/8' : 'border-transparent hover:border-line hover:bg-hover'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`truncate text-[11.5px] font-medium ${active ? 'text-brand' : 'text-ink'}`}>{st.name}</span>
                        <span className="num shrink-0 text-[9.5px] text-ink-4">v{st.version}</span>
                      </div>
                      <div className="num mt-0.5 flex items-center gap-1.5 text-[9.5px] text-ink-4">
                        <span>{st.market}</span>
                        <span>·</span>
                        <span>{st.contractType}</span>
                        <span>·</span>
                        <span>{st.stake}</span>
                      </div>
                      {stTrades.length > 0 && (
                        <div className="num mt-0.5 text-[9.5px]">
                          <span className={stNet >= 0 ? 'text-profit' : 'text-loss'}>{signed(stNet)}</span>
                          <span className="text-ink-4"> over {stTrades.length} trades</span>
                        </div>
                      )}
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-[9px] text-ink-4">{ago(st.updatedAt)}</span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!window.confirm(`Delete "${st.name}"? This cannot be undone.`)) return;
                            void s.deleteStrategy(st.id);
                          }}
                          onKeyDown={(e) => e.key === 'Enter' && void s.deleteStrategy(st.id)}
                          className="rounded p-0.5 text-ink-4 hover:bg-loss/12 hover:text-loss"
                          title="Delete strategy"
                        >
                          <Trash2 className="h-3 w-3" />
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* ------------------------------------------------------- the editor */}
        {!draft ? (
          <Card title="Editor">
            <Empty title="Select or create a strategy" />
          </Card>
        ) : (
          <div className="min-w-0 space-y-3">
            {validation && !validation.valid && (
              <Banner tone="danger">
                <strong className="font-semibold">Cannot save or run:</strong>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {validation.errors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              </Banner>
            )}
            {validation && validation.valid && validation.warnings.length > 0 && (
              <Banner tone="warn">
                <strong className="font-semibold">Warnings (saving is still allowed):</strong>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {validation.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              </Banner>
            )}

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Card title="Instrument & contract" subtitle="Market, contract type, barrier, duration and stake.">
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Strategy name" className="col-span-2">
                    <input type="text" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Descriptive name" />
                  </Field>

                  <Field
                    label="Market"
                    hint={s.symbols.length ? `${s.symbols.length} markets discovered from Deriv` : 'Common synthetic indices; connect for the full list'}
                  >
                    <select value={draft.market} onChange={(e) => patch({ market: e.target.value })}>
                      {[...new Set([draft.market, s.activeSymbol, ...s.symbols.map((x) => x.underlying_symbol)])].map((m) => {
                        const sym = s.symbols.find((x) => x.underlying_symbol === m);
                        return (
                          <option key={m} value={m}>
                            {sym ? `${sym.underlying_symbol_name} (${m})` : m}
                          </option>
                        );
                      })}
                    </select>
                  </Field>

                  <Field label="Contract type">
                    <select
                      value={draft.contractType}
                      onChange={(e) => {
                        const v = e.target.value as ContractType;
                        const meta = DIGIT_CONTRACTS.find((c) => c.value === v);
                        patch({ contractType: v, barrier: meta?.barrier === 'none' ? undefined : (draft.barrier ?? 5) });
                      }}
                    >
                      {DIGIT_CONTRACTS.map((c) => (
                        <option key={c.value} value={c.value}>{c.label} — {c.value}</option>
                      ))}
                    </select>
                  </Field>

                  {contractMeta?.barrier !== 'none' && (
                    <Field label="Barrier digit" hint="Deriv uses STRICT inequality for over/under: digit 5 with barrier 5 loses both ways.">
                      <input type="number" min={0} max={9} step={1} value={draft.barrier ?? 5} onChange={(e) => patch({ barrier: Number(e.target.value) })} className="num" />
                    </Field>
                  )}

                  <Field label="Stake" hint={`Clamped to ${money(s.settings.limits.minStake, '')}–${money(s.settings.limits.maxStake, '')} by the risk manager`}>
                    <input type="number" min={0.35} step={0.05} value={draft.stake} onChange={(e) => patch({ stake: Number(e.target.value) })} className="num" />
                  </Field>

                  <Field label="Duration">
                    <div className="flex gap-1.5">
                      <input type="number" min={1} step={1} value={draft.duration} onChange={(e) => patch({ duration: Number(e.target.value) })} className="num" />
                      <select
                        value={draft.durationUnit}
                        onChange={(e) => patch({ durationUnit: e.target.value as Strategy['durationUnit'] })}
                        className="w-[92px]"
                      >
                        {DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                      </select>
                    </div>
                  </Field>

                  <Field label="Currency">
                    <input type="text" value={draft.currency} onChange={(e) => patch({ currency: e.target.value.toUpperCase() })} className="num" />
                  </Field>

                  <Field label="Cooldown between trades (s)" hint="Minimum pause after a settlement before the gate is re-evaluated.">
                    <input type="number" min={0} step={1} value={draft.cooldownSeconds} onChange={(e) => patch({ cooldownSeconds: Number(e.target.value) })} className="num" />
                  </Field>

                  <Field label="Max trades (this strategy)">
                    <input type="number" min={1} step={10} value={draft.maxTrades} onChange={(e) => patch({ maxTrades: Number(e.target.value) })} className="num" />
                  </Field>

                  <Field label="Max exposure" hint="Strategy-level cap; the global risk limit also applies and whichever is lower wins.">
                    <input type="number" min={0} step={10} value={draft.maxExposure} onChange={(e) => patch({ maxExposure: Number(e.target.value) })} className="num" />
                  </Field>

                  <Field label="Notes" className="col-span-2">
                    <textarea rows={2} value={draft.notes ?? ''} onChange={(e) => patch({ notes: e.target.value })} placeholder="Why does this strategy exist? What would falsify it?" />
                  </Field>
                </div>
              </Card>

              {/* ------------------------------------------- live gate + market */}
              <div className="space-y-3">
                <Card
                  title="Live gate check"
                  subtitle="The condition tree evaluated against the digits actually buffered right now."
                  right={
                    gateEval && (
                      <Badge tone={gateEval.insufficientData ? 'warn' : gateEval.satisfied ? 'profit' : 'neutral'}>
                        {gateEval.insufficientData ? 'NEEDS DATA' : gateEval.satisfied ? 'GATE OPEN' : 'GATE CLOSED'}
                      </Badge>
                    )
                  }
                >
                  {gateEval && (
                    <div className="space-y-2">
                      <ul className="space-y-1">
                        {gateEval.reasons.slice(0, 8).map((r, i) => (
                          <li key={i} className="num flex items-start gap-1.5 text-[11px] leading-snug text-ink-2">
                            <span className={r.startsWith('PASS') || r.includes('satisfied') ? 'text-profit' : r.startsWith('FAIL') ? 'text-loss' : 'text-ink-4'}>·</span>
                            {r}
                          </li>
                        ))}
                      </ul>
                      {gateEval.insufficientData && (
                        <Banner tone="warn">
                          The gate needs {gateEval.requiredDigits} digits but only {s.digits.length} are buffered. Waiting for more ticks
                          rather than guessing — an under-sampled gate reports “needs data”, never a false positive.
                        </Banner>
                      )}
                      <div className="border-t border-line pt-2">
                        <DigitStrip digits={s.digits} count={24} />
                      </div>
                    </div>
                  )}
                </Card>

                <Card title={`${s.activeSymbol} live`} subtitle="Buffered ticks for the currently selected market." pad={false}>
                  <div className="h-[150px] p-2">
                    <TickChart quotes={s.quotes} points={120} />
                  </div>
                </Card>
              </div>
            </div>

            {/* --------------------------------------------- condition tree */}
            <Card
              title="Entry conditions"
              subtitle="The gate that must open before a contract is bought. Nest AND/OR groups to any depth."
              right={
                <span className="num text-[10px] text-ink-4">
                  {draft.id} · v{draft.version}
                </span>
              }
            >
              <ConditionTree group={draft.entry as ConditionGroup} onChange={(g) => patch({ entry: g })} />
            </Card>

            {/* ------------------------------------------------ run controls */}
            <Card title="Execution" subtitle={`Mode: ${MODE_LABEL[s.settings.mode]} · data source: ${s.dataSource}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="success"
                  size="lg"
                  disabled={s.botState === 'running' || s.botState === 'starting' || s.botState === 'paused' || !validation?.valid || !dirty}
                  onClick={async () => {
                    if (!draft) return;
                    if (dirty) {
                      const r = await s.saveStrategy(draft);
                      if (!r.ok) {
                        setMsg({ ok: false, text: r.message });
                        return;
                      }
                      setDirty(false);
                    }
                    const res = await s.runStrategy(draft.id);
                    setMsg({ ok: res.ok, text: res.message });
                  }}
                  title={dirty ? 'Save before running — a running bot must execute a saved, versioned strategy' : undefined}
                >
                  <Play className="h-4 w-4" /> Run strategy
                </Button>
                <Button variant="outline" size="lg" disabled={s.botState !== 'running'} onClick={() => s.pauseBot()}>
                  <Pause className="h-4 w-4" /> Pause
                </Button>
                <Button variant="outline" size="lg" disabled={s.botState !== 'paused'} onClick={() => s.resumeBot()}>
                  <Zap className="h-4 w-4" /> Resume
                </Button>
                <Button variant="danger" size="lg" disabled={s.botState === 'idle' || s.botState === 'stopped'} onClick={() => s.stopBot('stopped from builder')}>
                  <Square className="h-4 w-4" /> Stop
                </Button>
                <div className="ml-auto text-right">
                  <div className="text-[10px] tracking-wider text-ink-4 uppercase">Bot state</div>
                  <div className="num text-xs font-semibold text-ink">{s.botState.toUpperCase()}</div>
                  {s.botDetail && <div className="max-w-[260px] truncate text-[10px] text-ink-4" title={s.botDetail}>{s.botDetail}</div>}
                </div>
              </div>

              {dirty && (
                <Banner tone="warn" className="mt-2.5">
                  Unsaved changes. A bot always executes the <strong>saved</strong> version so that the recorded trades can be attributed to an
                  exact strategy definition. Save first, then Run.
                </Banner>
              )}
              {!s.settings.limits.tradingEnabled && (
                <Banner tone="info" className="mt-2.5">
                  Trading is disabled globally. Save and edit freely; Run will refuse until you enable it in Risk settings.
                </Banner>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
