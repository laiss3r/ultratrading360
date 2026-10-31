'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Activity, Blocks, Bot, ChartNoAxesCombined, CircleHelp, History, LayoutDashboard, Moon, Radio, Settings2, ShieldCheck, Sun, Wallet } from 'lucide-react';
import { useApp } from '@/state/store';
import { AccountMenu } from './AccountMenu';
import { SessionRail } from './Workspace';

const navigation = [
  { href: '/', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/builder', label: 'Bot Builder', Icon: Blocks },
  { href: '/overlord', label: 'Overlord Pro', Icon: Bot },
  { href: '/signals', label: 'Signal Tools', Icon: Radio },
  { href: '/chart', label: 'Trading Chart', Icon: ChartNoAxesCombined },
  { href: '/history', label: 'Trade History', Icon: History },
  { href: '/risk', label: 'Risk & Settings', Icon: Settings2 },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const theme = useApp((s) => s.settings.uiTheme);
  const status = useApp((s) => s.connectionStatus);
  const hydrated = useApp((s) => s.hydrated);
  const [bootError, setBootError] = useState('');
  const [railOpen, setRailOpen] = useState(false);
  useEffect(() => { void useApp.getState().hydrate().catch((e: Error) => setBootError(e.message)); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const simple = pathname === '/callback';
  return <div className="application">
    <header className="topbar"><Link href="/" className="brand" aria-label="UltraTrading360 dashboard"><span className="brand-symbol"><Activity size={23} /></span><span>ULTRA<span className="brand-weight">TRADING</span><b>360</b><small>DERIV TRADING WORKSPACE</small></span></Link>
      <div className="top-status"><span className={status === 'open' ? 'live-dot' : 'stale-dot'} /><span>{status === 'open' ? 'Market feed connected' : status === 'connecting' ? 'Connecting market feed' : 'Market feed offline'}</span></div>
      <div className="top-actions"><button className="icon-button theme-button" aria-label="Toggle color theme" onClick={() => void useApp.getState().setSettings({ uiTheme: theme === 'dark' ? 'light' : 'dark' })}>{theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</button><AccountMenu /></div>
    </header>
    {!simple && <nav className="tool-nav" aria-label="Trading tools">{navigation.map(({ href, label, Icon }) => <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}><Icon size={17} /><span>{label}</span></Link>)}<button className="session-toggle" aria-expanded={railOpen} onClick={() => setRailOpen(!railOpen)}><Activity size={17} />Session</button></nav>}
    <div className={`workspace-shell ${simple ? 'single-column' : ''}`}>
      <main id="main-content" className="workspace-main">{bootError && <div className="notice notice-error" role="alert">Workspace initialization failed: {bootError}. Refresh to retry.</div>}{!hydrated && <div className="boot-status" role="status">Restoring your workspace…</div>}{children}</main>
      {!simple && <aside className={`session-sidebar ${railOpen ? 'mobile-open' : ''}`} aria-label="Session monitor"><button className="rail-close button button-secondary" onClick={() => setRailOpen(false)}>Close session monitor</button><SessionRail /></aside>}
    </div>
    <footer className="site-footer"><span><ShieldCheck size={13} />Connected to Deriv infrastructure</span><span>Trading involves risk. No guaranteed returns.</span><a href="https://developers.deriv.com/" target="_blank" rel="noreferrer"><CircleHelp size={13} />API documentation ↗</a></footer>
    {!simple && <nav className="mobile-nav" aria-label="Mobile navigation">{[{href:'/',label:'Home',Icon:LayoutDashboard},{href:'/builder',label:'Builder',Icon:Blocks},{href:'/overlord',label:'Bots',Icon:Bot},{href:'/signals',label:'Signals',Icon:Radio},{href:'/connect',label:'Account',Icon:Wallet}].map(({href,label,Icon}) => <Link href={href} key={href} aria-current={pathname===href?'page':undefined}><Icon size={19}/><span>{label}</span></Link>)}</nav>}
  </div>;
}
