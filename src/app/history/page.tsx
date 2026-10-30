'use client';

import { useMemo, useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { Badge, Banner, Button, Card, Empty, Segmented, Stat } from '@/components/ui';
import { EquityCurve } from '@/components/charts';
import { useApp } from '@/state/store';
import type { AccountMode } from '@/lib/deriv/types';
import { computeMetrics } from '@/lib/metrics';
import { clock, money, pct, signed } from '@/lib/format';

type ModeFilter = 'all' | AccountMode;

/**
 * Trade history.
 *
 * Aggregates are computed PER ACCOUNT. Demo P/L and real P/L are never summed into a single
 * headline number, because doing so would let a good demo run masquerade as real performance.
 */
export default function HistoryPage() {
  const s = useApp();
  const [filter, setFilter] = useState<ModeFilter>('all');
  const [strategyFilter, setStrategyFilter] = useState<string>('all');

  const rows = useMemo(() => {
    let r = s.trades;
    if (filter !== 'all') r = r.filter((t) => t.mode === filter);
    if (strategyFilter !== 'all') r = r.filter((t) => t.strategyId === strategyFilter);
    return r;
  }, [s.trades, filter, strategyFilter]);

  const base = s.session?.balance ?? 0;
  const demo = useMemo(() => s.trades.filter((t) => t.mode === 'deriv_demo'), [s.trades]);
  const real = useMemo(() => s.trades.filter((t) => t.mode === 'deriv_real'), [s.trades]);
  const demoM = useMemo(() => computeMetrics(demo, base), [demo, base]);
  const realM = useMemo(() => computeMetrics(real, base), [real, base]);
  const filtered = useMemo(() => computeMetrics(rows, base), [rows, base]);

  const byStrategy = useMemo(() => group(rows, (t) => `${t.strategyName} v${t.strategyVersion}`), [rows]);
  const byMarket = useMemo(() => group(rows, (t) => t.symbol), [rows]);

  const strategyIds = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of s.trades) m.set(t.strategyId, t.strategyName);
    return [...m.entries()];
  }, [s.trades]);

  function exportCsv() {
    const header = [
      'id','closedAt','openedAt','symbol','contractType','barrier','stake','payout','profit','won',
      'mode','source','strategyId','strategyName','strategyVersion','entryDigit','exitDigit',
      'entryPrice','exitPrice','balanceBefore','balanceAfter','idempotencyKey','error','riskReasons','gateReasons',
    ];
    const esc = (v: unknown) => {
      const str = v == null ? '' : String(v);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const lines = [header.join(',')];
    for (const t of rows) {
      lines.push([
        t.id, new Date(t.closedAt).toISOString(), new Date(t.openedAt).toISOString(), t.symbol, t.contractType, t.barrier ?? '',
        t.stake, t.payout, t.profit, t.won, t.mode, t.source, t.strategyId, t.strategyName, t.strategyVersion,
        t.entryDigit ?? '', t.exitDigit ?? '', t.entryPrice ?? '', t.exitPrice ?? '', t.balanceBefore, t.balanceAfter,
        t.idempotencyKey, t.error ?? '', (t.riskReasons ?? []).join('|'), (t.gateReasons ?? []).join('|'),
      ].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ultratrading360-trades-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    s.pushLog('ok', `Exported ${rows.length} trades to CSV.`);
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-3 p-4">
      <Banner tone="info">
        <strong className="font-bold">Demo and real results are kept separate.</strong> They are never summed into one headline
        figure. Every trade row records its own <code className="num">mode</code>, so a profitable demo run can never be mistaken for
        profitable real-money trading.
      </Banner>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card
          title="Demo performance"
          subtitle="Orders placed on your Deriv demo account through an authenticated socket."
          right={<Badge tone={demo.length ? 'info' : 'neutral'}>{demo.length ? 'DEMO' : 'NO DEMO TRADES'}</Badge>}
        >
          {demo.length === 0 ? <Empty title="No demo trades recorded">Run a bot with a demo account connected.</Empty> : <MetricGrid m={demoM} />}
        </Card>
        <Card
          title="Real performance"
          subtitle="Orders placed on your Deriv real account. Real money, real settlements."
          right={<Badge tone={real.length ? 'loss' : 'neutral'}>{real.length ? 'REAL' : 'NO REAL TRADES'}</Badge>}
        >
          {real.length === 0 ? (
            <Empty title="No real trades recorded">
              Nothing here is fabricated — if no real order settled, no real performance is shown.
            </Empty>
          ) : (
            <MetricGrid m={realM} />
          )}
        </Card>
      </div>

      <Card
        title="Trade ledger"
        subtitle={`${rows.length} of ${s.trades.length} trades shown`}
        right={
          <span className="flex items-center gap-2">
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'deriv_demo', label: 'DEMO' },
                { value: 'deriv_real', label: 'REAL' },
              ]}
            />
            <select
              value={strategyFilter}
              onChange={(e) => setStrategyFilter(e.target.value)}
              className="w-[170px] text-xxs"
            >
              <option value="all">All strategies</option>
              {strategyIds.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
            <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={exportCsv}>
              <Download className="h-3 w-3" /> CSV
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={s.trades.length === 0}
              onClick={async () => {
                if (!window.confirm('Delete ALL recorded trade history? This cannot be undone.')) return;
                await s.clearTrades();
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </span>
        }
        pad={false}
      >
        {rows.length === 0 ? (
          <Empty title="Nothing matches this filter">Trades are stored in IndexedDB in this browser only.</Empty>
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-left text-xxs">
              <thead className="sticky top-0 z-10 bg-section-1 text-xxs tracking-wider text-less-prominent uppercase">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Strategy</th>
                  <th className="px-3 py-2">Market</th>
                  <th className="px-3 py-2">Contract</th>
                  <th className="px-3 py-2 text-right">Stake</th>
                  <th className="px-3 py-2 text-right">Payout</th>
                  <th className="px-3 py-2 text-right">P/L</th>
                  <th className="px-3 py-2 text-center">Digit in→out</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((t) => (
                  <tr key={t.id} className="border-t border-line/60 align-middle hover:bg-state-hover/40">
                    <td className="num whitespace-nowrap px-3 py-1.5 text-less-prominent">{clock(t.closedAt)}</td>
                    <td className="px-3 py-1.5 text-general">
                      {t.strategyName} <span className="num text-less-prominent">v{t.strategyVersion}</span>
                    </td>
                    <td className="num px-3 py-1.5 text-general">{t.symbol}</td>
                    <td className="num px-3 py-1.5 text-general">{t.contractType}{t.barrier ? ` @${t.barrier}` : ''}</td>
                    <td className="num px-3 py-1.5 text-right text-general">{t.stake.toFixed(2)}</td>
                    <td className="num px-3 py-1.5 text-right text-general">{t.payout.toFixed(2)}</td>
                    <td className={`num px-3 py-1.5 text-right font-bold ${t.profit >= 0 ? 'text-profit' : 'text-loss'}`}>{signed(t.profit)}</td>
                    <td className="num px-3 py-1.5 text-center text-less-prominent">
                      {t.entryDigit ?? '—'} → {t.exitDigit ?? '—'}
                    </td>
                    <td className="num px-3 py-1.5 text-right text-less-prominent">{t.balanceAfter.toFixed(2)}</td>
                    <td className="px-3 py-1.5">
                      {t.source === 'deriv_live' ? (
                        <Badge tone={t.mode === 'deriv_real' ? 'loss' : 'info'}>{t.mode === 'deriv_real' ? 'REAL' : 'DEMO'}</Badge>
                      ) : (
                        <Badge tone="brand">SIM</Badge>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {t.error ? (
                        <span className="num max-w-[190px] truncate text-xxs text-loss" title={t.error}>{t.error}</span>
                      ) : (t.riskReasons?.length ?? 0) + (t.gateReasons?.length ?? 0) > 0 ? (
                        <span className="num max-w-[190px] truncate text-xxs text-orange" title={[...(t.riskReasons ?? []), ...(t.gateReasons ?? [])].join(' · ')}>
                          {[...(t.riskReasons ?? []), ...(t.gateReasons ?? [])].join(' · ')}
                        </span>
                      ) : (
                        <span className="text-less-prominent">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 500 && <div className="px-3 py-2 text-xxs text-less-prominent">Showing the 500 most recent. Export CSV for the full set.</div>}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="Equity curve (filtered)" subtitle="Green line is balance, dashed red is drawdown from peak.">
          <EquityCurve trades={rows} startingBalance={filtered.startingBalance} height={230} />
        </Card>
        <Card title="Breakdown" subtitle="Per-strategy and per-market, computed only from the rows currently in view.">
          <Breakdown title="By strategy" rows={byStrategy} />
          <div className="mt-3">
            <Breakdown title="By market" rows={byMarket} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function MetricGrid({ m }: { m: ReturnType<typeof computeMetrics> }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Stat label="Trades" value={m.tradeCount} hint={`${m.settledCount} settled · ${m.errorCount} errors`} />
      <Stat label="Net P/L" value={signed(m.netProfit)} tone={m.netProfit >= 0 ? 'profit' : 'loss'} hint={pct(m.returnPct)} />
      <Stat label="Win rate" value={m.settledCount ? pct(m.winRate, 1) : '—'} tone={m.winRate >= 0.5 ? 'profit' : m.settledCount ? 'loss' : 'muted'} hint={`${m.wins}W / ${m.losses}L`} />
      <Stat label="Profit factor" value={m.profitFactor == null ? '—' : m.profitFactor.toFixed(2)} tone={(m.profitFactor ?? 0) >= 1 ? 'profit' : 'loss'} hint={m.profitFactor == null ? 'no losses yet' : 'gross win / gross loss'} />
      <Stat label="EV per trade" value={m.settledCount ? signed(m.expectedValuePerTrade, 3) : '—'} tone={m.expectedValuePerTrade >= 0 ? 'profit' : 'loss'} hint="payout-weighted" />
      <Stat label="Avg win / loss" value={m.settledCount ? `${m.averageWin.toFixed(2)} / ${m.averageLoss.toFixed(2)}` : '—'} />
      <Stat label="Max drawdown" value={money(m.maxDrawdown)} tone="warn" hint={pct(m.maxDrawdownPct, 1)} />
      <Stat label="Consec. losses" value={m.maxConsecutiveLosses} tone={m.maxConsecutiveLosses >= 5 ? 'loss' : undefined} hint={`max wins ${m.maxConsecutiveWins}`} />
    </div>
  );
}

function group<T>(rows: T[], key: (r: T) => string) {
  const map = new Map<string, { label: string; count: number; net: number; wins: number }>();
  for (const r of rows) {
    const k = key(r);
    const t = r as unknown as { profit: number; won: boolean };
    const cur = map.get(k) ?? { label: k, count: 0, net: 0, wins: 0 };
    cur.count++;
    cur.net += t.profit;
    if (t.won) cur.wins++;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => b.net - a.net);
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; count: number; net: number; wins: number }[] }) {
  return (
    <div>
      <div className="mb-1.5 text-xxs font-medium tracking-wide text-general">{title}</div>
      {rows.length === 0 ? (
        <div className="text-xxs text-less-prominent">No data.</div>
      ) : (
        <table className="w-full text-left text-xxs">
          <thead className="text-xxs tracking-wider text-less-prominent uppercase">
            <tr>
              <th className="py-1">Name</th>
              <th className="py-1 text-right">Trades</th>
              <th className="py-1 text-right">Win %</th>
              <th className="py-1 text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 8).map((r) => (
              <tr key={r.label} className="border-t border-line/50">
                <td className="max-w-[190px] truncate py-1 text-general" title={r.label}>{r.label}</td>
                <td className="num py-1 text-right text-less-prominent">{r.count}</td>
                <td className="num py-1 text-right text-less-prominent">{r.count ? pct(r.wins / r.count, 0) : '—'}</td>
                <td className={`num py-1 text-right font-bold ${r.net >= 0 ? 'text-profit' : 'text-loss'}`}>{signed(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
