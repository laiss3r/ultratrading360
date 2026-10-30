'use client';

import { useMemo, useState } from 'react';
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine,
} from 'recharts';
import { AlertTriangle, Beaker, Download, FlaskConical, Percent, Sigma } from 'lucide-react';
import { Badge, Banner, Button, Card, Empty, Field, Segmented, Stat } from '@/components/ui';
import { DigitHistogram, useChartTheme, type DigitBin } from '@/components/charts';
import { useApp } from '@/state/store';
import {
  autocorrelation, chiSquareUniformity, digitFrequency, ljungBox,
  rollingDigitFrequency, runsTest, transitionMatrix, type TestResult,
} from '@/lib/stats/tests';
import { proportionTest } from '@/lib/stats/ci';
import { correctLabeled, expectedFalsePositives, type CorrectionMethod } from '@/lib/stats/multiple';
import { backtest } from '@/lib/stats/backtest';
import { expectedValue, theoreticalEv } from '@/lib/stats/ev';
import { meanInterval } from '@/lib/stats/ci';
import { theoreticalDigitProbability } from '@/lib/deriv/digits';
import type { DigitContractType } from '@/lib/deriv/contracts';
import { pValue, pct, signed, SOURCE_LABEL } from '@/lib/format';

type Tab = 'distribution' | 'dependence' | 'multiple' | 'backtest' | 'ev';

const CONTRACTS: DigitContractType[] = ['DIGITODD', 'DIGITEVEN', 'DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'];

export default function SignalsPage() {
  const s = useApp();
  const [tab, setTab] = useState<Tab>('distribution');
  const digits = s.digits;

  return (
    <div className="mx-auto max-w-[1600px] space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-prominent">
            <FlaskConical className="h-4 w-4 text-blue" /> Signal Lab
          </h2>
          <p className="text-xxs text-less-prominent">
            Statistical analysis of {digits.length} extracted digits from <span className="num text-general">{s.activeSymbol}</span>{' '}
            <Badge tone={s.dataSource === 'deriv_live' ? 'profit' : 'brand'}>{SOURCE_LABEL[s.dataSource]}</Badge>
          </p>
        </div>
        <ReportButton />
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'distribution', label: 'Distribution' },
            { value: 'dependence', label: 'Dependence' },
            { value: 'multiple', label: 'Multiple testing' },
            { value: 'backtest', label: 'Backtest' },
            { value: 'ev', label: 'EV & payout' },
          ]}
        />
      </div>

      <Banner tone="warn">
        <span className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong className="font-bold">An anomaly is not predictive power.</strong> Everything below describes the sample you have
            already collected. A distribution that deviates from uniform, or a lag correlation that clears significance, says the data is not
            a fair draw — it does <em>not</em> say the next digit is knowable. The only honest test of an edge is out-of-sample performance at
            the payout the broker actually quotes, which is what the Backtest tab is for.
          </span>
        </span>
      </Banner>

      {digits.length < 50 ? (
        <Card>
          <Empty title={`Only ${digits.length} digits buffered`}>
            Most of these tests need at least 50 observations, and a chi-square over 10 cells is not trustworthy below a few hundred. Let the
            tick stream run, or switch to a faster market (1-second indices).
          </Empty>
        </Card>
      ) : tab === 'distribution' ? (
        <DistributionTab digits={digits} />
      ) : tab === 'dependence' ? (
        <DependenceTab digits={digits} />
      ) : tab === 'multiple' ? (
        <MultipleTab digits={digits} />
      ) : tab === 'backtest' ? (
        <BacktestTab digits={digits} pipSize={s.pipSize} symbol={s.activeSymbol} />
      ) : (
        <EvTab />
      )}
    </div>
  );
}

/* ============================================================ DISTRIBUTION */

function DistributionTab({ digits }: { digits: number[] }) {
  // Recharts writes colours as SVG attributes, which cannot reference CSS custom
  // properties, so the active palette is resolved at render time exactly as the
  // shared charts do. Without this the lab kept its old dark hexes in light mode.
  const ct = useChartTheme();
  const AXIS = { fontSize: 10, fill: ct.axis } as const;
  const [rollDigit, setRollDigit] = useState(5);
  const [window, setWindow] = useState(100);

  const freq = useMemo(() => digitFrequency(digits, 0.95), [digits]);
  const chi = useMemo(() => chiSquareUniformity(digits), [digits]);
  const bins: DigitBin[] = useMemo(
    () => freq.map((f) => ({ digit: f.digit, count: f.count, pct: f.observedPct, expectedPct: f.expectedPct, ciLow: f.ciLower, ciHigh: f.ciUpper, deviation: f.deviation })),
    [freq],
  );
  const rolling = useMemo(() => rollingDigitFrequency(digits, rollDigit, window), [digits, rollDigit, window]);
  const anomalies = freq.filter((f) => f.anomalous);
  const mean = useMemo(() => meanInterval(digits, 0.95), [digits]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Sample size" value={digits.length} hint="ticks with an extracted digit" />
        <Stat label="χ² statistic" value={Number.isFinite(chi.statistic) ? chi.statistic.toFixed(2) : '—'} hint={chi.df != null ? `${chi.df} df` : 'insufficient sample'} />
        <Stat label="χ² p-value" value={pValue(chi.pValue)} tone={chi.significant ? 'warn' : 'profit'} hint={chi.significant ? 'uniformity rejected' : 'cannot reject uniformity'} />
        <Stat label="Mean digit" value={mean.mean.toFixed(3)} hint={`95% CI ${mean.lower.toFixed(3)}–${mean.upper.toFixed(3)}`} />
        <Stat label="Anomalous digits" value={anomalies.length} tone={anomalies.length ? 'warn' : undefined} hint="Wilson CI excludes 10%" />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card title="Observed digit distribution" subtitle="Bars are observed %, the dashed line is the uniform 10% expectation, and the faint bar is the Wilson 95% upper bound.">
          <DigitHistogram bins={bins} height={260} />
          <p className="mt-2 text-xxs leading-relaxed text-less-prominent">{chi.interpretation}</p>
        </Card>

        <Card title="Per-digit detail" subtitle="Wilson intervals, not normal approximations — they stay valid near 0% and 100%." pad={false}>
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full text-left text-xxs">
              <thead className="sticky top-0 bg-section-1 text-xxs tracking-wider text-less-prominent uppercase">
                <tr>
                  <th className="px-3 py-2">Digit</th>
                  <th className="px-3 py-2 text-right">Count</th>
                  <th className="px-3 py-2 text-right">Observed</th>
                  <th className="px-3 py-2 text-right">95% CI</th>
                  <th className="px-3 py-2 text-right">Dev</th>
                </tr>
              </thead>
              <tbody>
                {freq.map((f) => (
                  <tr key={f.digit} className="border-t border-line/60">
                    <td className="px-3 py-1.5">
                      <span className={`num inline-flex h-5 w-5 items-center justify-center rounded font-bold ${f.anomalous ? 'bg-loss/15 text-loss' : 'bg-section-1 text-prominent'}`}>
                        {f.digit}
                      </span>
                    </td>
                    <td className="num px-3 py-1.5 text-right text-general">{f.count}</td>
                    <td className="num px-3 py-1.5 text-right font-bold text-prominent">{f.observedPct.toFixed(2)}%</td>
                    <td className="num px-3 py-1.5 text-right text-less-prominent">{f.ciLower.toFixed(2)}–{f.ciUpper.toFixed(2)}%</td>
                    <td className={`num px-3 py-1.5 text-right ${f.deviation > 0 ? 'text-profit' : f.deviation < 0 ? 'text-loss' : 'text-less-prominent'}`}>
                      {signed(f.deviation)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-3 py-2 text-xxs leading-relaxed text-less-prominent">
            {anomalies.length === 0
              ? 'No digit\'s Wilson interval excludes 10%. The sample is consistent with a fair 1-in-10 draw.'
              : `${anomalies.length} digit(s) sit outside their Wilson interval. With 10 tests at α=0.05 you expect ~${expectedFalsePositives(10).toFixed(1)} false positives by chance alone — see Multiple testing.`}
          </div>
        </Card>
      </div>

      <Card
        title="Rolling frequency"
        subtitle="How one digit's share of a moving window evolves. Watch how much it wanders even in a fair series."
        right={
          <span className="flex items-center gap-2">
            <select value={rollDigit} onChange={(e) => setRollDigit(Number(e.target.value))} className="w-[86px] py-0.5 text-xxs">
              {Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>Digit {i}</option>)}
            </select>
            <input type="number" min={20} max={1000} step={10} value={window} onChange={(e) => setWindow(Math.max(20, Number(e.target.value)))} className="num w-[76px] py-0.5 text-xxs" />
            <span className="text-xxs text-less-prominent">window</span>
          </span>
        }
      >
        {rolling.length < 2 ? (
          <Empty title={`Need at least ${window} digits for a rolling window of ${window}`} />
        ) : (
          <>
            <div className="h-[210px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rolling} margin={{ top: 6, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid stroke={ct.grid} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="index" tick={AXIS} axisLine={false} tickLine={false} minTickGap={48} />
                  <YAxis tick={AXIS} domain={[0, 'auto']} tickFormatter={(v: number) => `${v.toFixed(0)}%`} axisLine={false} tickLine={false} width={50} />
                  <Tooltip contentStyle={{ background: ct.surface, border: `1px solid ${ct.border}`, color: ct.text, borderRadius: 4, fontSize: 11 }} formatter={(v) => [`${Number(v).toFixed(2)}%`, `digit ${rollDigit}`]} labelFormatter={(v) => `tick ${v}`} />
                  <ReferenceLine y={10} stroke={ct.accent} strokeDasharray="4 4" strokeOpacity={0.7} />
                  <Line type="monotone" dataKey="pct" stroke={ct.price} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xxs leading-relaxed text-less-prominent">
              The dashed gold line is the 10% expectation. Excursions of ±5 points around it are routine in a genuinely fair series at this
              window size — this chart is why a single “hot digit” observation is not evidence of anything.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

/* ============================================================= DEPENDENCE */

function DependenceTab({ digits }: { digits: number[] }) {
  const acf = useMemo(() => autocorrelation(digits, 8), [digits]);
  const lb = useMemo(() => ljungBox(digits, 10), [digits]);
  const runs = useMemo(() => runsTest(digits.map((d) => d % 2 === 1)), [digits]);
  const trans = useMemo(() => transitionMatrix(digits), [digits]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="Autocorrelation of the digit series" subtitle="Does a digit carry information about the digits that follow it?">
          {acf.length === 0 ? (
            <Empty title="Need at least 30 observations" />
          ) : (
            <table className="w-full text-left text-xxs">
              <thead className="text-xxs tracking-wider text-less-prominent uppercase">
                <tr><th className="py-1.5">Lag</th><th className="py-1.5 text-right">ACF</th><th className="py-1.5 text-right">95% bound</th><th className="py-1.5">Significant</th></tr>
              </thead>
              <tbody>
                {acf.map((a) => (
                  <tr key={a.lag} className="border-t border-line/60">
                    <td className="num py-1.5 text-general">{a.lag}</td>
                    <td className={`num py-1.5 text-right font-bold ${a.significant ? 'text-orange' : 'text-prominent'}`}>{a.acf.toFixed(4)}</td>
                    <td className="num py-1.5 text-right text-less-prominent">±{a.bound.toFixed(4)}</td>
                    <td className="py-1.5">{a.significant ? <Badge tone="warn">YES</Badge> : <Badge tone="neutral">no</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xxs leading-relaxed text-less-prominent">
            With 8 lags tested, roughly {expectedFalsePositives(8).toFixed(1)} are expected to look significant at α=0.05 by chance. Judge the
            set of lags together — that is what Ljung-Box does.
          </p>
        </Card>

        <div className="space-y-3">
          <TestCard result={lb} note="Tests all lags jointly. A significant result means the series is not white noise — it does not identify a tradeable rule." />
          <TestCard
            result={runs}
            note="Counts runs of odd/even. Too few runs implies clustering; too many implies alternation. Either is a departure from independence, not a forecast."
          />
        </div>
      </div>

      <Card
        title="Transition matrix"
        subtitle="P(next digit = column | current digit = row), estimated from the sample."
        right={<Badge tone={trans.significant ? 'warn' : 'neutral'}>χ² p={pValue(trans.pValue)}</Badge>}
      >
        <div className="overflow-auto">
          <table className="w-full border-separate border-spacing-px text-xxs">
            <thead>
              <tr>
                <th className="px-1 py-1 text-left text-xxs text-less-prominent">from↓ to→</th>
                {Array.from({ length: 10 }, (_, j) => <th key={j} className="num px-1 py-1 text-center text-less-prominent">{j}</th>)}
              </tr>
            </thead>
            <tbody>
              {trans.matrix.map((row, i) => (
                <tr key={i}>
                  <td className="num px-1 py-1 text-right font-bold text-less-prominent">{i}</td>
                  {row.map((p, j) => (
                    <td
                      key={j}
                      className="num px-1 py-1 text-center"
                      style={{
                        background: p > 0.1 ? `rgba(234,57,67,${Math.min(0.62, (p - 0.1) * 4)})` : p < 0.1 ? `rgba(59,130,246,${Math.min(0.5, (0.1 - p) * 4)})` : 'transparent',
                        color: 'var(--color-prominent)',
                      }}
                      title={`P(${j} | ${i}) = ${(p * 100).toFixed(2)}%`}
                    >
                      {(p * 100).toFixed(1)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
          <Stat label="χ² statistic" value={Number.isFinite(trans.chiSquare) ? trans.chiSquare.toFixed(2) : '—'} hint={`${trans.df} df · ${trans.sampleSize} pairs`} />
          <Stat label="p-value" value={pValue(trans.pValue)} tone={trans.significant ? 'warn' : 'profit'} />
          <Stat label="Cramér's V" value={trans.cramersV.toFixed(4)} tone={trans.cramersV > 0.1 ? 'warn' : undefined} hint="effect size, 0 = no association" />
        </div>
        <p className="mt-2 text-xxs leading-relaxed text-less-prominent">{trans.interpretation}</p>
        <Banner tone="info" className="mt-2">
          A 10×10 transition matrix estimates 90 free probabilities from your sample. Even with 1,000 digits that is roughly 10 observations per
          cell, and the χ² approximation is thin at that density. Treat a significant result here as a prompt to collect far more data, not as a
          finding.
        </Banner>
      </Card>
    </div>
  );
}

function TestCard({ result, note }: { result: TestResult; note: string }) {
  const usable = Number.isFinite(result.pValue);
  return (
    <Card
      title={result.name}
      subtitle={`n = ${result.sampleSize}`}
      right={usable ? <Badge tone={result.significant ? 'warn' : 'profit'}>{result.significant ? 'SIGNIFICANT' : 'NOT SIGNIFICANT'}</Badge> : <Badge tone="neutral">INSUFFICIENT</Badge>}
    >
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Statistic" value={usable ? result.statistic.toFixed(3) : '—'} />
        <Stat label="p-value" value={usable ? pValue(result.pValue) : '—'} tone={result.significant ? 'warn' : undefined} />
      </div>
      <p className="mt-2 text-xxs leading-relaxed text-less-prominent">{result.interpretation}</p>
      <p className="mt-1.5 text-xxs leading-relaxed text-less-prominent">{note}</p>
    </Card>
  );
}

/* ========================================================= MULTIPLE TESTING */

function MultipleTab({ digits }: { digits: number[] }) {
  const [method, setMethod] = useState<CorrectionMethod>('holm');
  const [alpha, setAlpha] = useState(0.05);

  const items = useMemo(() => {
    const out: { label: string; pValue: number }[] = [];
    const chi = chiSquareUniformity(digits);
    if (Number.isFinite(chi.pValue)) out.push({ label: 'χ² uniformity (all digits)', pValue: chi.pValue });
    const lb = ljungBox(digits, 10);
    if (Number.isFinite(lb.pValue)) out.push({ label: 'Ljung-Box portmanteau', pValue: lb.pValue });
    const runs = runsTest(digits.map((d) => d % 2 === 1));
    if (Number.isFinite(runs.pValue)) out.push({ label: 'Runs test (odd/even)', pValue: runs.pValue });
    const trans = transitionMatrix(digits);
    if (Number.isFinite(trans.pValue)) out.push({ label: 'Transition matrix χ²', pValue: trans.pValue });
    const counts = new Array(10).fill(0);
    for (const d of digits) if (d >= 0 && d <= 9) counts[d]++;
    const valid = counts.reduce((a: number, b: number) => a + b, 0);
    counts.forEach((c: number, i: number) => {
      const t = proportionTest(c, valid, 0.1);
      if (Number.isFinite(t.pValue)) out.push({ label: `Digit ${i} vs 10%`, pValue: t.pValue });
    });
    return out;
  }, [digits]);

  const corrected = useMemo(() => correctLabeled(items, method, alpha), [items, method, alpha]);
  const rawSig = items.filter((i) => i.pValue < alpha).length;
  const adjSig = corrected.filter((c) => c.significant).length;
  const efp = expectedFalsePositives(items.length, alpha);

  return (
    <div className="space-y-3">
      <Banner tone="info">
        <span className="flex items-start gap-2">
          <Sigma className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Running {items.length} tests at α={alpha} produces about <strong className="num">{efp.toFixed(2)}</strong> false positives by
            chance alone, even on perfectly fair data. This is the multiple-comparisons problem, and it is the reason a “signal” found by
            scanning ten digits usually evaporates. Corrections below control that error rate.
          </span>
        </span>
      </Banner>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tests run" value={items.length} hint={`α = ${alpha}`} />
        <Stat label="Significant (uncorrected)" value={rawSig} tone={rawSig > 0 ? 'warn' : 'profit'} hint={`expected by chance ≈ ${efp.toFixed(2)}`} />
        <Stat label={`Significant (${method})`} value={adjSig} tone={adjSig > 0 ? 'warn' : 'profit'} hint="after correction" />
        <Stat
          label="Family-wise interpretation"
          value={adjSig === 0 ? 'NO EDGE' : 'REVIEW'}
          tone={adjSig === 0 ? 'profit' : 'warn'}
          hint={adjSig === 0 ? 'nothing survives correction' : 'survives, but verify out-of-sample'}
        />
      </div>

      <Card
        title="Corrected p-values"
        subtitle="Uncorrected and adjusted side by side, so the effect of the correction is visible rather than hidden."
        right={
          <span className="flex items-center gap-2">
            <Segmented
              value={method}
              onChange={setMethod}
              options={[
                { value: 'holm', label: 'Holm' },
                { value: 'benjamini_hochberg', label: 'BH (FDR)' },
                { value: 'bonferroni', label: 'Bonferroni' },
                { value: 'none', label: 'None' },
              ]}
            />
            <select value={alpha} onChange={(e) => setAlpha(Number(e.target.value))} className="w-[80px] py-0.5 text-xxs">
              <option value={0.01}>α 0.01</option>
              <option value={0.05}>α 0.05</option>
              <option value={0.1}>α 0.10</option>
            </select>
          </span>
        }
        pad={false}
      >
        <table className="w-full text-left text-xxs">
          <thead className="bg-section-1 text-xxs tracking-wider text-less-prominent uppercase">
            <tr>
              <th className="px-3 py-2">Test</th>
              <th className="px-3 py-2 text-right">Raw p</th>
              <th className="px-3 py-2 text-right">Adjusted p</th>
              <th className="px-3 py-2 text-center">Raw sig</th>
              <th className="px-3 py-2 text-center">Adjusted sig</th>
              <th className="px-3 py-2">Change</th>
            </tr>
          </thead>
          <tbody>
            {corrected.map((c) => {
              const rawSig = c.pValue < alpha;
              const flipped = rawSig && !c.significant;
              return (
                <tr key={c.label} className={`border-t border-line/60 ${flipped ? 'bg-warn/5' : ''}`}>
                  <td className="px-3 py-1.5 text-general">{c.label}</td>
                  <td className="num px-3 py-1.5 text-right text-less-prominent">{pValue(c.pValue)}</td>
                  <td className={`num px-3 py-1.5 text-right font-bold ${c.significant ? 'text-orange' : 'text-prominent'}`}>{pValue(c.adjustedP)}</td>
                  <td className="px-3 py-1.5 text-center">{rawSig ? <Badge tone="warn">YES</Badge> : <span className="text-less-prominent">no</span>}</td>
                  <td className="px-3 py-1.5 text-center">{c.significant ? <Badge tone="warn">YES</Badge> : <Badge tone="neutral">no</Badge>}</td>
                  <td className="px-3 py-1.5 text-xxs">
                    {flipped ? <span className="text-orange">was significant, no longer</span> : <span className="text-less-prominent">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card title="Which correction, and why" subtitle="They control different error rates and none of them is universally right.">
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3 text-xxs leading-relaxed">
          <div className="rounded border border-line bg-section-1 p-3">
            <div className="mb-1 font-bold text-prominent">Holm (default here)</div>
            <p className="text-less-prominent">
              Controls the <strong>family-wise error rate</strong> — the probability of <em>any</em> false positive. Step-down, uniformly more
              powerful than Bonferroni at the same FWER. Use it when a single false claim would be costly.
            </p>
          </div>
          <div className="rounded border border-line bg-section-1 p-3">
            <div className="mb-1 font-bold text-prominent">Benjamini–Hochberg</div>
            <p className="text-less-prominent">
              Controls the <strong>false discovery rate</strong> — the expected proportion of false positives among the discoveries. Less
              strict, better when you are screening many candidates and can tolerate some noise.
            </p>
          </div>
          <div className="rounded border border-line bg-section-1 p-3">
            <div className="mb-1 font-bold text-prominent">Bonferroni</div>
            <p className="text-less-prominent">
              Simply multiplies by the number of tests. Valid and easy to explain, but conservative — with 14 tests it demands p &lt; 0.0036
              and will miss real effects.
            </p>
          </div>
        </div>
        <Banner tone="warn" className="mt-2.5">
          <strong className="font-bold">A correction does not create an edge.</strong> It reduces the chance you fool yourself. If nothing
          survives correction, the honest conclusion is that this sample shows no departure from fair randomness — not that a cleverer test
          would find one.
        </Banner>
      </Card>
    </div>
  );
}

/* ============================================================== BACKTEST */

function BacktestTab({ digits, pipSize, symbol }: { digits: number[]; pipSize: number; symbol: string }) {
  const s = useApp();
  const strategy = s.strategies.find((x) => x.id === s.activeStrategyId) ?? s.strategies[0] ?? null;
  const [payout, setPayout] = useState(1.95);
  const [holdout, setHoldout] = useState(0.3);
  // Backtests hold a fixed cooldown; there is no UI control for it yet, so the setter is unused.
  const [cooldown] = useState(2);
  const [contractType, setContractType] = useState<DigitContractType>((strategy?.contractType as DigitContractType) ?? 'DIGITODD');
  const [barrier, setBarrier] = useState<number>(strategy?.barrier ?? 5);

  const result = useMemo(() => {
    if (!strategy || digits.length < 100) return null;
    try {
      return backtest({
        digits,
        symbol,
        pipSize,
        entry: strategy.entry,
        contractType,
        barrier: contractType === 'DIGITODD' || contractType === 'DIGITEVEN' ? undefined : barrier,
        stake: strategy.stake,
        payoutMultiplier: payout,
        holdoutFraction: holdout,
        cooldownTicks: cooldown,
      });
    } catch {
      return null;
    }
  }, [strategy, digits, symbol, pipSize, contractType, barrier, payout, holdout, cooldown]);

  if (!strategy) {
    return (
      <Card>
        <Empty title="No strategy to backtest">
          Create and save one in <strong>Bot Builder</strong> first. The backtest evaluates the strategy’s actual entry gate against the digit
          series — there is nothing to evaluate without it.
        </Empty>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card title="Backtest configuration" subtitle="Run the saved strategy's entry gate over the collected digits, with an out-of-sample holdout.">
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
          <Field label="Strategy">
            <select value={strategy.id} onChange={(e) => s.setActiveStrategy(e.target.value)}>
              {s.strategies.map((x) => <option key={x.id} value={x.id}>{x.name} v{x.version}</option>)}
            </select>
          </Field>
          <Field label="Contract type">
            <select value={contractType} onChange={(e) => setContractType(e.target.value as DigitContractType)}>
              {CONTRACTS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Barrier" hint="ignored for odd/even">
            <input type="number" min={0} max={9} step={1} value={barrier} onChange={(e) => setBarrier(Number(e.target.value))} className="num" disabled={contractType === 'DIGITODD' || contractType === 'DIGITEVEN'} />
          </Field>
          <Field label="Payout multiplier" hint="Use the number Deriv actually quotes — never an assumed 2×.">
            <input type="number" min={0} max={100} step={0.01} value={payout} onChange={(e) => setPayout(Number(e.target.value))} className="num" />
          </Field>
          <Field label="Holdout fraction">
            <input type="number" min={0.05} max={0.9} step={0.05} value={holdout} onChange={(e) => setHoldout(Number(e.target.value))} className="num" />
          </Field>
        </div>
        <Banner tone="warn" className="mt-2.5">
          <Percent className="mr-1 inline h-3.5 w-3.5" />
          At a payout of <strong className="num">{payout.toFixed(2)}×</strong>, the break-even win probability is{' '}
          <strong className="num">{pct(1 / payout, 2)}</strong>. The theoretical win probability for {contractType} is{' '}
          <strong className="num">{pct(theoreticalDigitProbability(contractType, barrier), 2)}</strong>. If the second number is below the
          first, the contract loses money on average no matter how good the entry gate looks.
        </Banner>
      </Card>

      {!result ? (
        <Card>
          <Empty title={`Need at least 100 digits (have ${digits.length})`}>
            A backtest on fewer observations than this produces numbers that look precise and mean nothing.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <SegmentCard seg={result.inSample} accent="info" />
            <SegmentCard seg={result.outOfSample} accent="brand" emphasis />
            <SegmentCard seg={result.full} accent="neutral" />
          </div>

          {result.outOfSample.degraded && (
            <Banner tone="danger">
              <strong className="font-bold">Out-of-sample degradation detected.</strong> Expected value per trade on the holdout fell
              materially below the in-sample figure ({pct(result.outOfSample.ev.evPctOfStake, 2)} vs{' '}
              {pct(result.inSample.ev.evPctOfStake, 2)} of stake). That is the classic signature of a pattern fitted to noise. Do not trade
              this on the strength of the in-sample number.
            </Banner>
          )}
          {!result.outOfSample.degraded && result.outOfSample.trades >= 20 && (
            <Banner tone="success">
              The holdout’s expected value held up relative to in-sample. That is necessary but not sufficient: it says the behaviour is
              stable across this particular split, not that it will persist in future data or survive real spreads, payout movement and
              execution latency.
            </Banner>
          )}

          <Card title="What this backtest does and does not show" subtitle="Generated from the run itself, not boilerplate." pad={false}>
            <ul className="space-y-1.5 p-4 text-xxs leading-relaxed text-general">
              {result.honesty.map((h, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-coral" />
                  {h}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

function SegmentCard({ seg, accent, emphasis }: { seg: ReturnType<typeof backtest>['inSample']; accent: 'info' | 'brand' | 'neutral'; emphasis?: boolean }) {
  const tone = accent === 'brand' ? 'brand' : accent === 'info' ? 'info' : 'neutral';
  return (
    <Card
      title={seg.label === 'out-of-sample' ? 'Out-of-sample (holdout)' : seg.label === 'in-sample' ? 'In-sample' : 'Full sample'}
      subtitle={`${seg.trades} trades triggered`}
      right={<Badge tone={tone as 'info'}>{emphasis ? 'THE NUMBER THAT COUNTS' : seg.label.toUpperCase()}</Badge>}
      className={emphasis ? 'ring-1 ring-brand/25' : undefined}
    >
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Win rate" value={seg.trades ? pct(seg.winRate, 1) : '—'} tone={seg.winRate >= seg.ev.breakEvenProbability ? 'profit' : 'loss'} hint={`${seg.wins}W / ${seg.losses}L`} />
        <Stat label="Net P/L" value={signed(seg.netProfit)} tone={seg.netProfit >= 0 ? 'profit' : 'loss'} />
        <Stat label="EV / trade" value={seg.trades ? signed(seg.ev.evPerTrade, 4) : '—'} tone={seg.ev.evPerTrade >= 0 ? 'profit' : 'loss'} hint={`${pct(seg.ev.evPctOfStake, 2)} of stake`} />
        <Stat label="Max drawdown" value={seg.maxDrawdown.toFixed(2)} tone="warn" hint={pct(seg.maxDrawdownPct, 1)} />
      </div>
      <div className="mt-2 rounded border border-line bg-section-1 px-2.5 py-2 text-xxs leading-relaxed text-less-prominent">
        Break-even win probability at this payout: <strong className="num text-prominent">{pct(seg.ev.breakEvenProbability, 2)}</strong>. Observed:{' '}
        <strong className={`num ${seg.winRate >= seg.ev.breakEvenProbability ? 'text-profit' : 'text-loss'}`}>{pct(seg.winRate, 2)}</strong>.{' '}
        {seg.ev.verdict}
      </div>
    </Card>
  );
}

/* ================================================================ EV & PAYOUT */

function EvTab() {
  const [stake, setStake] = useState(1);
  const [payouts, setPayouts] = useState<Record<string, number>>({
    DIGITODD: 1.96, DIGITEVEN: 1.96, DIGITOVER: 1.96, DIGITUNDER: 1.96, DIGITMATCH: 9.6, DIGITDIFF: 1.06,
  });
  const [barrier, setBarrier] = useState(5);

  const rows = CONTRACTS.map((ct) => ({
    ct,
    payout: payouts[ct] ?? 0,
    ev: theoreticalEv(ct, stake, stake * (payouts[ct] ?? 0), ct === 'DIGITOVER' || ct === 'DIGITUNDER' || ct === 'DIGITMATCH' || ct === 'DIGITDIFF' ? barrier : undefined),
  }));

  // Observed EV uses the REAL mean payout of settled trades, not an assumed multiplier.
  const observed = useApp((s) => {
    const t = s.trades.filter((x) => !x.error && x.payout > 0);
    if (!t.length) return null;
    const meanPayout = t.reduce((a, x) => a + x.payout, 0) / t.length;
    const meanStake = t.reduce((a, x) => a + x.stake, 0) / t.length;
    return {
      count: t.length,
      wins: t.filter((x) => x.won).length,
      meanPayout,
      meanStake,
      ev: expectedValue(t.filter((x) => x.won).length / t.length, meanStake, meanPayout),
    };
  });

  return (
    <div className="space-y-3">
      <Banner tone="info">
        <span className="flex items-start gap-2">
          <Beaker className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Every digit contract is a fixed-odds bet, so its expected value is fully determined by the win probability and the payout the
            broker quotes. The defaults below are <strong>illustrative</strong>; replace them with a live proposal before trusting any figure.
            A high win rate is not a profit — DIGITDIFF wins 90% of the time and still loses money below a 1.11× payout.
          </span>
        </span>
      </Banner>

      <Card
        title="Payout-aware expected value"
        subtitle="EV computed from the theoretical win probability of each contract type and the payout you enter."
        right={
          <span className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xxs text-less-prominent">
              stake
              <input type="number" min={0.35} step={0.05} value={stake} onChange={(e) => setStake(Number(e.target.value))} className="num w-[72px] py-0.5 text-xxs" />
            </label>
            <label className="flex items-center gap-1.5 text-xxs text-less-prominent">
              barrier
              <input type="number" min={0} max={9} step={1} value={barrier} onChange={(e) => setBarrier(Number(e.target.value))} className="num w-[56px] py-0.5 text-xxs" />
            </label>
          </span>
        }
        pad={false}
      >
        <table className="w-full text-left text-xxs">
          <thead className="bg-section-1 text-xxs tracking-wider text-less-prominent uppercase">
            <tr>
              <th className="px-3 py-2">Contract</th>
              <th className="px-3 py-2 text-right">Win p (theoretical)</th>
              <th className="px-3 py-2 text-right">Break-even p</th>
              <th className="px-3 py-2 text-right">Payout ×</th>
              <th className="px-3 py-2 text-right">EV / trade</th>
              <th className="px-3 py-2 text-right">EV % of stake</th>
              <th className="px-3 py-2">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ct} className="border-t border-line/60 hover:bg-state-hover/40">
                <td className="num px-3 py-2 font-bold text-prominent">{r.ct}</td>
                <td className="num px-3 py-2 text-right text-general">{pct(r.ev.winProbability, 1)}</td>
                <td className="num px-3 py-2 text-right text-less-prominent">{pct(r.ev.breakEvenProbability, 2)}</td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number" min={0} max={100} step={0.01} value={r.payout}
                    onChange={(e) => setPayouts((p) => ({ ...p, [r.ct]: Number(e.target.value) }))}
                    className="num w-[70px] py-0.5 text-right text-xxs"
                  />
                </td>
                <td className={`num px-3 py-2 text-right font-bold ${r.ev.evPerTrade >= 0 ? 'text-profit' : 'text-loss'}`}>{signed(r.ev.evPerTrade, 4)}</td>
                <td className={`num px-3 py-2 text-right ${r.ev.evPctOfStake >= 0 ? 'text-profit' : 'text-loss'}`}>{pct(r.ev.evPctOfStake, 2)}</td>
                <td className="px-3 py-2">
                  <Badge tone={r.ev.edge > 0 ? 'profit' : r.ev.edge === 0 ? 'neutral' : 'loss'}>{r.ev.edge > 0 ? 'POSITIVE' : r.ev.edge === 0 ? 'FAIR' : 'NEGATIVE'}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Observed EV from your own trade history" subtitle="Computed from settled trades actually recorded in this browser, using their real payouts.">
        {observed ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Stat label="Settled trades" value={observed.count} hint={`${observed.wins} wins`} />
            <Stat label="Observed win rate" value={pct(observed.ev.winProbability, 1)} tone={observed.ev.winProbability >= 0.5 ? 'profit' : 'loss'} />
            <Stat label="Mean payout / stake" value={(observed.meanPayout / (observed.meanStake || 1)).toFixed(3)} hint={`stake ${observed.meanStake.toFixed(2)} → payout ${observed.meanPayout.toFixed(2)}`} />
            <Stat label="Observed EV / trade" value={signed(observed.ev.evPerTrade, 4)} tone={observed.ev.evPerTrade >= 0 ? 'profit' : 'loss'} hint={pct(observed.ev.evPctOfStake, 2)} />
            <Stat label="Verdict" value={observed.ev.edge > 0 ? 'EDGE' : 'NO EDGE'} tone={observed.ev.edge > 0 ? 'profit' : 'loss'} hint={observed.ev.verdict} />
          </div>
        ) : (
          <Empty title="No settled trades yet">
            Run a strategy first. Observed EV is calculated from real payouts on real settlements — it is never inferred from an assumed
            multiple.
          </Empty>
        )}
        <Banner tone="warn" className="mt-2.5">
          An observed EV from a small number of trades is noise-dominated. With 30 trades at a 50% win rate, the 95% confidence interval on the
          win rate spans roughly 32%–68%, which is wide enough to cover both a strong edge and a heavy loss. Collect hundreds of settlements
          before reading anything into this.
        </Banner>
      </Card>
    </div>
  );
}

/* ================================================================== REPORT */

export function useSignalReport() {
  const s = useApp();
  return useMemo(() => {
    const digits = s.digits;
    if (digits.length < 50) return null;
    const chi = chiSquareUniformity(digits);
    const lb = ljungBox(digits, 10);
    const runs = runsTest(digits.map((d) => d % 2 === 1));
    const trans = transitionMatrix(digits);
    const items = [
      { label: 'chi-square uniformity', pValue: chi.pValue },
      { label: 'Ljung-Box', pValue: lb.pValue },
      { label: 'runs test', pValue: runs.pValue },
      { label: 'transition matrix', pValue: trans.pValue },
    ].filter((i) => Number.isFinite(i.pValue));
    const holm = correctLabeled(items, 'holm', 0.05);
    const bh = correctLabeled(items, 'benjamini_hochberg', 0.05);
    return { digits, chi, lb, runs, trans, holm, bh, efp: expectedFalsePositives(items.length, 0.05) };
  }, [s.digits]);
}

export function ReportButton() {
  const s = useApp();
  const report = useSignalReport();

  function download() {
    if (!report) return;
    const lines: string[] = [];
    lines.push('UltraTrading360 — Signal Lab report');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Market: ${s.activeSymbol}   Data source: ${s.dataSource}   Mode: ${s.settings.mode}`);
    lines.push(`Sample: ${report.digits.length} digits, pip_size ${s.pipSize}`);
    lines.push('');
    lines.push('GOODNESS OF FIT');
    lines.push(`  chi-square uniformity: statistic=${report.chi.statistic.toFixed(4)} df=${report.chi.df} p=${pValue(report.chi.pValue)}`);
    lines.push(`  ${report.chi.interpretation}`);
    lines.push('');
    lines.push('DEPENDENCE');
    lines.push(`  Ljung-Box: statistic=${report.lb.statistic.toFixed(4)} p=${pValue(report.lb.pValue)}`);
    lines.push(`  ${report.lb.interpretation}`);
    lines.push(`  Runs test: statistic=${report.runs.statistic.toFixed(4)} p=${pValue(report.runs.pValue)}`);
    lines.push(`  ${report.runs.interpretation}`);
    lines.push(`  Transition matrix: chi2=${report.trans.chiSquare.toFixed(4)} df=${report.trans.df} p=${pValue(report.trans.pValue)} CramersV=${report.trans.cramersV.toFixed(4)}`);
    lines.push(`  ${report.trans.interpretation}`);
    lines.push('');
    lines.push('MULTIPLE TESTING');
    lines.push(`  Tests: ${report.holm.length}   Expected false positives at alpha=0.05: ${report.efp.toFixed(2)}`);
    report.holm.forEach((h, i) => {
      lines.push(`  ${h.label}: raw=${pValue(h.pValue)} holm=${pValue(h.adjustedP)} sig=${h.significant} bh=${pValue(report.bh[i].adjustedP)}`);
    });
    lines.push('');
    lines.push('DIGIT FREQUENCY (observed %, Wilson 95% CI)');
    digitFrequency(report.digits, 0.95).forEach((f) => {
      lines.push(`  ${f.digit}: n=${f.count} ${f.observedPct.toFixed(2)}% [${f.ciLower.toFixed(2)}, ${f.ciUpper.toFixed(2)}] dev=${signed(f.deviation)} anomalous=${f.anomalous}`);
    });
    lines.push('');
    lines.push('INTERPRETATION');
    lines.push('  A departure from uniformity is evidence about the SAMPLE, not a forecast of the next tick.');
    lines.push('  Predictive power can only be assessed out-of-sample at the payout the broker quotes.');
    lines.push('  No figure in this report constitutes a trading edge on its own.');
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signal-report-${s.activeSymbol}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    s.pushLog('ok', 'Signal Lab report exported.');
  }

  return (
    <Button variant="outline" size="sm" disabled={!report} onClick={download}>
      <Download className="h-3 w-3" /> Export report
    </Button>
  );
}
