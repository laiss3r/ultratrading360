'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { useApp } from '@/state/store';
import { Banner, Button, Field, Modal, Tabs } from './ui';
import { cn } from '@/lib/cn';
import { createStrategy } from '@/lib/engine/strategies';
import { theoreticalDigitProbability } from '@/lib/deriv/digits';
import type { ContractType, DigitContractType } from '@/lib/deriv/contracts';
import {
  DERIV_STAKE_MIN,
  PROGRESSIONS,
  PROGRESSION_ORDER,
  worstCaseStake,
  type ProgressionKind,
} from '@/lib/engine/progressions';

/** Deriv's own labels for the digit trade types, grouped as "Digits". */
const TRADE_TYPES: { value: ContractType; label: string; needsBarrier: boolean }[] = [
  { value: 'DIGITODD', label: 'Odd', needsBarrier: false },
  { value: 'DIGITEVEN', label: 'Even', needsBarrier: false },
  { value: 'DIGITOVER', label: 'Over', needsBarrier: true },
  { value: 'DIGITUNDER', label: 'Under', needsBarrier: true },
  { value: 'DIGITMATCH', label: 'Matches', needsBarrier: true },
  { value: 'DIGITDIFF', label: 'Differs', needsBarrier: true },
  { value: 'CALL', label: 'Rise', needsBarrier: false },
  { value: 'PUT', label: 'Fall', needsBarrier: false },
];

/**
 * Quick Strategy — Deriv Bot's shortcut for launching a bot without building
 * blocks. It is a modal over the workspace, not a separate page, and it is built
 * around the named stake progressions traders already know: Martingale,
 * D'Alembert, Reverse Martingale, Reverse D'Alembert, Oscar's Grind and 1-3-2-6.
 *
 * The "Learn more" tab is not optional decoration. Every progression escalates
 * exposure, and none of them changes the expected value of the contract
 * underneath, so the tab shows the worst-case stake the user is agreeing to and
 * says plainly what the progression cannot do.
 */
export function QuickStrategy() {
  const open = useApp((s) => s.quickStrategyOpen);
  const close = useApp((s) => s.closeQuickStrategy);
  const symbols = useApp((s) => s.symbols);
  const rankings = useApp((s) => s.rankings);
  const activeSymbol = useApp((s) => s.activeSymbol);
  const session = useApp((s) => s.session);
  const settings = useApp((s) => s.settings);
  const mode = useApp((s) => s.settings.mode);
  const saveStrategy = useApp((s) => s.saveStrategy);
  const setActiveStrategy = useApp((s) => s.setActiveStrategy);
  const runStrategy = useApp((s) => s.runStrategy);
  const pushLog = useApp((s) => s.pushLog);
  const rankMarkets = useApp((s) => s.rankMarkets);

  const [tab, setTab] = useState<'parameters' | 'learn'>('parameters');
  const [tradeType, setTradeType] = useState<ContractType>('DIGITODD');
  const [barrier, setBarrier] = useState(5);
  const [market, setMarket] = useState(activeSymbol || 'R_100');
  const [duration, setDuration] = useState(1);
  const [durationUnit, setDurationUnit] = useState<'t' | 's'>('t');
  const [stake, setStake] = useState(0.35);
  const [kind, setKind] = useState<ProgressionKind>('flat');
  const [multiplier, setMultiplier] = useState(2);
  const [takeProfit, setTakeProfit] = useState(0);
  const [stopLoss, setStopLoss] = useState(20);
  const [maxTrades, setMaxTrades] = useState(50);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const needsBarrier = TRADE_TYPES.find((t) => t.value === tradeType)?.needsBarrier ?? false;
  const currency = session?.currency ?? 'USD';
  const info = PROGRESSIONS[kind];

  // Only digit contracts have a fair-draw probability. Direction contracts
  // (Rise / Fall) do not: their win rate depends entirely on your entry
  // conditions, so nothing is assumed here.
  const isDigitType = tradeType.startsWith('DIGIT');
  const winProb = useMemo(
    () => (isDigitType ? theoreticalDigitProbability(tradeType as DigitContractType, needsBarrier ? barrier : undefined) : null),
    [tradeType, barrier, needsBarrier, isDigitType],
  );
  const breakEvenMultiplier = winProb && winProb > 0 ? 1 / winProb : Infinity;

  const worst5 = worstCaseStake({ kind, unit: stake, multiplier }, 5);
  const worst10 = worstCaseStake({ kind, unit: stake, multiplier }, 10);

  const marketOptions = useMemo(() => {
    if (rankings.length > 0) {
      return rankings.map((r) => ({ value: r.symbol, label: `${r.name} (${r.symbol})`, open: r.open }));
    }
    if (symbols.length > 0) {
      return symbols.map((s) => ({
        value: s.underlying_symbol,
        label: `${s.underlying_symbol_name} (${s.underlying_symbol})`,
        open: s.exchange_is_open === 1,
      }));
    }
    return [];
  }, [rankings, symbols]);

  const launch = async () => {
    setMessage(null);
    if (stake < DERIV_STAKE_MIN) {
      setMessage({ ok: false, text: `Stake must be at least ${DERIV_STAKE_MIN.toFixed(2)} ${currency}.` });
      return;
    }
    setBusy(true);
    try {
      const name = `${info.name} · ${TRADE_TYPES.find((t) => t.value === tradeType)?.label}${needsBarrier ? ` ${barrier}` : ''} · ${market}`;
      const strategy = createStrategy({
        name,
        market,
        contractType: tradeType,
        barrier: needsBarrier ? barrier : undefined,
        duration,
        durationUnit,
        stake,
        currency,
        // A quick strategy buys on every tick, subject to the cooldown. `always`
        // is the honest encoding of that; inventing a digit condition here would
        // imply an entry signal the user never chose.
        entry: { id: 'root', op: 'AND', children: [{ id: 'c1', kind: 'always' }] },
        cooldownSeconds: durationUnit === 't' ? 1 : 2,
        maxTrades,
        progression: { kind, unit: stake, multiplier },
        limits: {
          ...settings.limits,
          maxTrades,
          maxSessionProfit: takeProfit,
          maxSessionLoss: stopLoss,
          maxStake: Math.max(settings.limits.maxStake, worst10),
        },
        notes: `Created from Quick Strategy. Progression: ${info.name}.`,
      });

      const saved = await saveStrategy(strategy);
      if (!saved.ok) {
        setMessage({ ok: false, text: saved.message });
        return;
      }
      setActiveStrategy(strategy.id);
      const ran = await runStrategy(strategy.id);
      setMessage({ ok: ran.ok, text: ran.message });
      if (ran.ok) {
        setTab('parameters');
        close();
      } else {
        pushLog('warn', `Quick strategy did not start: ${ran.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : close}
      title="Quick strategy"
      width={560}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={launch} disabled={busy || !session}>
            {busy ? 'Starting…' : 'Create and run'}
          </Button>
        </>
      }
    >
      <Tabs<'parameters' | 'learn'>
        className="mb-3"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'parameters', label: 'Trade parameters' },
          { value: 'learn', label: 'Learn more' },
        ]}
      />

      {tab === 'parameters' ? (
        <div className="flex flex-col gap-3">
          <div>
            <span className="dt-section-title mb-1.5 block">Trade type · Digits</span>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {TRADE_TYPES.filter((t) => t.value.startsWith('DIGIT')).map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTradeType(t.value)}
                  aria-pressed={tradeType === t.value}
                  className={cn(
                    'rounded border px-2 py-2 text-xs font-bold transition-colors',
                    tradeType === t.value
                      ? 'border-coral bg-coral-wash text-coral'
                      : 'border-line bg-main-1 text-general hover:bg-state-hover',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <span className="dt-section-title mb-1.5 mt-3 block">Trade type · Direction</span>
            <div className="grid grid-cols-2 gap-1.5">
              {TRADE_TYPES.filter((t) => !t.value.startsWith('DIGIT')).map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTradeType(t.value)}
                  aria-pressed={tradeType === t.value}
                  title={t.value === 'CALL' ? 'Rise: wins if the exit tick price is above the entry tick price.' : 'Fall: wins if the exit tick price is below the entry tick price.'}
                  className={cn(
                    'rounded border px-2 py-2 text-xs font-bold transition-colors',
                    tradeType === t.value
                      ? 'border-coral bg-coral-wash text-coral'
                      : 'border-line bg-main-1 text-general hover:bg-state-hover',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xxs leading-relaxed text-less-prominent">
              Direction contracts settle on the exit tick price versus the entry tick price. Deriv quotes the payout when
              you buy; no win probability is assumed here, because it depends entirely on your entry conditions.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {needsBarrier && (
              <Field label="Barrier (last digit)" hint="Over/Under use strict inequality, so the barrier digit itself loses both ways.">
                <input
                  type="number"
                  min={0}
                  max={9}
                  step={1}
                  value={barrier}
                  onChange={(e) => setBarrier(Math.min(9, Math.max(0, Number(e.target.value) || 0)))}
                />
              </Field>
            )}
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="dt-section-title">Market</span>
                <button type="button" className="text-xxs text-coral hover:underline" onClick={() => void rankMarkets()}>
                  Rank markets
                </button>
              </div>
              {marketOptions.length > 0 ? (
                <select
                  value={market}
                  onChange={(e) => setMarket(e.target.value)}
                  aria-label="Market"
                >
                  {marketOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                      {o.open ? '' : ' — closed'}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={market}
                  onChange={(e) => setMarket(e.target.value)}
                  placeholder="R_100"
                  aria-label="Market symbol"
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Duration">
              <input type="number" min={1} value={duration} onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
            <Field label="Unit">
              <select value={durationUnit} onChange={(e) => setDurationUnit(e.target.value as 't' | 's')}>
                <option value="t">ticks</option>
                <option value="s">seconds</option>
              </select>
            </Field>
            <Field label={`Stake (${currency})`} hint={`Deriv minimum ${DERIV_STAKE_MIN.toFixed(2)}`}>
              <input type="number" min={DERIV_STAKE_MIN} step={0.05} value={stake} onChange={(e) => setStake(Number(e.target.value) || 0)} />
            </Field>
          </div>

          <div>
            <span className="dt-section-title mb-1.5 block">Stake progression</span>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {PROGRESSION_ORDER.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={cn(
                    'rounded border px-2 py-1.5 text-left text-xs transition-colors',
                    kind === k ? 'border-coral bg-coral-wash text-coral' : 'border-line bg-main-1 text-general hover:bg-state-hover',
                  )}
                >
                  <span className="block font-bold">{PROGRESSIONS[k].name}</span>
                  <span className="block text-xxs text-less-prominent">
                    {PROGRESSIONS[k].escalation === 'steep' ? 'steep escalation' : PROGRESSIONS[k].escalation === 'gradual' ? 'gradual escalation' : 'no escalation'}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xxs leading-snug text-less-prominent">{info.rule}</p>
          </div>

          {(kind === 'martingale' || kind === 'reverse_martingale') && (
            <Field label="Multiplier" hint="Deriv's default is 2.">
              <input
                type="number"
                min={1.01}
                step={0.1}
                value={multiplier}
                onChange={(e) => setMultiplier(Math.max(1.01, Number(e.target.value) || 2))}
              />
            </Field>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Field label={`Take profit (${currency})`} hint="0 disables it">
              <input type="number" min={0} step={1} value={takeProfit} onChange={(e) => setTakeProfit(Math.max(0, Number(e.target.value) || 0))} />
            </Field>
            <Field label={`Stop loss (${currency})`}>
              <input type="number" min={0} step={1} value={stopLoss} onChange={(e) => setStopLoss(Math.max(0, Number(e.target.value) || 0))} />
            </Field>
            <Field label="Max trades">
              <input type="number" min={1} step={1} value={maxTrades} onChange={(e) => setMaxTrades(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
          </div>

          {!session ? (
            <Banner tone="danger">
              No Deriv account is connected, so nothing can be launched. Connect a demo or real account — market data
              already streams without one, but orders need an account.
            </Banner>
          ) : (
            <Banner tone={mode === 'deriv_real' ? 'warn' : 'info'}>
              {`This will place ${mode === 'deriv_real' ? 'REAL-MONEY' : 'demo'} contracts on Deriv. Every order still passes the risk manager.`}
            </Banner>
          )}

          {message && !message.ok && <Banner tone="danger">{message.text}</Banner>}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-bold text-prominent">{info.name}</h3>
            <p className="mt-1 text-xs leading-relaxed text-general">{info.detail}</p>
          </div>

          <div className="flex gap-2 rounded border border-orange bg-orange-wash p-3">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-orange" />
            <div className="text-xs leading-relaxed text-general">
              <strong className="text-prominent">Risk.</strong> {info.risk}
            </div>
          </div>

          <div className="dt-card overflow-hidden">
            <div className="border-b border-line bg-section-1 px-3 py-2 text-xxs font-bold tracking-wide text-less-prominent uppercase">
              With your current settings — stake {stake.toFixed(2)} {currency}
              {kind === 'martingale' || kind === 'reverse_martingale' ? `, multiplier ${multiplier}` : ''}
            </div>
            <table className="w-full text-xs">
              <tbody>
                <Row label="Stake after 5 consecutive losses">
                  <span className={cn('num font-bold', worst5 > stake * 4 ? 'text-loss' : 'text-prominent')}>
                    {worst5.toFixed(2)} {currency}
                  </span>
                </Row>
                <Row label="Stake after 10 consecutive losses">
                  <span className={cn('num font-bold', worst10 > stake * 4 ? 'text-loss' : 'text-prominent')}>
                    {worst10.toFixed(2)} {currency}
                  </span>
                </Row>
                {isDigitType && (
                  <Row label={`Theoretical win probability (${TRADE_TYPES.find((t) => t.value === tradeType)?.label}${needsBarrier ? ` ${barrier}` : ''})`}>
                    <span className="num font-bold text-prominent">{((winProb ?? 0) * 100).toFixed(1)}%</span>
                  </Row>
                )}
                {!isDigitType && (
                  <Row label="Assumed win probability">
                    <span className="text-sm text-faint">None assumed — Rise / Fall win rate depends on your entry conditions</span>
                  </Row>
                )}
                <Row label="Break-even payout multiple">
                  <span className="num font-bold text-prominent">
                    {Number.isFinite(breakEvenMultiplier) ? `${breakEvenMultiplier.toFixed(3)}×` : '—'}
                  </span>
                </Row>
              </tbody>
            </table>
          </div>

          <div className="flex gap-2 rounded border border-line bg-section-1 p-3">
            <Info size={15} className="mt-0.5 shrink-0 text-blue" />
            <p className="text-xs leading-relaxed text-general">
              A progression changes the <em>shape</em> of your stake sequence. It never changes the expected value of the
              contract underneath. If a contract pays less than break-even for its true win probability, every
              progression here loses money over time — Martingale simply converts many small losses into rare large ones.
              The actual payout is quoted by Deriv at purchase time; the break-even figure above is what that quote must
              beat.
            </p>
          </div>

          <p className="text-xxs leading-relaxed text-less-prominent">
            Your stake is additionally capped by the risk manager at{' '}
            <span className="num text-general">{Math.max(settings.limits.maxStake, worst10).toFixed(2)} {currency}</span>{' '}
            and the session stops at the stop loss, take profit or maximum trade count — whichever comes first.
          </p>
        </div>
      )}
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-t border-line first:border-0">
      <td className="px-3 py-2 text-less-prominent">{label}</td>
      <td className="px-3 py-2 text-right">{children}</td>
    </tr>
  );
}
