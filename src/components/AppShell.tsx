'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import {
  Activity,
  Boxes,
  FlaskConical,
  Gauge,
  History,
  LayoutDashboard,
  PlugZap,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useApp } from '@/state/store';
import { MODE_LABEL, SOURCE_LABEL } from '@/lib/format';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/builder', label: 'Bot Builder', icon: Boxes },
  { href: '/overlord', label: 'Overlord Pro', icon: Zap },
  { href: '/signals', label: 'Signal Lab', icon: FlaskConical },
  { href: '/history', label: 'History', icon: History },
  { href: '/connect', label: 'Connect', icon: PlugZap },
  { href: '/risk', label: 'Risk', icon: ShieldAlert },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hydrated = useApp((s) => s.hydrated);
  const hydrate = useApp((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <div className="flex h-full min-h-screen bg-base">
      <Rail pathname={pathname} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          {!hydrated ? (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-ink-3">
              <Activity className="h-6 w-6 animate-pulse text-brand" />
              <p className="text-xs">Restoring local workspace…</p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

function Rail({ pathname }: { pathname: string }) {
  return (
    <nav className="grid-noise flex w-[74px] shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-3">
      <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl border border-brand/30 bg-brand/10">
        <span className="num text-[13px] font-bold text-brand">360</span>
      </div>
      {NAV.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className={cn(
              'group relative flex w-[58px] flex-col items-center gap-1 rounded-lg py-2 transition-colors',
              active ? 'bg-elevated text-brand' : 'text-ink-3 hover:bg-hover hover:text-ink-2',
            )}
          >
            {active && <span className="absolute top-2 bottom-2 -left-[8px] w-[3px] rounded-r bg-brand" />}
            <Icon className="h-[17px] w-[17px]" strokeWidth={active ? 2.2 : 1.7} />
            <span className="text-[9px] leading-none font-medium tracking-tight">{item.label.split(' ')[0]}</span>
          </Link>
        );
      })}
      <div className="mt-auto flex flex-col items-center gap-2 pb-1">
        <Link href="/risk" title="Risk controls" className="text-ink-4 hover:text-warn">
          <Gauge className="h-4 w-4" />
        </Link>
      </div>
    </nav>
  );
}

function TopBar() {
  const mode = useApp((s) => s.settings.mode);
  const dataSource = useApp((s) => s.dataSource);
  const connectionStatus = useApp((s) => s.connectionStatus);
  const session = useApp((s) => s.session);
  const digits = useApp((s) => s.digits);
  const activeSymbol = useApp((s) => s.activeSymbol);
  const quotes = useApp((s) => s.quotes);
  const botState = useApp((s) => s.botState);
  const applyMode = useApp((s) => s.applyMode);
  const setSettings = useApp((s) => s.setSettings);

  const last = digits[digits.length - 1];
  const price = quotes[quotes.length - 1]?.price;
  const prevPrice = quotes[quotes.length - 2]?.price;
  const dir = price != null && prevPrice != null ? (price > prevPrice ? 'up' : price < prevPrice ? 'down' : 'flat') : 'flat';

  const connTone =
    connectionStatus === 'open' ? 'profit' : connectionStatus === 'connecting' ? 'warn' : connectionStatus === 'error' ? 'loss' : 'neutral';

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
      <div className="flex items-baseline gap-2">
        <h1 className="text-[13px] font-semibold tracking-tight text-ink">UltraTrading360</h1>
        <span className="hidden text-[10px] text-ink-4 lg:inline">Deriv automation · simulation-first</span>
      </div>

      <div className="mx-1 h-6 w-px bg-line" />

      {/* Mode switch. Real money is offered only when explicitly acknowledged. */}
      <div className="flex items-center gap-1">
        {(['simulation', 'deriv_demo', 'deriv_real'] as const).map((m) => {
          const locked = m === 'deriv_real';
          const active = mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={async () => {
                if (locked) {
                  const s = useApp.getState();
                  if (!s.settings.realTradingAcknowledged) {
                    s.pushLog('warn', 'Real-money mode is locked until you acknowledge it in Risk settings.');
                    return;
                  }
                  if (!s.session) {
                    s.pushLog('warn', 'Connect a Deriv account before switching to real-money mode.');
                    return;
                  }
                }
                await setSettings({ mode: m });
                await applyMode(m);
              }}
              className={cn(
                'rounded-md px-2 py-1 text-[10.5px] font-semibold tracking-wide uppercase transition-colors',
                active
                  ? m === 'deriv_real'
                    ? 'bg-loss/20 text-loss ring-1 ring-loss/40'
                    : m === 'deriv_demo'
                      ? 'bg-info/15 text-info ring-1 ring-info/30'
                      : 'bg-brand/15 text-brand ring-1 ring-brand/35'
                  : 'text-ink-4 hover:bg-hover hover:text-ink-2',
              )}
              title={locked ? 'Requires explicit acknowledgement in Risk settings' : MODE_LABEL[m]}
            >
              {m === 'simulation' ? 'SIM' : m === 'deriv_demo' ? 'DEMO' : 'REAL'}
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden items-center gap-2 md:flex">
          <span className="text-[10px] tracking-wider text-ink-4 uppercase">{activeSymbol}</span>
          {price != null && (
            <span
              key={`${price}-${dir}`}
              className={cn(
                'num rounded px-1.5 py-0.5 text-[13px] font-semibold',
                dir === 'up' && 'flash-up text-profit',
                dir === 'down' && 'flash-down text-loss',
                dir === 'flat' && 'text-ink',
              )}
            >
              {price}
            </span>
          )}
          {last != null && (
            <span className="flex items-center gap-1">
              <span className="text-[10px] tracking-wider text-ink-4">DIGIT</span>
              <span
                key={`d-${digits.length}`}
                className={cn(
                  'num flash-up flex h-6 w-6 items-center justify-center rounded-md border text-[13px] font-bold',
                  last % 2 === 0 ? 'border-accent/35 bg-accent/10 text-accent' : 'border-brand/35 bg-brand/10 text-brand',
                )}
              >
                {last}
              </span>
            </span>
          )}
        </div>

        <Badge tone={connTone === 'profit' ? 'profit' : connTone === 'warn' ? 'warn' : connTone === 'loss' ? 'loss' : 'neutral'}>
          {connectionStatus === 'open' && <span className="pulse-live" />}
          {SOURCE_LABEL[dataSource] ?? dataSource}
        </Badge>

        <div className="hidden text-right sm:block">
          <div className="text-[9px] tracking-wider text-ink-4 uppercase">Balance</div>
          <div className="num text-[12px] font-semibold text-ink">
            {session ? `${session.balance.toFixed(2)} ${session.currency}` : '—'}
          </div>
        </div>

        {botState === 'running' && <Badge tone="profit">BOT RUNNING</Badge>}
        {botState === 'halted' && <Badge tone="warn">BOT HALTED</Badge>}
      </div>
    </header>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone: 'profit' | 'loss' | 'warn' | 'neutral' }) {
  const tones = {
    profit: 'border-profit/30 bg-profit/10 text-profit',
    loss: 'border-loss/30 bg-loss/10 text-loss',
    warn: 'border-warn/30 bg-warn/10 text-warn',
    neutral: 'border-line-strong bg-elevated text-ink-3',
  };
  return (
    <span className={cn('num inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider', tones[tone])}>
      {children}
    </span>
  );
}
