'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Blocks, CircleSlash, Copy, Pause, Play, Square, Trash2, Upload, Zap } from 'lucide-react';
import { Badge, Banner, Button, Card, Empty, Stat } from '@/components/ui';
import { DigitHistogram, DigitStrip, EquityCurve, TickChart, type DigitBin } from '@/components/charts';
import { useApp } from '@/state/store';
import { digitFrequency, chiSquareUniformity } from '@/lib/stats/tests';
import { ago, clock, money, pct, signed, SOURCE_LABEL, MODE_LABEL } from '@/lib/format';
import { PROGRESSIONS } from '@/lib/engine/progressions';

/**
 * Dashboard, in the shape Deriv Bot uses: your bots as cards, with the actions
 * that matter on each one, and the shortcuts for creating a new bot above them.
 *
 * The live market and the statistics sit below rather than above, because on a
 * bot platform the question you arrive with is "which bot do I run", not "what
 * is the price".
 */
export default function DashboardPage() {
  const s = useApp();
  const { metrics, settings, trades, quotes, digits, botState } = s;

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

  const [runError, setRunError] = useState<string | null>(null);
  const chi = useMemo(() => (digits.length >= 50 ? chiSquareUniformity(digits) : null), [digits]);
  const demoCount = trades.filter((t) => t.mode === 'deriv_demo').length;
  const realCount = trades.filter((t) => t.mode === 'deriv_real').length;
  const feedTrades = trades.filter((t) => t.mode === settings.mode);
  const feedSettled = feedTrades.filter((t) => !t.error);
  const feedStake = feedSettled.reduce((a, t) => a + t.stake, 0);
  const feedPayout = feedSettled.reduce((a, t) => a + t.payout, 0);

  return (
    <div className="mx-auto max-w-[1500px] space-y-3 p-4">
      {/* Gating banner: the kill switch is off by default and this is the one-click path on. */}
      {!settings.limits.tradingEnabled && (
        <Banner tone="info" className="flex flex-wrap items-center justify-between gap-3 py-2.5">
          <span className="flex items-center gap-2">
            <CircleSlash className="h-3.5 w-3.5 shrink-0" />
            <span>
              <strong>Trading is disabled.</strong> This is the safe default — no order can be placed on your Deriv account until you turn it on.
            </span>
          </span>
          <span className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => void s.setSettings({ limits: { ...settings.limits, tradingEnabled: true } })}>
              Enable trading
            </Button>
            <Link href="/risk">
              <Button size="sm" variant="ghost">
                Risk settings
              </Button>
            </Link>
          </span>
        </Banner>
      )}

      {runError && <Banner tone="danger">{runError}</Banner>}

      {!s.session && (
        <Banner tone="warn">
          <strong>No Deriv account connected.</strong> Market data streams live from Deriv without credentials; placing
          orders requires you to{' '}
          <Link href="/connect" className="text-coral underline">
            connect an account
          </Link>
          .
        </Banner>
      )}

      {/* ---------------------------------------------------- quick actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="md" onClick={s.openQuickStrategy}>
          <Zap size={14} /> Quick strategy
        </Button>
        <Link href="/builder">
          <Button variant="secondary" size="md">
            <Blocks size={14} /> Bot Builder
          </Button>
        </Link>
        <Link href="/chart">
          <Button variant="secondary" size="md">
            <BarChart3 size={14} /> Chart
          </Button>
        </Link>
        <Link href="/signals">
          <Button variant="secondary" size="md">
            <AlertTriangle size={14} /> Signals
          </Button>
        </Link>
        <span className="ml-auto flex items-center gap-2 text-xs text-less-prominent">
          <Badge tone={botState === 'running' ? 'profit' : botState === 'halted' ? 'loss' : 'neutral'}>
            Bot {botState}
          </Badge>
          <Badge tone={s.dataSource === 'deriv_live' ? 'profit' : 'info'}>{SOURCE_LABEL[s.dataSource]}</Badge>
        </span>
      </div>

      {/* -------------------------------------------------------- your bots */}
      <Card
        title="Your bots"
        subtitle={`Stored in this browser. ${s.strategies.length} saved${s.strategies.length === 10 ? ' — the maximum Deriv Bot allows is 10.' : '.'}`}
        pad={false}
        right={
          s.strategies.length > 0 ? (
            <span className="text-xxs text-less-prominent">One bot runs at a time, by design.</span>
          ) : undefined
        }
      >
        {s.strategies.length === 0 ? (
          <Empty title="No bots yet">
            Use <strong>Quick strategy</strong> to launch a preset progression in a few clicks, or open the{' '}
            <strong>Bot Builder</strong> to compose the conditions yourself.
          </Empty>
        ) : (
          <ul className="grid grid-cols-1 gap-2.5 p-3 md:grid-cols-2 xl:grid-cols-3">
            {s.strategies.map((st) => {
              const stTrades = trades.filter((t) => t.strategyId === st.id);
              const stSettled = stTrades.filter((t) => !t.error);
              const stNet = stSettled.reduce((a, t) => a + t.profit, 0);
              const isActive = st.id === s.activeStrategyId;
              const isRunning = isActive && botState === 'running';
              const prog = st.progression ? PROGRESSIONS[st.progression.kind].name : 'Fixed stake';
              return (
                <li
                  key={st.id}
                  className={`dt-card flex flex-col p-3 transition-colors ${isActive ? 'border-coral' : 'hover:border-less-prominent'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-prominent">{st.name}</div>
                      <div className="num mt-0.5 flex flex-wrap items-center gap-1.5 text-xxs text-less-prominent">
                        <span>{st.market}</span>
                        <span>·</span>
                        <span>
                          {st.contractType}
                          {st.barrier !== undefined ? ` ${st.barrier}` : ''}
                        </span>
                        <span>·</span>
                        <span>
                          {st.duration}
                          {st.durationUnit}
                        </span>
                      </div>
                    </div>
                    <span className="num shrink-0 rounded-sm bg-section-1 px-1.5 py-0.5 text-xxs font-bold text-less-prominent">
                      v{st.version}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral">{prog}</Badge>
                    <Badge tone="neutral">
                      stake {st.stake.toFixed(2)} {st.currency}
                    </Badge>
                    {isRunning && <Badge tone="profit">Running</Badge>}
                  </div>

                  <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-line pt-2">
                    <span className="text-xxs text-less-prominent">
                      {stSettled.length > 0 ? (
                        <>
                          <span className={stNet >= 0 ? 'text-profit' : 'text-loss'}>
                            <strong className="num">{signed(stNet)}</strong>
                          </span>{' '}
                          over {stSettled.length} trade{stSettled.length === 1 ? '' : 's'}
                        </>
                      ) : (
                        'Never run'
                      )}
                    </span>
                    <span className="text-xxs text-less-prominent">{ago(st.updatedAt)}</span>
                  </div>

                  <div className="mt-2.5 flex items-center gap-1.5">
                    {isRunning ? (
                      <>
                        <Button size="sm" variant="secondary" className="flex-1" onClick={s.pauseBot} aria-label={`Pause ${st.name}`}>
                          <Pause size={12} /> Pause
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          className="flex-1"
                          onClick={() => s.stopBot('stopped from the dashboard')}
                          aria-label={`Stop ${st.name}`}
                        >
                          <Square size={12} /> Stop
                        </Button>
                      </>
                    ) : botState === 'paused' && isActive ? (
                      <>
                        <Button size="sm" variant="success" className="flex-1" onClick={s.resumeBot} aria-label={`Resume ${st.name}`}>
                          <Play size={12} /> Resume
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          className="flex-1"
                          onClick={() => s.stopBot('stopped from the dashboard')}
                          aria-label={`Stop ${st.name}`}
                        >
                          <Square size={12} /> Stop
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        className="flex-1"
                        disabled={botState === 'running'}
                        onClick={async () => {
                          s.setActiveStrategy(st.id);
                          const r = await s.runStrategy(st.id);
                          if (!r.ok) {
                            s.pushLog('warn', r.message);
                            setRunError(r.message);
                          } else {
                            setRunError(null);
                          }
                        }}
                        aria-label={`Run ${st.name}`}
                        title={botState === 'running' ? 'Another bot is running' : `Run "${st.name}"`}
                      >
                        <Play size={12} /> Run
                      </Button>
                    )}
                    <Link href="/builder">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => s.setActiveStrategy(st.id)}
                        aria-label={`Edit ${st.name}`}
                        title="Edit in the Bot Builder"
                      >
                        <Blocks size={12} />
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${st.name}`}
                      title="Delete this bot"
                      onClick={() => {
                        if (!window.confirm(`Delete "${st.name}"? This cannot be undone.`)) return;
                        void s.deleteStrategy(st.id);
                      }}
                    >
                      <Trash2 size={12} className="text-loss" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ------------------------------------------------------- statistics */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Account balance"
          value={s.session ? money(metrics.endingBalance, s.session.currency) : 'Not connected'}
          tone={s.session ? (metrics.netProfit >= 0 ? 'profit' : 'loss') : 'muted'}
          hint={s.session ? `${s.session.loginid} · Deriv reports ${money(s.session.balance, s.session.currency)}` : 'connect to trade'}
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
        <Stat
          label="Max drawdown"
          value={money(metrics.maxDrawdown)}
          tone="warn"
          hint={`${pct(metrics.maxDrawdownPct, 1)} from peak · ${metrics.maxConsecutiveLosses} consec. losses`}
        />
        <Stat label="Trades" value={metrics.tradeCount} hint={`demo ${demoCount} · real ${realCount} · errors ${metrics.errorCount}`} />
      </div>

      <Banner tone="info">
        Statistics above cover your <strong>{MODE_LABEL[settings.mode]}</strong> account only — {feedSettled.length} settled
        contract{feedSettled.length === 1 ? '' : 's'}, {feedStake.toFixed(2)} staked, {feedPayout.toFixed(2)} paid out. Demo
        and real results are never summed into one headline figure.
      </Banner>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {/* Live market */}
        <Card
          className="xl:col-span-2"
          title={
            <span className="flex items-center gap-2">
              {s.activeSymbol}
              <Badge tone={s.dataSource === 'deriv_live' ? 'profit' : 'info'}>{SOURCE_LABEL[s.dataSource]}</Badge>
            </span>
          }
          subtitle="Price and digit come straight from the Deriv tick feed. The digit is extracted using the instrument's own pip_size; if the feed is not connected, nothing is shown instead of a substitute price."
          right={
            <span className="flex items-center gap-2">
              {s.marketLoading && <span className="text-xxs text-less-prominent">loading…</span>}
              <span className="num text-xxs text-less-prominent">{quotes.length} ticks buffered</span>
            </span>
          }
        >
          <div className="h-[220px]">
            <TickChart quotes={quotes} />
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="dt-section-title">Last digits (most recent → right)</span>
              <span className="num text-xxs text-less-prominent">pip_size {s.pipSize}</span>
            </div>
            <DigitStrip digits={digits} count={44} />
          </div>
        </Card>

        {/* Digit distribution */}
        <Card
          title="Digit distribution"
          subtitle="Observed frequency against the Wilson 95% band for a fair 1-in-10 draw."
          right={chi ? <Badge tone={chi.pValue < 0.05 ? 'warn' : 'neutral'}>χ² p={chi.pValue.toFixed(3)}</Badge> : undefined}
        >
          <DigitHistogram bins={bins} height={186} />
          <p className="mt-2 text-xxs leading-relaxed text-less-prominent">
            {digits.length < 50
              ? `Needs at least 50 digits to test uniformity — ${digits.length} so far.`
              : chi && chi.pValue < 0.05
                ? 'This sample deviates from uniform more than chance usually allows. That is an anomaly in the sample, NOT evidence about the next digit.'
                : 'Indistinguishable from a fair digit stream at α=0.05. Nothing here predicts the next digit.'}
          </p>
        </Card>
      </div>

      <Card
        title="Equity curve"
        subtitle={`${MODE_LABEL[settings.mode]} contracts only, from a starting balance of ${metrics.startingBalance.toFixed(2)}.`}
        right={
          <Link href="/history">
            <Button size="sm" variant="ghost">
              Full history
            </Button>
          </Link>
        }
      >
        {feedTrades.length === 0 ? (
          <Empty title="No contracts on this feed yet">Run a bot, or switch the feed in the account menu.</Empty>
        ) : (
          <>
            <EquityCurve trades={feedTrades} startingBalance={metrics.startingBalance} height={200} />
            <p className="mt-2 text-xxs text-less-prominent">
              Solid line is equity; the dashed line is drawdown from the running peak. Last settled contract{' '}
              {feedTrades[0] ? clock(feedTrades[0].closedAt) : '—'}.
            </p>
          </>
        )}
      </Card>

      <p className="flex items-center gap-2 pb-2 text-xxs text-less-prominent">
        <Upload size={12} />
        Strategies are plain JSON and can be exported from the Bot Builder. Nothing is uploaded anywhere — this
        deployment has no server database, so history lives in this browser only.
        <Copy size={12} className="ml-2" />
        <Link href="/overlord" className="text-coral hover:underline">
          Overlord console
        </Link>
      </p>
    </div>
  );
}
