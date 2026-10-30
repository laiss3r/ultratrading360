'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Blocks, LayoutDashboard, LineChart, Moon, PanelRight, Sun, Zap } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useApp } from '@/state/store';
import { AccountSwitcher } from './AccountSwitcher';

/**
 * Header, following Deriv's platform shell: brand mark, then the primary tabs,
 * then account and balance on the right. Deriv Bot's navigation is exactly this
 * — Dashboard, Bot Builder, Chart, Tutorials — as top-level tabs rather than a
 * sidebar, because the workspace below needs the full width.
 */
const TABS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/builder', label: 'Bot Builder', icon: Blocks },
  { href: '/chart', label: 'Chart', icon: BarChart3 },
  { href: '/signals', label: 'Signals', icon: LineChart },
] as const;

export function AppHeader() {
  const pathname = usePathname();
  const openQuickStrategy = useApp((s) => s.openQuickStrategy);
  const openRunPanel = useApp((s) => s.setRunPanelOpen);
  const uiTheme = useApp((s) => s.settings.uiTheme);
  const setSettings = useApp((s) => s.setSettings);
  const dark = uiTheme === 'dark';

  return (
    <header className="dt-header">
      <Brand />

      <nav className="dt-tabs" aria-label="Primary">
        {TABS.map((t) => {
          const active = pathname === t.href;
          const Icon = t.icon;
          return (
            <Link key={t.href} href={t.href} className="dt-tab" data-active={active} aria-current={active ? 'page' : undefined}>
              <Icon size={15} strokeWidth={active ? 2.4 : 1.8} />
              {t.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2 md:gap-3">
        {/* The footer's theme toggle is hidden on phones (the footer keeps only the
            clock and the connection status there), so it lives in the header instead. */}
        <button
          type="button"
          onClick={() => void setSettings({ uiTheme: dark ? 'light' : 'dark' })}
          className="inline-flex items-center justify-center rounded border border-line p-2 text-general transition-colors hover:bg-state-hover md:hidden"
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          type="button"
          onClick={openQuickStrategy}
          className="inline-flex items-center justify-center rounded bg-coral p-2 text-white transition-colors hover:bg-coral-hover md:hidden"
          aria-label="Quick strategy"
          title="Launch a strategy from a preset progression — Martingale, D'Alembert, Oscar's Grind, 1-3-2-6"
        >
          <Zap size={16} />
        </button>
        <button
          type="button"
          onClick={() => openRunPanel(true)}
          className="inline-flex items-center justify-center rounded border border-line p-2 text-general transition-colors hover:bg-state-hover lg:hidden"
          aria-label="Open run panel"
          title="Run panel: status, transactions and journal"
        >
          <PanelRight size={16} />
        </button>
        <button
          type="button"
          onClick={openQuickStrategy}
          className="hidden items-center gap-1.5 rounded bg-coral px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-coral-hover md:inline-flex"
          title="Launch a strategy from a preset progression — Martingale, D'Alembert, Oscar's Grind, 1-3-2-6"
        >
          <Zap size={14} />
          Quick strategy
        </button>

        <PriceReadout />
        <AccountSwitcher />
      </div>
    </header>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2" title="UltraTrading360 — dashboard">
      <span className="flex h-7 w-7 items-center justify-center rounded bg-coral">
        {/* Candlestick mark: the app's own logo, drawn on the Deriv palette. */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <line x1="4" y1="2" x2="4" y2="14" stroke="#ffffff" strokeWidth="1" opacity="0.85" />
          <rect x="2.2" y="5" width="3.6" height="6" rx="0.6" fill="#ffffff" />
          <line x1="11" y1="3" x2="11" y2="13" stroke="#ffffff" strokeWidth="1" opacity="0.6" />
          <rect x="9.2" y="6.5" width="3.6" height="4" rx="0.6" fill="#ffffff" opacity="0.75" />
        </svg>
      </span>
      <span className="hidden leading-tight sm:block">
        <span className="block text-[13px] font-bold tracking-tight text-prominent">UltraTrading360</span>
        <span className="block text-xxs text-less-prominent">Deriv automation</span>
      </span>
    </Link>
  );
}

/**
 * Live price and last digit for the selected market.
 *
 * The digit is the input every strategy in this app is built on, so it belongs
 * in the header where it is visible from every page — the same reasoning that
 * puts the balance in Deriv's header.
 */
function PriceReadout() {
  const activeSymbol = useApp((s) => s.activeSymbol);
  const quotes = useApp((s) => s.quotes);
  const digits = useApp((s) => s.digits);
  const dataSource = useApp((s) => s.dataSource);

  const price = quotes[quotes.length - 1]?.price;
  const prev = quotes[quotes.length - 2]?.price;
  const dir = price != null && prev != null ? (price > prev ? 'up' : price < prev ? 'down' : 'flat') : 'flat';
  const last = digits[digits.length - 1];

  return (
    <div className="hidden items-center gap-2.5 border-l border-line pl-3 lg:flex">
      <span className="text-xs font-bold text-less-prominent">{activeSymbol}</span>
      {price != null && (
        <span
          key={`${price}`}
          className={cn(
            'num rounded px-1 text-sm font-bold',
            dir === 'up' && 'dt-tick-up text-profit',
            dir === 'down' && 'dt-tick-down text-loss',
            dir === 'flat' && 'text-prominent',
          )}
        >
          {price}
        </span>
      )}
      {last != null && (
        <span className="flex items-center gap-1.5" title={`Last digit of ${activeSymbol}`}>
          <span className="text-xxs tracking-wide text-less-prominent uppercase">Digit</span>
          <span
            key={`d-${digits.length}`}
            className={cn(
              'num flex h-6 w-6 items-center justify-center rounded-sm text-xs font-bold text-white',
              last % 2 === 0 ? 'bg-blue' : 'bg-coral',
            )}
          >
            {last}
          </span>
        </span>
      )}
      <span className="text-xxs text-less-prominent">{dataSource === 'deriv_live' ? 'live' : 'no feed'}</span>
    </div>
  );
}
