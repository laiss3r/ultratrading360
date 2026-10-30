'use client';

import { useEffect, useId, useMemo, useState } from 'react';
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
import { useApp } from '@/state/store';

/**
 * Resolved chart colours.
 *
 * SVG presentation attributes do not accept `var(--token)` — only CSS properties do — and
 * Recharts writes these values as attributes. So the tokens are read back out of the computed
 * style of <html> whenever the theme changes, which keeps the charts correct in both light and
 * dark without duplicating the palette here.
 */
interface ChartTheme {
  axis: string;
  grid: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  price: string;
  profit: string;
  loss: string;
  info: string;
  accent: string;
}

const FALLBACK: ChartTheme = {
  axis: '#999999',
  grid: '#d6dadb',
  surface: '#ffffff',
  border: '#d6dadb',
  text: '#333333',
  muted: '#999999',
  price: '#377cfc',
  profit: '#4bb4b3',
  loss: '#ec3f3f',
  info: '#377cfc',
  accent: '#ff6444',
};

const TOKEN_MAP: Record<keyof ChartTheme, string> = {
  axis: '--color-less-prominent',
  grid: '--color-border-normal',
  surface: '--color-main-1',
  border: '--color-border-normal',
  text: '--color-prominent',
  muted: '--color-less-prominent',
  price: '--color-blue',
  profit: '--color-profit',
  loss: '--color-loss',
  info: '--color-blue',
  accent: '--color-orange',
};

/** Exported because page-level Recharts outside this module need the same resolved tokens. */
export function useChartTheme(): ChartTheme {
  const uiTheme = useApp((s) => s.settings.uiTheme);
  const [theme, setTheme] = useState<ChartTheme>(FALLBACK);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const next = { ...FALLBACK };
      (Object.keys(TOKEN_MAP) as (keyof ChartTheme)[]).forEach((k) => {
        const v = cs.getPropertyValue(TOKEN_MAP[k]).trim();
        if (v) next[k] = v;
      });
      setTheme(next);
    };
    // Read after the attribute has been applied by the shell, on the next frame.
    const raf = requestAnimationFrame(read);
    return () => cancelAnimationFrame(raf);
  }, [uiTheme]);

  return theme;
}

/**
 * Live price chart. Renders only the tail of the buffer — a full 1200-point series re-renders
 * every tick and visibly stalls on slower machines, so the window is capped.
 */
export function TickChart({ quotes, points = 180, className }: { quotes: Quote[]; points?: number; className?: string }) {
  const t = useChartTheme();
  // useId, not Math.random: React treats a component as pure, and a random id
  // generated during render would change on every re-render (and the compiler
  // rejects it outright). The id is sanitised because useId's raw form contains
  // characters that are awkward inside an SVG url(#...) reference.
  const rawId = useId();
  const gradientId = useMemo(() => `priceFill-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`, [rawId]);
  const data = useMemo(() => {
    const tail = quotes.slice(-points);
    const first = tail.length ? tail[0].epoch : 0;
    return tail.map((q) => ({ t: q.epoch - first, p: q.price, d: q.digit }));
  }, [quotes, points]);

  const axis = { fontSize: 10, fill: t.axis } as const;

  if (data.length < 2) {
    return <div className={cn('flex h-full items-center justify-center text-xs text-less-prominent', className)}>Collecting ticks…</div>;
  }

  return (
    <div className={cn('h-full w-full', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={t.price} stopOpacity={0.22} />
              <stop offset="100%" stopColor={t.price} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={t.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="t" tick={axis} tickFormatter={(v: number) => `${v}s`} minTickGap={48} axisLine={false} tickLine={false} />
          <YAxis tick={axis} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(2)} axisLine={false} tickLine={false} width={58} />
          <Tooltip
            contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 4, fontSize: 11, color: t.text }}
            labelStyle={{ color: t.muted }}
            labelFormatter={(v) => `t + ${Number(v)}s`}
            formatter={(v) => [Number(v).toFixed(4), 'price']}
          />
          <Area type="monotone" dataKey="p" stroke={t.price} strokeWidth={1.6} fill={`url(#${gradientId})`} isAnimationActive={false} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Rolling strip of the last N extracted digits, coloured by parity. */
export function DigitStrip({ digits, count = 40, className }: { digits: number[]; count?: number; className?: string }) {
  const tail = useMemo(() => digits.slice(-count), [digits, count]);
  if (tail.length === 0) {
    return <div className={cn('flex h-full items-center justify-center text-xs text-less-prominent', className)}>No digits yet</div>;
  }
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {tail.map((d, i) => (
        <span
          key={`${i}-${d}`}
          className={cn(
            'num flex h-6 w-6 items-center justify-center rounded-sm border text-xs font-bold',
            i === tail.length - 1 && 'ring-2 ring-coral ring-offset-1',
            d % 2 === 0 ? 'border-blue bg-blue-wash text-blue' : 'border-coral bg-coral-wash text-coral',
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
  const t = useChartTheme();
  const axis = { fontSize: 10, fill: t.axis } as const;
  if (bins.length === 0) {
    return <div className={cn('flex items-center justify-center text-xs text-less-prominent', className)} style={{ height }}>No sample yet</div>;
  }
  const max = Math.max(...bins.map((b) => Math.max(b.ciHigh, b.pct))) * 1.18;
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bins} margin={{ top: 6, right: 6, bottom: 0, left: -22 }}>
          <CartesianGrid stroke={t.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="digit" tick={axis} axisLine={false} tickLine={false} />
          <YAxis tick={axis} domain={[0, max]} tickFormatter={(v: number) => `${v.toFixed(0)}%`} axisLine={false} tickLine={false} width={52} />
          <Tooltip
            cursor={{ fill: t.grid, fillOpacity: 0.25 }}
            contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 4, fontSize: 11, color: t.text }}
            labelFormatter={(v) => `Digit ${v}`}
            formatter={(v, name) => [`${Number(v).toFixed(2)}%`, String(name)]}
          />
          <ReferenceLine y={10} stroke={t.accent} strokeDasharray="4 4" strokeOpacity={0.7} />
          <Bar dataKey="pct" name="observed" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {bins.map((b) => (
              <Cell key={b.digit} fill={b.pct > b.ciHigh ? t.loss : b.pct < b.ciLow ? t.info : t.profit} fillOpacity={0.9} />
            ))}
          </Bar>
          <Bar dataKey="ciHigh" name="95% upper" fill={t.text} fillOpacity={0.07} radius={[2, 2, 0, 0]} isAnimationActive={false} />
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
  const t = useChartTheme();
  const axis = { fontSize: 10, fill: t.axis } as const;
  const data = useMemo(() => {
    let eq = startingBalance;
    let peak = startingBalance;
    const out: { i: number; equity: number; dd: number }[] = [{ i: 0, equity: eq, dd: 0 }];
    trades
      .slice()
      .sort((a, b) => a.closedAt - b.closedAt)
      .forEach((t2, idx) => {
        eq += t2.profit;
        peak = Math.max(peak, eq);
        out.push({ i: idx + 1, equity: Number(eq.toFixed(2)), dd: Number((eq - peak).toFixed(2)) });
      });
    return out;
  }, [trades, startingBalance]);

  if (data.length < 2) {
    return <div className={cn('flex items-center justify-center text-xs text-less-prominent', className)} style={{ height }}>No trades recorded yet</div>;
  }

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
          <CartesianGrid stroke={t.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="i" tick={axis} axisLine={false} tickLine={false} minTickGap={40} />
          <YAxis tick={axis} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(0)} axisLine={false} tickLine={false} width={54} />
          <Tooltip
            contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 4, fontSize: 11, color: t.text }}
            labelFormatter={(v) => `Trade #${v}`}
            formatter={(v, name) => [Number(v).toFixed(2), String(name)]}
          />
          <ReferenceLine y={startingBalance} stroke={t.muted} strokeDasharray="3 3" strokeOpacity={0.7} />
          <Line type="monotone" dataKey="equity" stroke={t.profit} strokeWidth={1.6} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="dd" stroke={t.loss} strokeWidth={1.1} strokeDasharray="3 2" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
