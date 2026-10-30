'use client';

import Link from 'next/link';
import { AlertTriangle, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { Banner, Button, Card, Field, Stat, Toggle } from '@/components/ui';
import { useApp } from '@/state/store';
import { money, pct, signed } from '@/lib/format';
import { riskOfRuin, kellyFraction } from '@/lib/stats/ev';

/**
 * Risk page — the single place where the enforced limits are configured.
 *
 * These are not advisory UI hints. RiskManager.evaluate() runs before every order and refuses or
 * clamps based on exactly these numbers, on every connected account.
 */
export default function RiskPage() {
  const s = useApp();
  const L = s.settings.limits;
  const R = s.settings.recovery;
  const snap = s.riskSnapshot;

  const setL = async (patch: Partial<typeof L>) => {
    await s.setSettings({ limits: { ...L, ...patch } });
  };
  const setR = async (patch: Partial<typeof R>) => {
    await s.setSettings({ recovery: { ...R, ...patch } });
  };

  const ddPct = snap.equityPeak > 0 ? (snap.equityPeak - snap.equity) / snap.equityPeak : 0;

  return (
    <div className="mx-auto max-w-[1300px] space-y-3 p-4">
      <Banner tone="warn">
        <span className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Every limit below is enforced by the risk manager <strong>before</strong> an order is placed, on demo and real accounts alike. The
            manager also <strong>clamps</strong> stakes rather than merely warning: a recovery multiplier can never push a stake above{' '}
            <code className="num">maxStake</code>. Stopped bots really stop, and a halted session cannot be resumed without an explicit reset
            here.
          </span>
        </span>
      </Banner>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Session P/L" value={signed(snap.sessionPnl)} tone={snap.sessionPnl >= 0 ? 'profit' : 'loss'} hint={`${snap.tradesThisSession} trades`} />
        <Stat label="Daily P/L" value={signed(snap.dailyPnl)} tone={snap.dailyPnl >= 0 ? 'profit' : 'loss'} hint={`of ${money(L.maxDailyLoss, '')} limit`} />
        <Stat label="Current drawdown" value={pct(ddPct, 1)} tone={ddPct >= L.maxDrawdownPct ? 'loss' : 'warn'} hint={`limit ${pct(L.maxDrawdownPct, 0)}`} />
        <Stat label="Open exposure" value={money(snap.openExposure, '')} tone={snap.openExposure >= L.maxOpenExposure ? 'loss' : undefined} hint={`limit ${money(L.maxOpenExposure, '')}`} />
        <Stat label="Session exposure" value={money(snap.sessionExposure, '')} hint={`limit ${money(L.maxSessionExposure, '')}`} />
        <Stat
          label="Kill switch"
          value={L.tradingEnabled ? 'ENABLED' : 'DISABLED'}
          tone={L.tradingEnabled ? 'profit' : 'warn'}
          hint={L.tradingEnabled ? 'orders may be placed' : 'no order can be placed'}
        />
      </div>

      {snap.halted && (
        <Banner tone="danger">
          <strong className="font-bold">Session halted:</strong> {snap.haltReason ?? 'a limit was breached'}. Trading is blocked until you
          reset the session counters.
        </Banner>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="Master controls" subtitle="Kill switch and real-money acknowledgement.">
          <div className="space-y-2.5">
            <Toggle
              checked={L.tradingEnabled}
              onChange={async (v) => {
                await setL({ tradingEnabled: v });
                s.pushLog(v ? 'ok' : 'warn', v ? 'Trading ENABLED. Orders may now be placed.' : 'Trading DISABLED. Kill switch engaged.');
                if (!v) s.stopBot('trading disabled');
              }}
              label="Trading enabled"
              hint={
                L.tradingEnabled
                  ? 'The risk manager will evaluate and place orders within the limits below.'
                  : 'Kill switch is ON. No order can be placed on any connected account.'
              }
            />
            <Toggle
              tone="danger"
              checked={s.settings.realTradingAcknowledged}
              disabled={!s.session || s.session.isVirtual}
              onChange={async (v) => {
                if (v) {
                  const ok = window.confirm(
                    'REAL-MONEY TRADING\n\nThis allows live orders on a real Deriv account. Losses are real.\n\nContinue only if you fully understand this.',
                  );
                  if (!ok) return;
                  await s.setSettings({
                    realTradingAcknowledged: true,
                    acknowledgedAccountLoginid: s.session?.loginid ?? null,
                    limits: { ...L, realTradingAcknowledged: true },
                  });
                  s.pushLog('warn', `Real-money trading ACKNOWLEDGED for ${s.session?.loginid}.`);
                } else {
                  await s.setSettings({
                    realTradingAcknowledged: false,
                    acknowledgedAccountLoginid: null,
                    limits: { ...L, realTradingAcknowledged: false },
                  });
                  s.stopBot('real-money acknowledgement withdrawn');
                  s.pushLog('warn', 'Real-money acknowledgement WITHDRAWN.');
                }
              }}
              label="Real-money trading acknowledged"
              hint={
                s.session
                  ? s.session.isVirtual
                    ? 'Unavailable — the connected account is demo/virtual. Connect a real account to acknowledge.'
                    : `Acknowledged for ${s.settings.acknowledgedAccountLoginid ?? s.session.loginid}. Re-checked on every order, not just at startup.`
                  : 'Connect a real Deriv account first.'
              }
            />
            {false && (
              <Banner tone="info">
                You are in SIM mode. Enabling trading here is still required to run a bot, but simulated orders are settled locally by the
                seeded engine and are <strong>never</strong> sent to Deriv.
              </Banner>
            )}
          </div>
        </Card>

        <Card title="Position limits" subtitle="Per-order and aggregate caps, enforced by the risk manager.">
          <div className="grid grid-cols-2 gap-2.5">
            <NumField label="Max stake per trade" value={L.maxStake} min={0.35} step={0.05} onChange={(v) => void setL({ maxStake: v })} />
            <NumField label="Min stake per trade" value={L.minStake} min={0.35} step={0.05} onChange={(v) => void setL({ minStake: v })} />
            <NumField label="Max open exposure" value={L.maxOpenExposure} min={0} step={5} onChange={(v) => void setL({ maxOpenExposure: v })} />
            <NumField label="Max session exposure" value={L.maxSessionExposure} min={0} step={10} onChange={(v) => void setL({ maxSessionExposure: v })} />
            <NumField label="Max trades (session)" value={L.maxTrades} min={1} step={1} onChange={(v) => void setL({ maxTrades: v })} />
            <NumField label="Max session loss" value={L.maxSessionLoss} min={0} step={10} onChange={(v) => void setL({ maxSessionLoss: v })} />
            <NumField label="Max daily loss" value={L.maxDailyLoss} min={0} step={10} onChange={(v) => void setL({ maxDailyLoss: v })} />
            <Field label="Max drawdown (% of peak)">
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={L.maxDrawdownPct}
                onChange={(e) => void setL({ maxDrawdownPct: Number(e.target.value) })}
                className="num"
              />
            </Field>
          </div>
          {L.minStake > L.maxStake && (
            <Banner tone="danger" className="mt-2.5">
              <span className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Minimum stake exceeds maximum stake — every order would be refused.</span>
            </Banner>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Recovery mode (capped martingale)" subtitle="Optional. Escalation is a CLAMPED SUGGESTION, never an instruction the risk manager must obey.">
          <div className="space-y-2.5">
            <Toggle
              tone="danger"
              checked={R.enabled}
              onChange={async (v) => {
                await setR({ enabled: v });
                s.pushLog(v ? 'warn' : 'info', v ? 'Recovery mode ENABLED. Stake escalation is capped by maxStake and the step limit.' : 'Recovery mode disabled.');
              }}
              label="Enable recovery escalation"
              hint={
                R.enabled
                  ? 'After a loss the suggested stake is multiplied, then re-clamped against maxStake. The step limit caps how far it can escalate.'
                  : 'Off. Every trade uses the strategy stake unchanged.'
              }
            />
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
              <NumField label="Multiplier" value={R.multiplier} min={1} max={5} step={0.1} onChange={(v) => void setR({ multiplier: v })} disabled={!R.enabled} />
              <NumField label="Step limit" value={R.stepLimit} min={0} max={12} step={1} onChange={(v) => void setR({ stepLimit: v })} disabled={!R.enabled} />
              <NumField label="Recovery max stake" value={R.maxStake} min={0.35} step={1} onChange={(v) => void setR({ maxStake: v })} disabled={!R.enabled} />
              <NumField label="Recovery max drawdown" value={R.maxDrawdown} min={0} step={10} onChange={(v) => void setR({ maxDrawdown: v })} disabled={!R.enabled} />
            </div>

            <Banner tone="warn">
              <strong className="font-bold">Read this before enabling recovery.</strong> A martingale does not change the expected value of
              a negative-EV contract; it changes the <em>distribution</em> of outcomes, trading many small wins for occasional large losses.
              With a multiplier of {R.multiplier} and a step limit of {R.stepLimit}, the worst-case stake sequence from{' '}
              {money(L.minStake, '')} peaks at{' '}
              <strong className="num">
                {money(Math.min(L.maxStake, R.maxStake, L.minStake * Math.pow(R.multiplier, R.stepLimit)), '')}
              </strong>{' '}
              — the risk manager will not allow a stake beyond {money(Math.min(L.maxStake, R.maxStake), '')} regardless of what the multiplier
              implies.
            </Banner>
          </div>
        </Card>

        <Card title="Session" subtitle="Reset counters or clear history.">
          <div className="space-y-2.5">
            <div className="rounded border border-line bg-section-1 px-3 py-2">
              <div className="text-xxs tracking-wider text-less-prominent uppercase">Recovery step</div>
              <div className="num text-sm font-bold text-prominent">{snap.recoveryStep} / {R.stepLimit}</div>
            </div>
            <Button variant="outline" className="w-full" onClick={() => s.resetRisk()}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset session counters
            </Button>
            <Button
              variant="danger"
              className="w-full"
              onClick={async () => {
                if (!window.confirm('Delete ALL recorded trade history from this browser? This cannot be undone.')) return;
                await s.clearTrades();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear trade history
            </Button>
            <Link href="/history">
              <Button variant="ghost" className="w-full">View full trade history</Button>
            </Link>
          </div>
        </Card>
      </div>

      <Card title="Sizing sanity checks" subtitle="Derived from your current limits and recent win rate — informational, not a recommendation.">
        <SizingPanel winRate={s.metrics.winRate} settled={s.metrics.settledCount} maxStake={L.maxStake} bankroll={s.metrics.endingBalance} />
      </Card>
    </div>
  );
}

function SizingPanel({ winRate, settled, maxStake, bankroll }: { winRate: number; settled: number; maxStake: number; bankroll: number }) {
  if (settled < 30) {
    return (
      <Banner tone="info">
        {settled} settled trades recorded. Sizing estimates need at least 30 to mean anything — a win rate from 5 trades has a confidence
        interval wide enough to include both 20% and 90%.
      </Banner>
    );
  }
  // Assume a 1.95x payout (typical Deriv digit contract) purely to illustrate the arithmetic.
  const payout = 1.95;
  const stake = Math.min(maxStake, 1);
  const kelly = kellyFraction(winRate, stake, stake * payout);
  const ror = riskOfRuin(winRate, stake, stake * payout, bankroll);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Stat
        label="Observed win rate"
        value={pct(winRate, 1)}
        hint={`${settled} settled trades, 95% CI shown in Signal Lab`}
      />
      <Stat
        label="Kelly fraction"
        value={kelly > 0 ? pct(kelly, 2) : '≤ 0'}
        tone={kelly <= 0 ? 'loss' : 'warn'}
        hint={kelly <= 0 ? 'At a 1.95× payout this win rate has negative EV — no stake size is profitable.' : 'Full Kelly assumes the win rate is known exactly. It is not.'}
      />
      <Stat
        label="Risk of ruin"
        value={ror >= 1 ? '≈100%' : pct(ror, 2)}
        tone={ror > 0.5 ? 'loss' : 'warn'}
        hint={`Bankroll ${money(bankroll, '')} vs ${money(stake, '')} stake at 1.95× payout`}
      />
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="num disabled:opacity-50"
      />
    </Field>
  );
}
