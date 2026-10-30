'use client';

import { useEffect, useState } from 'react';
import { Maximize2, Minimize2, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useApp } from '@/state/store';

/**
 * The footer Deriv platforms all carry: fullscreen, theme, clock and connection
 * status on one hairline strip. It is the single most recognisable piece of the
 * Deriv shell, and it is functional rather than decorative — a trader needs to
 * know whether the feed underneath them is live before they trust a price.
 */
export function AppFooter() {
  return (
    <footer className="dt-footer">
      <FullScreenButton />
      <div className="dt-footer__rule" />
      <ThemeButton />
      <div className="dt-footer__rule" />
      <Clock />
      <div className="dt-footer__rule" />
      <NetworkStatus />
    </footer>
  );
}

function FullScreenButton() {
  const [isFull, setIsFull] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Browsers deny this without a user gesture or inside a sandboxed frame.
      // Failing silently is correct here; a trading footer must not throw.
    }
  };

  return (
    <button type="button" className="dt-footer__btn" data-mobile-hide="true" onClick={toggle} title={isFull ? 'Exit full screen' : 'Full screen'}>
      {isFull ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      <span className="hidden lg:inline">{isFull ? 'Exit full screen' : 'Full screen'}</span>
    </button>
  );
}

function ThemeButton() {
  const uiTheme = useApp((s) => s.settings.uiTheme);
  const setSettings = useApp((s) => s.setSettings);
  const dark = uiTheme === 'dark';
  return (
    <button
      type="button"
      className="dt-footer__btn"
      data-mobile-hide="true"
      onClick={() => void setSettings({ uiTheme: dark ? 'light' : 'dark' })}
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {dark ? <Sun size={13} /> : <Moon size={13} />}
      <span className="hidden lg:inline">{dark ? 'Light' : 'Dark'}</span>
    </button>
  );
}

/**
 * A live UTC clock.
 *
 * Deliberately labelled UTC and not "Server time": Deriv's own footer shows
 * broker server time obtained over the API, and this build does not request it.
 * Labelling a local clock as server time would be a small fabrication, and this
 * project does not do those.
 *
 * The first render shows a placeholder rather than a time, because this component
 * is part of the shell that React server-renders: a real time computed during SSR
 * would differ from the client's by however long the round trip took, and React
 * then fails hydration on the mismatched text node. The value appears on the
 * first client effect and ticks from there.
 */
function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    // The first real time arrives on the next macrotask rather than synchronously
    // inside the effect: a synchronous setState here is exactly what the React
    // Compiler's purity rule rejects, and one frame of placeholder is invisible.
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  const hh = now ? String(now.getUTCHours()).padStart(2, '0') : '--';
  const mm = now ? String(now.getUTCMinutes()).padStart(2, '0') : '--';
  const ss = now ? String(now.getUTCSeconds()).padStart(2, '0') : '--';
  return (
    <span className="inline-flex items-center gap-1.5 px-2" title="Coordinated Universal Time">
      <span className="num text-prominent">
        {hh}:{mm}:{ss}
      </span>
      <span>UTC</span>
    </span>
  );
}

function NetworkStatus() {
  const connectionStatus = useApp((s) => s.connectionStatus);
  const dataSource = useApp((s) => s.dataSource);

  const state =
    dataSource === 'deriv_live' && connectionStatus === 'open'
      ? { label: 'Connected', tone: 'text-profit', dot: 'bg-profit', title: 'Live Deriv WebSocket is streaming' }
      : dataSource === 'deriv_live' && connectionStatus === 'connecting'
        ? { label: 'Connecting', tone: 'text-orange', dot: 'bg-orange', title: 'Opening the Deriv WebSocket' }
        : connectionStatus === 'error' || connectionStatus === 'closed'
            ? { label: 'Disconnected', tone: 'text-loss', dot: 'bg-loss', title: 'No market feed is connected' }
            : { label: 'Idle', tone: 'text-less-prominent', dot: 'bg-less-prominent', title: 'No market feed started yet' };

  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2', state.tone)} title={state.title}>
      <span className={cn('inline-block h-[7px] w-[7px] rounded-full', state.dot)} />
      {state.label}
    </span>
  );
}
