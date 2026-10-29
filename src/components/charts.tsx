'use client';

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/cn';
import type { Quote } from '@/lib/engine/provider';

const AXIS = { fontSize: 10, fill: '#6c7789' } as const;
const GRID = '#1f2733';

/**
 * Live price chart. Renders only the tail of the buffer — a full 1200-point series re-renders
 * every tick and visibly stalls on slower machines, so the window is capped.
 */
export function TickChart({ quotes, points = 180, className }: { quotes: Quote[]; points?: number; className?: string }) {
  const data = useMemo(() => {
    const tail = quotes.slice(-points);
    const first = tail.length ? tail[0].epoch : 0;
    return tail.map((q) => ({ t: q.epoch - first, p: q.price, d: q.digit }));
  }, [quotes, points]);

  if (data.length < 2) {
    return <div className={cn('flex h-full items-center justify-center text-[11px] text-ink-4', className)}>Collecting ticks…</div>;
  }

  return (
    <div className={cn('h-full w-full', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="t" tick={AXIS} tickFormatter={(v: number) => `${v}s`} minTickGap={48} axisLine={false} tickLine={false} />
          <YAxis
            tick={AXIS}
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => v.toFixed(2)}
            axisLine={false}
            tickLine={false}
            width={58}
          />
          <Tooltip
            contentStyle={{ background: '#141922', border: '1px solid #2c3644', borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: '#6c7789' }}
            labelFormatter={(v) => `t + ${Number(v)}s`}
            formatter={(v) => [Number(v).toFixed(4), 'price']}
          />
          <Area type="monotone" dataKey="p" stroke="#22d3ee" strokeWidth={1.6} fill="url(#priceFill)" isAnimationActive={false} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Rolling strip of the last N extracted digits, coloured by parity. */
export function DigitStrip({ digits, count = 40, className }: { digits: number[]; count?: number; className?: string }) {
  const tail = useMemo(() => digits.slice(-count), [digits, count]);
  if (tail.length === 0) {
    return <div className={cn('flex h-full items-center justify-center text-[11px] text-ink-4', className)}>No digits yet</div>;
  }
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {tail.map((d, i) => (
        <span
          key={`${i}-${d}`}
          className={cn(
            'num flex h-6 w-6 items-center justify-center rounded-md border text-[12px] font-bold',
            i === tail.length - 1 && 'ring-1 ring-brand/60',
            d % 2 === 0 ? 'border-accent/30 bg-accent/8 text-accent' : 'border-brand/30 bg-brand/8 text-brand',
          )}
          title={i === tail.length - 1 ? 'most recent digit' : undefined}
        >
          {d}
        </span>
      ))}
    </div>
  );
}

export interface DigitBin {
  digit: number;
  count: number;
  pct: number;
  expectedPct: number;
  ciLow: number;
  ciHigh: number;
  deviation: number;
}

/**
 * Observed digit distribution against the uniform expectation.
 *
 * The expected band is the Wilson 95% interval for a true probability of 0.1, NOT a claim about
 * the next tick. Bars inside the band are exactly what a fair 1-in-10 draw produces; bars outside
 * it are flagged as an anomaly in the sample, which is a different (and weaker) statement than
 * "this digit will keep happening".
 */
export function DigitHistogram({ bins, className, height = 190 }: { bins: DigitBin[]; className?: string; height?: number }) {
  if (bins.length === 0) {
    return <div className={cn('flex items-center justify-center text-[11px] text-ink-4', className)} style={{ height }}>No sample yet</div>;
  }
  const max = Math.max(...bins.map((b) => Math.max(b.ciHigh, b.pct))) * 1.18;
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bins} margin={{ top: 6, right: 6, bottom: 0, left: -22 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="digit" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis
            tick={AXIS}
            domain={[0, max]}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.03)' }}
            contentStyle={{ background: '#141922', border: '1px solid #2c3644', borderRadius: 8, fontSize: 11 }}
            labelFormatter={(v) => `Digit ${v}`}
            formatter={(v, name) => [`${Number(v).toFixed(2)}%`, String(name)]}
          />
          <ReferenceLine y={10} stroke="#f0b90b" strokeDasharray="4 4" strokeOpacity={0.55} />
          <Bar dataKey="pct" name="observed" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {bins.map((b) => (
              <Cell
                key={b.digit}
                fill={b.pct > b.ciHigh ? '#ea3943' : b.pct < b.ciLow ? '#3b82f6' : '#16c784'}
                fillOpacity={0.85}
              />
            ))}
          </Bar>
          <Bar dataKey="ciHigh" name="95% upper" fill="#ffffff" fillOpacity={0.08} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Equity curve from a trade list. Drawdown is shaded, not just annotated. */
export function EquityCurve({
  trades,
  startingBalance,
  className,
  height = 200,
}: {
  trades: { profit: number; closedAt: number }[];
  startingBalance: number;
  className?: string;
  height?: number;
}) {
  const data = useMemo(() => {
    let eq = startingBalance;
    let peak = startingBalance;
    const out: { i: number; equity: number; dd: number }[] = [{ i: 0, equity: eq, dd: 0 }];
    trades
      .slice()
      .sort((a, b) => a.closedAt - b.closedAt)
      .forEach((t, idx) => {
        eq += t.profit;
        peak = Math.max(peak, eq);
        out.push({ i: idx + 1, equity: Number(eq.toFixed(2)), dd: Number((eq - peak).toFixed(2)) });
      });
    return out;
  }, [trades, startingBalance]);

  if (data.length < 2) {
    return <div className={cn('flex items-center justify-center text-[11px] text-ink-4', className)} style={{ height }}>No trades recorded yet</div>;
  }

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="i" tick={AXIS} axisLine={false} tickLine={false} minTickGap={40} />
          <YAxis tick={AXIS} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(0)} axisLine={false} tickLine={false} width={54} />
          <Tooltip
            contentStyle={{ background: '#141922', border: '1px solid #2c3644', borderRadius: 8, fontSize: 11 }}
            labelFormatter={(v) => `Trade #${v}`}
            formatter={(v, name) => [Number(v).toFixed(2), String(name)]}
          />
          <ReferenceLine y={startingBalance} stroke="#6c7789" strokeDasharray="3 3" strokeOpacity={0.6} />
          <Line type="monotone" dataKey="equity" stroke="#16c784" strokeWidth={1.6} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="dd" stroke="#ea3943" strokeWidth={1.1} strokeDasharray="3 2" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
