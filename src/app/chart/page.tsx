'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Badge, Banner, Button, Card, Empty } from '@/components/ui';
import { DigitHistogram, DigitStrip, TickChart, type DigitBin } from '@/components/charts';
import { useApp } from '@/state/store';
import { digitFrequency, chiSquareUniformity } from '@/lib/stats/tests';
import { theoreticalDigitProbability } from '@/lib/deriv/digits';
import { SOURCE_LABEL } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { DigitContractType } from '@/lib/deriv/contracts';
import { SIMULATOR_CATALOGUE } from '@/lib/engine/rng';
import type { ActiveSymbol } from '@/lib/deriv/types';

const CONTRACTS: { value: DigitContractType; label: string; barrier?: number }[] = [
  { value: 'DIGITODD', label: 'Odd' },
  { value: 'DIGITEVEN', label: 'Even' },
  { value: 'DIGITOVER', label: 'Over 5', barrier: 5 },
  { value: 'DIGITUNDER', label: 'Under 5', barrier: 5 },
  { value: 'DIGITMATCH', label: 'Matches 5', barrier: 5 },
  { value: 'DIGITDIFF', label: 'Differs 5', barrier: 5 },
];

/**
 * Chart tab.
 *
 * Deriv Bot keeps a dedicated Chart tab next to the builder so you can watch the
 * instrument your bot trades without leaving the run panel behind. This is that
 * tab: market browser on the left, the price series and its extracted digits in
 * the centre, and the contract reference for the selected market on the right.
 *
 * It deliberately does NOT offer a manual buy button. Placing a one-off contract
 * by hand is a different product from running a bot, and adding a button that
 * spends money without the bot's risk gating behind it would undermine the whole
 * point of the risk manager.
 */
/**
 * The market list, falling back to the simulator's own catalogue when nothing live
 * is connected. Shaped as ActiveSymbol so the browser, search and grouping below do
 * not need a second code path; `exchange_is_open: 1` is true for these because the
 * simulator is always able to produce them, unlike a real exchange that closes.
 */
function effectiveSymbols(symbols: ActiveSymbol[]): { list: ActiveSymbol[]; synthetic: boolean } {
  if (symbols.length > 0) return { list: symbols, synthetic: false };
  return {
    list: SIMULATOR_CATALOGUE.map((c) => ({
      underlying_symbol: c.symbol,
      underlying_symbol_name: c.name,
      market: 'synthetic_indices',
      submarket: 'Offline simulator',
      pip_size: c.pipSize,
      exchange_is_open: 1 as const,
      is_trading_suspended: 0 as const,
    })),
    synthetic: true,
  };
}

export default function ChartPage() {
  const s = useApp();
  const [query, setQuery] = useState('');
  const { list: allSymbols, synthetic } = useMemo(() => effectiveSymbols(s.symbols), [s.symbols]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = allSymbols.filter(
      (x) => !q || x.underlying_symbol.toLowerCase().includes(q) || x.underlying_symbol_name.toLowerCase().includes(q),
    );
    const out = new Map<string, typeof filtered>();
    for (const sym of filtered) {
      const key = sym.submarket || sym.market;
      const list = out.get(key) ?? [];
      list.push(sym);
      out.set(key, list);
    }
    return Array.from(out.entries());
  }, [allSymbols, query]);

  const bins: DigitBin[] = useMemo(() => {
    const freq = digitFrequency(s.digits, 0.95);
    return freq.map((f) => ({
      digit: f.digit,
      count: f.count,
      pct: f.observedPct,
      expectedPct: f.expectedPct,
      ciLow: f.ciLower,
      ciHigh: f.ciUpper,
      deviation: f.deviation,
    }));
  }, [s.digits]);

  const chi = useMemo(() => (s.digits.length >= 50 ? chiSquareUniformity(s.digits) : null), [s.digits]);
  const rank = s.rankings.find((r) => r.symbol === s.activeSymbol);

  return (
    <div className="flex h-full min-h-0">
      {/* -------------------------------------------------- market browser */}
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-line bg-main-1">
        <div className="border-b border-line p-2.5">
          <label className="relative block">
            <Search size={13} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-less-prominent" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search markets"
              aria-label="Search markets"
              className="pl-7"
            />
          </label>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xxs text-less-prominent">
              {allSymbols.length} markets · {allSymbols.filter((x) => x.exchange_is_open === 1).length} open
              {synthetic && ' (simulator)'}
            </span>
            <button type="button" className="text-xxs text-coral hover:underline" onClick={() => void s.rankMarkets()}>
              Rank
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {synthetic && (
            <p className="border-b border-line p-2.5 text-xxs leading-relaxed text-less-prominent">
              Offline simulator catalogue. These are the ten synthetic indices the simulator can genuinely produce, at
              each one&apos;s real precision. Connect a Deriv account to browse the full live market list.
            </p>
          )}
          {grouped.length === 0 ? (
            <p className="p-3 text-xs text-less-prominent">Nothing matches &ldquo;{query}&rdquo;.</p>
          ) : (
            grouped.map(([sub, list]) => (
              <div key={sub}>
                <div className="sticky top-0 bg-section-1 px-3 py-1 text-xxs font-bold tracking-wide text-less-prominent uppercase">
                  {sub}
                </div>
                <ul>
                  {list.map((sym) => {
                    const active = sym.underlying_symbol === s.activeSymbol;
                    const r = s.rankings.find((x) => x.symbol === sym.underlying_symbol);
                    return (
                      <li key={sym.underlying_symbol}>
                        <button
                          type="button"
                          onClick={() => void s.selectSymbol(sym.underlying_symbol)}
                          className={cn(
                            'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors',
                            active ? 'bg-coral-wash text-coral' : 'text-general hover:bg-state-hover',
                          )}
                        >
                          <span className="min-w-0">
                            <span className={cn('block truncate text-xs', active && 'font-bold')}>{sym.underlying_symbol_name}</span>
                            <span className="num block text-xxs text-less-prominent">{sym.underlying_symbol}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            {r && <span className="num text-xxs text-less-prominent">{r.score.toFixed(2)}</span>}
                            <span
                              className={cn('h-1.5 w-1.5 rounded-full', sym.exchange_is_open === 1 ? 'bg-profit' : 'bg-disabled')}
                              title={sym.exchange_is_open === 1 ? 'Open' : 'Closed'}
                            />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* --------------------------------------------------------- chart */}
      <div className="min-w-0 flex-1 overflow-y-auto p-3">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3">
          <Card
            title={
              <span className="flex items-center gap-2">
                {s.activeSymbol}
                <Badge tone={s.dataSource === 'deriv_live' ? 'profit' : 'info'}>{SOURCE_LABEL[s.dataSource]}</Badge>
                {rank && <Badge tone="neutral">rank score {rank.score.toFixed(2)}</Badge>}
              </span>
            }
            subtitle={
              s.symbols.find((x) => x.underlying_symbol === s.activeSymbol)?.underlying_symbol_name ??
              'Price series and the digits extracted from it'
            }
            right={<span className="num text-xxs text-less-prominent">{s.quotes.length} ticks · pip_size {s.pipSize}</span>}
          >
            <div className="h-[320px]">
              {s.quotes.length < 2 ? (
                <Empty title="Collecting ticks">The chart appears once at least two quotes have arrived.</Empty>
              ) : (
                <TickChart quotes={s.quotes} points={240} />
              )}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card title="Last digits" subtitle={`Extracted at this instrument's own precision (pip_size ${s.pipSize}).`}>
              <DigitStrip digits={s.digits} count={60} />
              <p className="mt-2 text-xxs text-less-prominent">
                Most recent digit on the right, highlighted. {s.digits.length} in the buffer.
              </p>
            </Card>

            <Card
              title="Digit distribution"
              subtitle="Observed against the Wilson 95% band for a fair 1-in-10 draw."
              right={chi ? <Badge tone={chi.pValue < 0.05 ? 'warn' : 'neutral'}>χ² p={chi.pValue.toFixed(3)}</Badge> : undefined}
            >
              <DigitHistogram bins={bins} height={170} />
            </Card>
          </div>

          <Card title="Contract reference" subtitle={`Theoretical probabilities for digit contracts on ${s.activeSymbol}.`}>
            <Banner tone="info" className="mb-3">
              These are the probabilities of a <em>fair, independent</em> digit stream — the benchmark, not a forecast.
              The break-even multiple is what Deriv must quote for a contract to be fair; anything below it loses money
              over time regardless of how the stake is progressed.
            </Banner>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-xxs tracking-wide text-less-prominent uppercase">
                  <th className="px-2 py-1.5 text-left font-bold">Contract</th>
                  <th className="px-2 py-1.5 text-right font-bold">Win probability</th>
                  <th className="px-2 py-1.5 text-right font-bold">Break-even payout</th>
                  <th className="px-2 py-1.5 text-right font-bold">Fair payout for 1.00 stake</th>
                </tr>
              </thead>
              <tbody>
                {CONTRACTS.map((c) => {
                  const p = theoreticalDigitProbability(c.value, c.barrier);
                  const be = p > 0 ? 1 / p : Infinity;
                  return (
                    <tr key={c.label} className="border-b border-line last:border-0">
                      <td className="px-2 py-2 font-bold text-prominent">{c.label}</td>
                      <td className="num px-2 py-2 text-right text-general">{(p * 100).toFixed(1)}%</td>
                      <td className="num px-2 py-2 text-right text-general">{Number.isFinite(be) ? `${be.toFixed(3)}×` : '—'}</td>
                      <td className="num px-2 py-2 text-right text-less-prominent">
                        {Number.isFinite(be) ? be.toFixed(2) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xxs leading-relaxed text-less-prominent">
              Deriv quotes actual payouts at purchase time and they are below break-even — that difference is the
              margin. The Signals tab compares the quoted payout against these figures rather than assuming 2×.
            </p>
          </Card>

          {s.rankings.length > 0 && (
            <Card
              title="Market ranking"
              subtitle="How the top markets were ordered, and what that ordering does and does not mean."
              right={
                <Button size="sm" variant="ghost" onClick={() => void s.rankMarkets()}>
                  Re-rank
                </Button>
              }
            >
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line text-xxs tracking-wide text-less-prominent uppercase">
                    <th className="px-2 py-1.5 text-left font-bold">Market</th>
                    <th className="px-2 py-1.5 text-right font-bold">Sample</th>
                    <th className="px-2 py-1.5 text-right font-bold">Digit entropy</th>
                    <th className="px-2 py-1.5 text-right font-bold">Mean |move| (pips)</th>
                    <th className="px-2 py-1.5 text-left font-bold">Cadence</th>
                    <th className="px-2 py-1.5 text-right font-bold">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {s.rankings.slice(0, 14).map((r) => (
                    <tr key={r.symbol} className="border-b border-line last:border-0">
                      <td className="px-2 py-1.5">
                        <span className="block font-bold text-prominent">{r.name}</span>
                        <span className="num block text-xxs text-less-prominent">{r.symbol}</span>
                      </td>
                      <td className="num px-2 py-1.5 text-right text-general">{r.sample}</td>
                      <td className="num px-2 py-1.5 text-right text-general">{r.digitEntropy.toFixed(3)}</td>
                      <td className="num px-2 py-1.5 text-right text-general">{r.meanAbsMovePips.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-less-prominent">{r.cadence}</td>
                      <td className="num px-2 py-1.5 text-right font-bold text-prominent">{r.score.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xxs leading-relaxed text-less-prominent">
                Score = digit entropy × 0.6 + min(mean absolute move ÷ 10, 1) × 0.3 + cadence (0.1 if a 1-second index,
                else 0.05), over up to 14 open markets and 300 ticks each. It ranks markets by how close their recent
                digits sit to uniform and how actively they tick. <strong className="text-general">None of these inputs forecast the next digit</strong> —
                a market scoring highly is one where a fair-digit assumption is least contradicted by the sample, which
                is a statement about the past window only.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
