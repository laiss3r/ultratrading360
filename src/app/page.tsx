'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { AlertTriangle, CircleSlash, Pause, Play, Square, Terminal } from 'lucide-react';
import { Badge, Banner, Button, Card, Empty, Stat } from '@/components/ui';
import { DigitHistogram, DigitStrip, EquityCurve, TickChart, type DigitBin } from '@/components/charts';
import { useApp } from '@/state/store';
import { digitFrequency, chiSquareUniformity } from '@/lib/stats/tests';
import { clock, money, pct, signed, SOURCE_LABEL, MODE_LABEL } from '@/lib/format';

export default function DashboardPage() {
  const s = useApp();
  const { metrics, settings, trades, quotes, digits, botState, riskSnapshot } = s;

  const bins: DigitBin[] = useMemo(() => {
    const freq = digitFrequency(digits, 0.95);
    // digitFrequency already returns percentages (0-100) and Wilson bounds in the same units.
    return freq.map((f) => ({
      digit: f.digit,
      count: f.count,
      pct: f.observedPct,
      expectedPct: f.expectedPct,
      ciLow: f.ciLower,
      ciHigh: f.ciUpper,
      deviation: f.deviation,
    }));
  }, [digits]);

  const chi = useMemo(() => (digits.length >= 50 ? chiSquareUniformity(digits) : null), [digits]);
  const live = trades.filter((t) => t.source === 'deriv_live');
  const sim = trades.filter((t) => t.source === 'simulation');

  return (
    <div className="mx-auto max-w-[1600px] space-y-3 p-4">
      {/* Gating banner: the kill switch is off by default and this is the one-click path on. */}
      {!settings.limits.tradingEnabled && (
        <Banner tone="info" className="flex flex-wrap items-center justify-between gap-3 py-2.5">
          <span className="flex items-center gap-2">
            <CircleSlash className="h-3.5 w-3.5 shrink-0" />
            <span>
              <strong className="font-semibold">Trading is disabled.</strong> This is the safe default — no order can be placed until you
              turn it on. {settings.mode === 'simulation' ? 'Simulation places no real orders.' : ''}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => void s.setSettings({ limits: { ...settings.limits, tradingEnabled: true } })}>
              Enable {settings.mode === 'simulation' ? 'simulation' : 'live'} trading
            </Button>
            <Link href="/risk">
              <Button size="sm" variant="ghost">Risk settings</Button>
            </Link>
          </span>
        </Banner>
      )}

      {settings.mode !== 'simulation' && !s.session && (
        <Banner tone="warn">
          <strong className="font-semibold">{MODE_LABEL[settings.mode]} selected but no account is connected.</strong> Market data streams
          live from Deriv without credentials; placing orders requires you to <Link href="/connect" className="underline">connect an account</Link>.
        </Banner>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label={`${MODE_LABEL[settings.mode]} balance`}
          value={money(metrics.endingBalance, settings.mode === 'simulation' ? 'SIM' : (s.session?.currency ?? 'USD'))}
          tone={metrics.netProfit >= 0 ? 'profit' : 'loss'}
          hint={`start ${metrics.startingBalance.toFixed(2)}`}
        />
        <Stat label="Net P/L" value={signed(metrics.netProfit)} tone={metrics.netProfit >= 0 ? 'profit' : 'loss'} hint={pct(metrics.returnPct)} />
        <Stat
          label="Win rate"
          value={metrics.settledCount ? pct(metrics.winRate, 1) : '—'}
          tone={metrics.winRate >= 0.5 ? 'profit' : metrics.settledCount ? 'loss' : 'muted'}
          hint={`${metrics.wins}W / ${metrics.losses}L of ${metrics.settledCount}`}
        />
        <Stat
          label="EV / trade"
          value={metrics.settledCount ? signed(metrics.expectedValuePerTrade, 3) : '—'}
          tone={metrics.expectedValuePerTrade >= 0 ? 'profit' : 'loss'}
          hint={metrics.settledCount ? 'payout-weighted, not assumed 2×' : 'needs settled trades'}
        />
        <Stat label="Max drawdown" value={money(metrics.maxDrawdown)} tone="warn" hint={`${pct(metrics.maxDrawdownPct, 1)} from peak · ${metrics.maxConsecutiveLosses} consec. losses`} />
        <Stat label="Trades" value={metrics.tradeCount} hint={`sim ${sim.length} · live ${live.length} · errors ${metrics.errorCount}`} />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {/* Live market */}
        <Card
          className="xl:col-span-2"
          title={
            <span className="flex items-center gap-2">
              {s.activeSymbol}
              <Badge tone={s.dataSource === 'deriv_live' ? 'profit' : 'brand'}>{SOURCE_LABEL[s.dataSource]}</Badge>
            </span>
          }
          subtitle="Price is the broker quote for live data, or the deterministic simulator's output in SIM mode. The digit is extracted using the instrument's own pip_size."
          right={
            <span className="flex items-center gap-2">
              {s.marketLoading && <span className="text-[10px] text-ink-4">loading…</span>}
              <span className="num text-[11px] text-ink-3">{quotes.length} ticks buffered</span>
            </span>
          }
        >
          <div className="h-[220px]">
            <TickChart quotes={quotes} />
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold tracking-wider text-ink-3 uppercase">Last digits (most recent → right)</span>
              <span className="num text-[10px] text-ink-4">pip_size {s.pipSize}</span>
            </div>
            <DigitStrip digits={digits} count={44} />
          </div>
        </Card>

        {/* Bot control */}
        <Card
          title="Bot control"
          subtitle="One bot at a time. Stopping waits for the in-flight contract to settle rather than abandoning it."
          right={<BotStateBadge state={botState} detail={s.botDetail} />}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-line bg-base/40 px-3 py-2">
                <div className="text-[10px] tracking-wider text-ink-3 uppercase">Strategy</div>
                <div className="mt-0.5 truncate text-xs font-medium text-ink">
                  {s.strategies.find((x) => x.id === s.activeStrategyId)?.name ?? '— none selected —'}
                </div>
              </div>
              <div className="rounded-lg border border-line bg-base/40 px-3 py-2">
                <div className="text-[10px] tracking-wider text-ink-3 uppercase">Risk gate</div>
                <div className="mt-0.5 text-xs font-medium">
                  {riskSnapshot.halted ? <span className="text-loss">HALTED</span> : settings.limits.tradingEnabled ? <span className="text-profit">OPEN</span> : <span className="text-warn">DISABLED</span>}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="success"
                className="flex-1"
                disabled={botState === 'running' || botState === 'starting' || botState === 'paused' || !s.activeStrategyId}
                onClick={async () => {
                  if (!s.activeStrategyId) return;
                  const r = await s.runStrategy(s.activeStrategyId);
                  if (!r.ok) s.pushLog('error', r.message);
                }}
              >
                <Play className="h-3.5 w-3.5" /> {botState === 'idle' || botState === 'stopped' ? 'Start' : 'Run'}
              </Button>
              <Button variant="outline" disabled={botState !== 'running'} onClick={() => s.pauseBot()}>
                <Pause className="h-3.5 w-3.5" /> Pause
              </Button>
              <Button variant="outline" disabled={botState !== 'paused'} onClick={() => s.resumeBot()}>
                <Play className="h-3.5 w-3.5" /> Resume
              </Button>
              <Button variant="danger" disabled={botState === 'idle' || botState === 'stopped'} onClick={() => s.stopBot('stopped from dashboard')}>
                <Square className="h-3.5 w-3.5" /> Stop
              </Button>
            </div>

            {botState === 'paused' && (
              <Banner tone="warn">Paused. No new contracts are opened; any in-flight contract is allowed to settle.</Banner>
            )}
            {riskSnapshot.halted && (
              <Banner tone="danger">
                <strong className="font-semibold">Risk halt:</strong> {riskSnapshot.haltReason ?? 'limits breached'}. Bots cannot restart until
                you reset the session counters in <Link href="/risk" className="underline">Risk</Link>.
              </Banner>
            )}

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <Row label="Session P/L" value={signed(riskSnapshot.sessionPnl)} tone={riskSnapshot.sessionPnl >= 0 ? 'profit' : 'loss'} />
              <Row label="Daily P/L" value={signed(riskSnapshot.dailyPnl)} tone={riskSnapshot.dailyPnl >= 0 ? 'profit' : 'loss'} />
              <Row label="Trades this session" value={`${riskSnapshot.tradesThisSession} / ${settings.limits.maxTrades}`} />
              <Row label="Open exposure" value={money(riskSnapshot.openExposure, '')} />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Equity curve"
          subtitle="Cumulative balance and drawdown from the peak. Simulated and live trades are recorded separately and never summed together below."
          right={<span className="num text-[10px] text-ink-4">{trades.length} trades</span>}
        >
          <EquityCurve trades={trades} startingBalance={metrics.startingBalance} height={210} />
        </Card>

        <Card
          title="Digit distribution"
          subtitle={`Observed vs the uniform 10% expectation over ${digits.length} ticks. Bars outside the Wilson 95% band are anomalies in THIS sample.`}
          right={chi && <Badge tone={chi.pValue < 0.05 ? 'warn' : 'neutral'}>χ² p={chi.pValue.toFixed(3)}</Badge>}
        >
          <DigitHistogram bins={bins} height={188} />
          <p className="mt-2 text-[10px] leading-relaxed text-ink-4">
            {chi
              ? chi.pValue < 0.05
                ? `Uniformity is rejected (p=${chi.pValue.toFixed(4)}). That is evidence the sample deviates from a fair draw — it is NOT evidence the next digit is predictable. See Signal Lab for dependence tests and out-of-sample evaluation.`
                : `Cannot reject uniformity (p=${chi.pValue.toFixed(4)}). The sample is consistent with a fair 1-in-10 draw.`
              : `Collect at least 50 ticks for a goodness-of-fit test (currently ${digits.length}).`}
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Recent trades" subtitle="Every row carries its own provenance tag so simulated P/L is never mistaken for real P/L." pad={false}>
          {trades.length === 0 ? (
            <Empty title="No trades yet">
              Select a strategy in <Link href="/builder" className="text-accent underline">Bot Builder</Link> or launch one from{' '}
              <Link href="/overlord" className="text-accent underline">Overlord Pro</Link>. In SIM mode nothing is sent to Deriv.
            </Empty>
          ) : (
            <div className="max-h-[320px] overflow-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 z-10 bg-elevated text-[9.5px] tracking-wider text-ink-3 uppercase">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Market</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2 text-right">Stake</th>
                    <th className="px-3 py-2 text-right">Payout</th>
                    <th className="px-3 py-2 text-right">P/L</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.slice(0, 60).map((t) => (
                    <tr key={t.id} className="border-t border-line/60 hover:bg-hover/40">
                      <td className="num px-3 py-1.5 text-ink-3">{clock(t.closedAt)}</td>
                      <td className="px-3 py-1.5 text-ink-2">{t.symbol}</td>
                      <td className="px-3 py-1.5 text-ink-2">{t.contractType}{t.barrier ? ` @${t.barrier}` : ''}</td>
                      <td className="num px-3 py-1.5 text-right text-ink-2">{t.stake.toFixed(2)}</td>
                      <td className="num px-3 py-1.5 text-right text-ink-2">{t.payout.toFixed(2)}</td>
                      <td className={`num px-3 py-1.5 text-right font-semibold ${t.profit >= 0 ? 'text-profit' : 'text-loss'}`}>{signed(t.profit)}</td>
                      <td className="px-3 py-1.5">
                        {t.error ? (
                          <Badge tone="loss">ERROR</Badge>
                        ) : t.source === 'deriv_live' ? (
                          <Badge tone="info">{t.mode === 'deriv_real' ? 'REAL' : 'DEMO'}</Badge>
                        ) : (
                          <Badge tone="brand">SIM</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Activity log"
          subtitle="Risk refusals, connection events and settlement outcomes. Nothing here is hidden from you."
          right={
            <span className="flex items-center gap-1.5">
              <Terminal className="h-3 w-3 text-ink-4" />
              <button onClick={() => s.clearLog()} className="text-[10px] text-ink-4 hover:text-ink-2">clear</button>
            </span>
          }
          pad={false}
        >
          {s.log.length === 0 ? (
            <Empty title="No events yet" />
          ) : (
            <ul className="max-h-[320px] space-y-px overflow-auto p-2">
              {s.log.slice(0, 120).map((l, i) => (
                <li key={`${l.at}-${i}`} className="flex gap-2 rounded px-1.5 py-1 text-[11px] leading-snug hover:bg-hover/50">
                  <span className="num shrink-0 text-ink-4">{clock(l.at)}</span>
                  {l.level === 'warn' && <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warn" />}
                  <span
                    className={
                      l.level === 'error' ? 'text-loss' : l.level === 'warn' ? 'text-warn' : l.level === 'ok' ? 'text-profit' : 'text-ink-2'
                    }
                  >
                    {l.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'profit' | 'loss' }) {
  return (
    <div className="flex items-center justify-between rounded border border-line bg-base/30 px-2.5 py-1.5">
      <span className="text-ink-3">{label}</span>
      <span className={`num font-semibold ${tone === 'profit' ? 'text-profit' : tone === 'loss' ? 'text-loss' : 'text-ink'}`}>{value}</span>
    </div>
  );
}

function BotStateBadge({ state, detail }: { state: string; detail?: string }) {
  const tone =
    state === 'running' ? 'profit' : state === 'error' || state === 'halted' ? 'loss' : state === 'paused' || state === 'starting' ? 'warn' : 'neutral';
  return (
    <span title={detail}>
      <Badge tone={tone as 'profit'}>{state.toUpperCase()}</Badge>
    </span>
  );
}
