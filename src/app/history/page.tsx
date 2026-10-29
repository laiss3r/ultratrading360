'use client';

import { useMemo, useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { Badge, Banner, Button, Card, Empty, Segmented, Stat } from '@/components/ui';
import { EquityCurve } from '@/components/charts';
import { useApp } from '@/state/store';
import { computeMetrics } from '@/lib/metrics';
import { clock, money, pct, signed } from '@/lib/format';

type SourceFilter = 'all' | 'simulation' | 'deriv_live';

/**
 * Trade history.
 *
 * Aggregates are computed PER PROVENANCE. Simulated P/L and live P/L are never summed into a
 * single headline number, because doing so would let a good simulation run masquerade as real
 * performance.
 */
export default function HistoryPage() {
  const s = useApp();
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [strategyFilter, setStrategyFilter] = useState<string>('all');

  const rows = useMemo(() => {
    let r = s.trades;
    if (filter !== 'all') r = r.filter((t) => t.source === filter);
    if (strategyFilter !== 'all') r = r.filter((t) => t.strategyId === strategyFilter);
    return r;
  }, [s.trades, filter, strategyFilter]);

  const sim = useMemo(() => s.trades.filter((t) => t.source === 'simulation'), [s.trades]);
  const live = useMemo(() => s.trades.filter((t) => t.source === 'deriv_live'), [s.trades]);
  const simM = useMemo(() => computeMetrics(sim, s.settings.simulationStartingBalance), [sim, s.settings.simulationStartingBalance]);
  const liveM = useMemo(() => computeMetrics(live, s.session?.balance ?? 0), [live, s.session?.balance]);
  const filtered = useMemo(() => computeMetrics(rows, simM.startingBalance), [rows, simM.startingBalance]);

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
        <strong className="font-semibold">Simulation and live results are kept separate.</strong> They are never summed into one headline
        figure. Every trade row records its own <code className="num">source</code> and <code className="num">mode</code>, so a profitable
        simulation can never be mistaken for profitable live trading.
      </Banner>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="Simulation performance" subtitle="Settled locally by the seeded engine. No order was ever sent to Deriv." right={<Badge tone="brand">SIM</Badge>}>
          <MetricGrid m={simM} />
        </Card>
        <Card
          title="Live performance"
          subtitle="Executed through an authenticated Deriv socket against a real or demo account."
          right={<Badge tone={live.length ? 'info' : 'neutral'}>{live.length ? 'LIVE' : 'NO LIVE TRADES'}</Badge>}
        >
          {live.length === 0 ? (
            <Empty title="No live trades recorded">
              Connect a Deriv account and run a bot in DEMO or REAL mode. Nothing here is fabricated — if no live order settled, no live
              performance is shown.
            </Empty>
          ) : (
            <MetricGrid m={liveM} />
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
                { value: 'simulation', label: 'SIM' },
                { value: 'deriv_live', label: 'LIVE' },
              ]}
            />
            <select
              value={strategyFilter}
              onChange={(e) => setStrategyFilter(e.target.value)}
              className="w-[170px] text-[11px]"
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
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 z-10 bg-elevated text-[9.5px] tracking-wider text-ink-3 uppercase">
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
                  <tr key={t.id} className="border-t border-line/60 align-middle hover:bg-hover/40">
                    <td className="num whitespace-nowrap px-3 py-1.5 text-ink-3">{clock(t.closedAt)}</td>
                    <td className="px-3 py-1.5 text-ink-2">
                      {t.strategyName} <span className="num text-ink-4">v{t.strategyVersion}</span>
                    </td>
                    <td className="num px-3 py-1.5 text-ink-2">{t.symbol}</td>
                    <td className="num px-3 py-1.5 text-ink-2">{t.contractType}{t.barrier ? ` @${t.barrier}` : ''}</td>
                    <td className="num px-3 py-1.5 text-right text-ink-2">{t.stake.toFixed(2)}</td>
                    <td className="num px-3 py-1.5 text-right text-ink-2">{t.payout.toFixed(2)}</td>
                    <td className={`num px-3 py-1.5 text-right font-semibold ${t.profit >= 0 ? 'text-profit' : 'text-loss'}`}>{signed(t.profit)}</td>
                    <td className="num px-3 py-1.5 text-center text-ink-3">
                      {t.entryDigit ?? '—'} → {t.exitDigit ?? '—'}
                    </td>
                    <td className="num px-3 py-1.5 text-right text-ink-3">{t.balanceAfter.toFixed(2)}</td>
                    <td className="px-3 py-1.5">
                      {t.source === 'deriv_live' ? (
                        <Badge tone={t.mode === 'deriv_real' ? 'loss' : 'info'}>{t.mode === 'deriv_real' ? 'REAL' : 'DEMO'}</Badge>
                      ) : (
                        <Badge tone="brand">SIM</Badge>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {t.error ? (
                        <span className="num max-w-[190px] truncate text-[10px] text-loss" title={t.error}>{t.error}</span>
                      ) : (t.riskReasons?.length ?? 0) + (t.gateReasons?.length ?? 0) > 0 ? (
                        <span className="num max-w-[190px] truncate text-[10px] text-warn" title={[...(t.riskReasons ?? []), ...(t.gateReasons ?? [])].join(' · ')}>
                          {[...(t.riskReasons ?? []), ...(t.gateReasons ?? [])].join(' · ')}
                        </span>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 500 && <div className="px-3 py-2 text-[11px] text-ink-4">Showing the 500 most recent. Export CSV for the full set.</div>}
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
      <div className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-2">{title}</div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-ink-4">No data.</div>
      ) : (
        <table className="w-full text-left text-[11px]">
          <thead className="text-[9.5px] tracking-wider text-ink-4 uppercase">
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
                <td className="max-w-[190px] truncate py-1 text-ink-2" title={r.label}>{r.label}</td>
                <td className="num py-1 text-right text-ink-3">{r.count}</td>
                <td className="num py-1 text-right text-ink-3">{r.count ? pct(r.wins / r.count, 0) : '—'}</td>
                <td className={`num py-1 text-right font-semibold ${r.net >= 0 ? 'text-profit' : 'text-loss'}`}>{signed(r.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
