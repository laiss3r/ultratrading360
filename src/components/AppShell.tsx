'use client';

import { useEffect, type ReactNode } from 'react';
import { useApp } from '@/state/store';
import { AppHeader } from './Header';
import { AppFooter } from './Footer';
import { BottomNav } from './BottomNav';
import { RunPanel } from './RunPanel';
import { QuickStrategy } from './QuickStrategy';

/**
 * Application shell, laid out the way Deriv's own platforms are:
 *
 *   header   brand · primary tabs · account switcher + balance
 *   body     page workspace  |  run drawer (366px, Summary/Transactions/Journal)
 *   footer   fullscreen · theme · UTC clock · connection status
 *
 * The run drawer is part of the shell rather than of any one page, because in
 * Deriv Bot it stays mounted while you move between the builder and the chart —
 * the bot keeps running and its journal keeps filling wherever you are.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const hydrated = useApp((s) => s.hydrated);
  const hydrate = useApp((s) => s.hydrate);
  const uiTheme = useApp((s) => s.settings.uiTheme);
  const setRunPanelOpen = useApp((s) => s.setRunPanelOpen);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // On a phone the drawer is an overlay, so starting open would cover the page the
  // user just asked for. It stays inline and open on desktop, exactly as Deriv Bot
  // keeps its run panel beside the workspace.
  useEffect(() => {
    const t = setTimeout(() => {
      if (typeof window !== 'undefined' && window.innerWidth < 1024) setRunPanelOpen(false);
    }, 0);
    return () => clearTimeout(t);
  }, [setRunPanelOpen]);

  // The theme is a data attribute on <html>, which is what the token layer in
  // globals.css keys off. Setting it here rather than in a class keeps every
  // Tailwind utility theme-aware without a second set of colour names.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = uiTheme;
  }, [uiTheme]);

  return (
    <div className="dt-layout">
      <AppHeader />
      <div className="dt-body">
        <main className="dt-main">{hydrated ? children : <Restoring />}</main>
        <RunPanel />
      </div>
      <BottomNav />
      <AppFooter />
      <QuickStrategy />
    </div>
  );
}

function Restoring() {
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-coral" />
      <p className="text-xs text-less-prominent">Restoring local workspace…</p>
    </div>
  );
}
