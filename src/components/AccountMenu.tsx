'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, LogOut, RefreshCw, Wallet, X, Settings } from 'lucide-react';
import { useApp } from '@/state/store';
import { Button, Notice } from './ui';

export function AccountMenu() {
  const session = useApp((s) => s.session);
  const accounts = useApp((s) => s.accounts);
  const busy = useApp((s) => s.busy);
  const balanceStatus = useApp((s) => s.balanceStatus);
  const balanceMessage = useApp((s) => s.balanceMessage);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const menu = useRef<HTMLDivElement>(null);
  const authenticated = Boolean(session?.loginid);
  const hasClassicAccounts = accounts.some((a) => /^(CR|VRT|VRD)/.test(a.loginid));
  useEffect(() => {
    if (authenticated && hasClassicAccounts) useApp.getState().startBalanceStream();
    return () => useApp.getState().stopBalanceStream();
  }, [authenticated, hasClassicAccounts]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  if (!session) return <div className="auth-actions"><Link className="button button-secondary" href="/connect">Log in</Link><button className="button button-primary signup" onClick={() => void useApp.getState().startOAuth(true)}>Sign up</button></div>;
  const refresh = async () => {
    setMessage('');
    try { const result = await useApp.getState().syncBalances(); if (!result.ok) setMessage(result.message); }
    catch (e) { setMessage((e as Error).message); }
  };
  const select = async (loginid: string) => {
    setMessage('');
    try { const result = await useApp.getState().selectAccount(loginid); if (result.ok) setOpen(false); else setMessage(result.message); }
    catch (e) { setMessage((e as Error).message); }
  };
  return <div className="account-anchor" ref={menu}>
    <button className="account-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={session.loginid ? `Account: ${session.loginid}, ${session.isVirtual ? 'Demo' : 'Real'}, ${session.balanceKnown === false ? 'balance unavailable' : `${session.balance.toFixed(2)} ${session.currency}`}` : 'Deriv connected: no trading account selected'} onClick={() => setOpen(!open)}>
      <span className={`wallet-icon ${session.isVirtual ? '' : 'real'}`}><Wallet size={18} /></span>
      <span><small>{!session.loginid ? 'Deriv connected' : session.isVirtual ? 'Demo account' : 'Real account'}</small><strong>{!session.loginid ? 'No account selected' : session.balanceKnown === false ? 'Balance unavailable' : <>{session.balance.toFixed(2)} <em>{session.currency}</em></>}</strong></span><ChevronDown size={15} />
    </button>
    {open && <div className="account-menu" role="menu" aria-label="Deriv accounts">
      <header><div><span className="eyebrow">DERIV ACCOUNTS</span><h3>Your accounts</h3></div><button className="icon-button" aria-label="Close accounts" onClick={() => setOpen(false)}><X size={18} /></button></header>
      <p className="micro muted">Select an account. Viewing Real never enables trading.</p>
      <div className="account-list">
        {accounts.length === 0 && <p className="muted">Deriv returned no current Options trading accounts. See Account details for the connection result.</p>}
        {accounts.map((a) => <button key={a.loginid} role="menuitemradio" aria-checked={a.loginid === session.loginid} disabled={Boolean(busy&&busy!=='sync-balances')} className={`account-row ${a.loginid === session.loginid ? 'selected' : ''}`} onClick={() => void select(a.loginid)}><span className={`account-tag ${a.isVirtual ? '' : 'real'}`}>{a.isVirtual ? 'D' : 'R'}</span><span className="account-identity"><b>{a.isVirtual ? 'Demo' : 'Real'}</b><small>{a.loginid}</small></span><span className="account-amount">{a.balanceKnown === false ? 'Unavailable' : a.balance.toFixed(2)}<small>{a.currency}</small></span>{a.loginid === session.loginid && <Check size={16} />}</button>)}
      </div>
      {!accounts.some((a) => !a.isVirtual) && <p className="account-explanation">{busy === 'sync-balances' ? 'Checking Deriv for additional accounts…' : 'No verified Real account is listed yet. Refresh checks the current Options API; a Demo account is never relabelled as Real.'}</p>}
      <div className="balance-state"><i className={balanceStatus === 'live' ? 'live-dot' : 'stale-dot'} />{hasClassicAccounts ? (balanceStatus === 'live' ? 'Classic balance channel connected' : 'Classic balances may be last known') : session.loginid ? 'Selected balance updates via its account connection' : 'No selected trading account or live balance'}<span title={balanceMessage}>ⓘ</span></div>
      {message && <Notice tone="error">{message}</Notice>}
      <div className="menu-actions"><Button variant="secondary" busy={busy === 'sync-balances'} onClick={() => void refresh()}><RefreshCw size={14} />Refresh accounts</Button><Link href="/connect" onClick={() => setOpen(false)} className="button button-ghost"><Settings size={14} />Account details</Link></div>
      <button className="logout-link" onClick={async () => { await useApp.getState().disconnect(); setOpen(false); }}><LogOut size={14} />Log out</button>
    </div>}
  </div>;
}
