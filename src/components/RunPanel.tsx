'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, Square, Zap } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useApp, type RunPanelTab } from '@/state/store';
import { Badge, Button, ContractCard, Modal, Money, Tabs } from './ui';
import { SOURCE_LABEL } from '@/lib/format';

/**
 * The run drawer, positioned and composed as Deriv Bot does it: a fixed 366px
 * panel on the right of the workspace carrying Summary / Transactions / Journal,
 * a six-tile statistics block, a Reset button, and a "What's this?" modal that
 * defines every statistic in plain language.
 *
 * ONE DEPARTURE, and it is deliberate. Deriv sums every contract into one set of
 * totals because a Deriv bot only ever trades one feed. This platform also runs a
 * fully offline simulation, and adding simulated profit to real profit would
 * produce a number that describes nothing. The tiles therefore report the feed
 * that is currently selected, and say which feed that is.
 */
export function RunPanel() {
  const open = useApp((s) => s.runPanelOpen);
  const setOpen = useApp((s) => s.setRunPanelOpen);

  if (!open) {
    return (
      <button
        type="button"
        className="dt-drawer-handle"
        onClick={() => setOpen(true)}
        aria-label="Open run panel"
        title="Open run panel"
      >
        <ChevronLeft size={14} />
      </button>
    );
  }

  return (
    <aside className="dt-runpanel" aria-label="Run panel">
      <RunControls />
      <PanelTabs />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PanelBody />
      </div>
      <PanelFooter />
      <button
        type="button"
        className="absolute right-[var(--dt-runpanel-w)] top-1/2 z-30 flex h-14 w-[18px] -translate-y-1/2 items-center justify-center rounded-l border border-r-0 border-line bg-main-1 text-less-prominent hover:text-coral"
        onClick={() => setOpen(false)}
        aria-label="Collapse run panel"
        title="Collapse run panel"
      >
        <ChevronRight size={14} />
      </button>
    </aside>
  );
}

/* ------------------------------------------------------------- controls */

function RunControls() {
  const botState = useApp((s) => s.botState);
  const botDetail = useApp((s) => s.botDetail);
  const strategies = useApp((s) => s.strategies);
  const activeStrategyId = useApp((s) => s.activeStrategyId);
  const runStrategy = useApp((s) => s.runStrategy);
  const pauseBot = useApp((s) => s.pauseBot);
  const resumeBot = useApp((s) => s.resumeBot);
  const stopBot = useApp((s) => s.stopBot);
  const pushLog = useApp((s) => s.pushLog);
  const [busy, setBusy] = useState(false);

  const running = botState === 'running';
  const paused = botState === 'paused';
  const target = strategies.find((s) => s.id === activeStrategyId) ?? strategies[0];

  const tone = running
    ? { label: 'Running', t: 'profit' as const }
    : paused
      ? { label: 'Paused', t: 'warn' as const }
      : botState === 'halted'
        ? { label: 'Halted', t: 'loss' as const }
        : botState === 'error'
          ? { label: 'Error', t: 'loss' as const }
          : botState === 'starting' || botState === 'stopping'
            ? { label: botState === 'starting' ? 'Starting' : 'Stopping', t: 'warn' as const }
            : { label: 'Idle', t: 'neutral' as const };

  return (
    <div className="border-b border-line p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="dt-section-title">Bot status</span>
        <Badge tone={tone.t}>{tone.label}</Badge>
      </div>

      {running || paused ? (
        <div className="flex gap-2">
          {paused ? (
            <Button variant="success" size="sm" className="flex-1" onClick={resumeBot} aria-label="Resume bot" title="Resume bot">
              <Play size={13} /> Resume
            </Button>
          ) : (
            <Button variant="secondary" size="sm" className="flex-1" onClick={pauseBot} aria-label="Pause bot" title="Pause bot">
              <Pause size={13} /> Pause
            </Button>
          )}
          <Button
            variant="danger"
            size="sm"
            className="flex-1"
            onClick={() => stopBot('stopped from the run panel')}
            aria-label="Stop bot"
            title="Stop bot"
          >
            <Square size={13} /> Stop
          </Button>
        </div>
      ) : (
        <Button
          variant="primary"
          size="sm"
          className="w-full"
          disabled={!target || busy}
          onClick={async () => {
            if (!target) return;
            setBusy(true);
            const r = await runStrategy(target.id);
            setBusy(false);
            if (!r.ok) pushLog('warn', r.message);
          }}
          title={target ? `Run "${target.name}"` : 'Save a strategy in the Bot Builder first'}
        >
          <Zap size={13} />
          {target ? `Run ${target.name}` : 'No strategy selected'}
        </Button>
      )}

      {botDetail && <p className="mt-2 text-xxs leading-snug text-less-prominent">{botDetail}</p>}
    </div>
  );
}

function PanelTabs() {
  const tab = useApp((s) => s.runPanelTab);
  const setTab = useApp((s) => s.setRunPanelTab);
  return (
    <Tabs<RunPanelTab>
      value={tab}
      onChange={setTab}
      options={[
        { value: 'summary', label: 'Summary' },
        { value: 'transactions', label: 'Transactions' },
        { value: 'journal', label: 'Journal' },
      ]}
    />
  );
}

/* ------------------------------------------------------- statistics tiles */

interface Totals {
  stake: number;
  payout: number;
  runs: number;
  won: number;
  lost: number;
  profit: number;
  count: number;
}

/** Totals for ONE feed only. Simulation and live are never added together. */
function useTotals(): { totals: Totals; feed: 'simulation' | 'deriv_live'; other: number } {
  const trades = useApp((s) => s.trades);
  const dataSource = useApp((s) => s.dataSource);
  const botRuns = useApp((s) => s.botRuns);

  const feed: 'simulation' | 'deriv_live' = dataSource === 'deriv_live' ? 'deriv_live' : 'simulation';
  const mine = trades.filter((t) => t.source === feed);
  const settled = mine.filter((t) => !t.error);

  const stake = settled.reduce((a, t) => a + t.stake, 0);
  const payout = settled.reduce((a, t) => a + t.payout, 0);
  return {
    totals: {
      stake,
      payout,
      runs: botRuns,
      won: settled.filter((t) => t.won).length,
      lost: settled.filter((t) => !t.won).length,
      profit: payout - stake,
      count: mine.length,
    },
    feed,
    other: trades.length - mine.length,
  };
}

function StatisticsSummary() {
  const { totals, feed, other } = useTotals();
  const session = useApp((s) => s.session);
  const currency = session?.currency ?? 'USD';
  const [info, setInfo] = useState(false);

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="dt-section-title">
          {feed === 'deriv_live' ? 'Live statistics' : 'Simulation statistics'}
        </span>
        <button type="button" className="text-xxs text-coral hover:underline" onClick={() => setInfo(true)}>
          What&apos;s this?
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <Tile title="Total stake">
          <Money amount={totals.stake} currency={currency} showCurrency />
        </Tile>
        <Tile title="Total payout">
          <Money amount={totals.payout} currency={currency} showCurrency />
        </Tile>
        <Tile title="No. of runs">{totals.runs}</Tile>
        <Tile title="Contracts lost" tone="loss">
          {totals.lost}
        </Tile>
        <Tile title="Contracts won" tone="profit">
          {totals.won}
        </Tile>
        <Tile title="Total profit/loss">
          <Money amount={totals.profit} currency={currency} hasSign showCurrency />
        </Tile>
      </div>

      <p className="mt-2 text-xxs leading-relaxed text-less-prominent">
        Showing <strong className="text-general">{SOURCE_LABEL[feed]}</strong> contracts only.
        {other > 0 && <> {other} contract{other === 1 ? '' : 's'} from the other feed are excluded — simulated and live results are never summed.</>}
        {other === 0 && ' No contracts from the other feed exist yet.'}
      </p>

      <StatisticsInfoModal open={info} onClose={() => setInfo(false)} />
    </div>
  );
}

function Tile({ title, children, tone }: { title: string; children: React.ReactNode; tone?: 'profit' | 'loss' }) {
  return (
    <div className="dt-stat">
      <span className="dt-stat__title" title={title}>
        {title}
      </span>
      <span className={cn('num dt-stat__value', tone === 'profit' && 'text-profit', tone === 'loss' && 'text-loss')}>{children}</span>
    </div>
  );
}

/** Definitions worded the way Deriv Bot words them, so the terms mean the same thing. */
function StatisticsInfoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: [string, string][] = [
    ['Total stake', 'Total stake since you last cleared your stats.'],
    ['Total payout', 'Total payout since you last cleared your stats.'],
    ['No. of runs', 'The number of times your bot has been started since you last cleared your stats. Each run is one full execution of your strategy, from start until it is stopped or halted.'],
    ['Contracts lost', 'The number of contracts you have lost since you last cleared your stats.'],
    ['Contracts won', 'The number of contracts you have won since you last cleared your stats.'],
    ['Total profit/loss', 'Your total profit/loss since you last cleared your stats. It is the difference between your total payout and your total stake.'],
  ];
  return (
    <Modal open={open} onClose={onClose} title="What's this?" width={440}>
      <div className="flex flex-col gap-3">
        {rows.map(([term, def]) => (
          <div key={term}>
            <div className="text-xs font-bold text-prominent">{term}</div>
            <p className="text-xs leading-relaxed text-general">{def}</p>
          </div>
        ))}
        <p className="border-t border-line pt-3 text-xxs leading-relaxed text-less-prominent">
          Contracts that errored before settling are excluded from every figure above. A trade that failed to execute is
          never counted as a win or a loss.
        </p>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ tab bodies */

function PanelBody() {
  const tab = useApp((s) => s.runPanelTab);
  if (tab === 'transactions') return <TransactionsTab />;
  if (tab === 'journal') return <JournalTab />;
  return <SummaryTab />;
}

function SummaryTab() {
  const trades = useApp((s) => s.trades);
  const dataSource = useApp((s) => s.dataSource);
  const feed = dataSource === 'deriv_live' ? 'deriv_live' : 'simulation';
  const latest = trades.find((t) => t.source === feed);

  return (
    <div className="flex flex-col gap-3">
      <div className="p-3 pb-0">
        <div className="dt-section-title mb-2">Latest contract</div>
        {latest ? (
          <ContractCard
            title={`${latest.contractType}${latest.barrier ? ` ${latest.barrier}` : ''}`}
            subtitle={`${latest.symbol} · ${latest.strategyName} · ${SOURCE_LABEL[latest.source]}`}
            stake={latest.stake}
            payout={latest.payout}
            result={latest.error ? 'pending' : latest.won ? 'win' : 'loss'}
            icon={<span className="text-xs font-bold">{latest.exitDigit ?? latest.entryDigit ?? '?'}</span>}
          />
        ) : (
          <p className="rounded border border-line bg-section-1 px-3 py-4 text-center text-xs text-less-prominent">
            No contracts on this feed yet.
          </p>
        )}
      </div>
      <StatisticsSummary />
    </div>
  );
}

function TransactionsTab() {
  const trades = useApp((s) => s.trades);
  const dataSource = useApp((s) => s.dataSource);
  const feed = dataSource === 'deriv_live' ? 'deriv_live' : 'simulation';
  const rows = trades.filter((t) => t.source === feed).slice(0, 200);

  if (rows.length === 0) {
    return <p className="p-4 text-center text-xs text-less-prominent">No transactions on this feed.</p>;
  }

  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-section-1 text-xxs tracking-wide text-less-prominent uppercase">
        <tr>
          <th className="px-2 py-1.5 text-left font-bold">Time</th>
          <th className="px-2 py-1.5 text-left font-bold">Contract</th>
          <th className="px-2 py-1.5 text-right font-bold">Stake</th>
          <th className="px-2 py-1.5 text-right font-bold">P/L</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id} className="border-t border-line">
            <td className="num px-2 py-1.5 text-less-prominent">
              {new Date(t.closedAt).toLocaleTimeString('en-GB', { hour12: false })}
            </td>
            <td className="px-2 py-1.5">
              <span className="block font-bold text-prominent">
                {t.contractType}
                {t.barrier ? ` ${t.barrier}` : ''}
              </span>
              <span className="block text-xxs text-less-prominent">{t.symbol}</span>
            </td>
            <td className="num px-2 py-1.5 text-right text-general">{t.stake.toFixed(2)}</td>
            <td className={cn('num px-2 py-1.5 text-right font-bold', t.error ? 'text-less-prominent' : t.profit >= 0 ? 'text-profit' : 'text-loss')}>
              {t.error ? '—' : `${t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function JournalTab() {
  const log = useApp((s) => s.log);
  const clearLog = useApp((s) => s.clearLog);

  if (log.length === 0) {
    return <p className="p-4 text-center text-xs text-less-prominent">The journal is empty.</p>;
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-xxs text-less-prominent">{log.length} entries</span>
        <button type="button" className="text-xxs text-coral hover:underline" onClick={clearLog}>
          Clear
        </button>
      </div>
      <ul className="flex flex-col">
        {log.map((e, i) => (
          <li key={`${e.at}-${i}`} className="flex gap-2 border-b border-line px-3 py-1.5 last:border-0">
            <span className="num shrink-0 text-xxs text-less-prominent">
              {new Date(e.at).toLocaleTimeString('en-GB', { hour12: false })}
            </span>
            <span
              className={cn(
                'shrink-0 text-xxs font-bold uppercase',
                e.level === 'ok' && 'text-profit',
                e.level === 'warn' && 'text-orange',
                e.level === 'error' && 'text-loss',
                e.level === 'info' && 'text-less-prominent',
              )}
            >
              {e.level}
            </span>
            <span className="min-w-0 break-words text-xxs leading-snug text-general">{e.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- footer */

function PanelFooter() {
  const trades = useApp((s) => s.trades);
  const clearTrades = useApp((s) => s.clearTrades);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="border-t border-line p-3">
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        disabled={trades.length === 0}
        onClick={() => setConfirming(true)}
        title="Clear every trade and reset the statistics"
      >
        Reset
      </Button>
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Reset statistics?"
        width={420}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                await clearTrades();
                setConfirming(false);
              }}
            >
              Reset stats
            </Button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-general">
          This clears the trade ledger on <strong>both</strong> feeds and resets the statistics above, including the run
          counter. A running bot is stopped first. This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
