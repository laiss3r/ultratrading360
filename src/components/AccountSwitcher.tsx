'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, PlugZap, ShieldAlert, History as HistoryIcon, Wallet, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useApp } from '@/state/store';
import { MODE_LABEL } from '@/lib/format';
import type { AccountMode } from '@/lib/deriv/types';

/**
 * Account switcher, in the position Deriv platforms put it: far right of the
 * header, showing the active loginid and balance, opening a panel that lists
 * every account on the session.
 *
 * The switcher keeps the
 * two axes visibly separate: the feed selector chooses where prices and orders
 * go, the account list chooses which Deriv loginid is active. Real money is
 * offered only after it has been acknowledged in Risk settings.
 */
export function AccountSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const session = useApp((s) => s.session);
  const accounts = useApp((s) => s.accounts);
  const mode = useApp((s) => s.settings.mode);
  const realAcknowledged = useApp((s) => s.settings.realTradingAcknowledged);
  const dataSource = useApp((s) => s.dataSource);
  const applyMode = useApp((s) => s.applyMode);
  const setSettings = useApp((s) => s.setSettings);
  const selectAccount = useApp((s) => s.selectAccount);
  const disconnect = useApp((s) => s.disconnect);
  const pushLog = useApp((s) => s.pushLog);
  const syncBalances = useApp((s) => s.syncBalances);
  const busy = useApp((s) => s.busy);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const loginid = session?.loginid ?? 'Not connected';
  const balance = session ? `${session.balance.toFixed(2)} ${session.currency}` : '—';
  const live = dataSource === 'deriv_live';

  const chooseMode = async (m: AccountMode) => {
    if (session) {
      const target = accounts.find((a) => a.isVirtual === (m === 'deriv_demo'));
      if (!target) { pushLog('warn', 'No account of this type is available on this session.'); return; }
      setOpen(false);
      const result = await selectAccount(target.loginid);
      if (!result.ok) pushLog('error', result.message);
      return;
    }
    await setSettings({ mode: m });
    await applyMode(m);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex items-center gap-2 rounded border px-2.5 py-1.5 transition-colors',
          'border-line bg-main-1 hover:bg-state-hover',
        )}
      >
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full text-white',
            session ? (session.isVirtual ? 'bg-brand2' : 'bg-coral') : 'bg-disabled',
          )}
        >
          <Wallet size={13} />
        </span>
        <span className="text-left leading-tight">
          <span className="block text-xxs text-less-prominent">{session ? (session.isVirtual ? 'Demo' : 'Real') : 'Not connected'}</span>
          <span className="num block text-xs font-bold text-prominent">{session ? loginid : 'No account'}</span>
        </span>
        <span className="num hidden border-l border-line pl-2.5 text-xs font-bold text-prominent sm:block">{balance}</span>
        <ChevronDown size={14} className={cn('text-less-prominent transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="dt-card absolute right-0 top-[calc(100%+6px)] z-50 w-[300px] shadow-lg"
          style={{ boxShadow: 'var(--shadow-menu)' }}
        >
          {/* --- Feed --- */}
          <div className="border-b border-line p-3">
            <div className="dt-section-title mb-2">Market feed</div>
            <div className="flex flex-col gap-1">
              {(['deriv_demo', 'deriv_real'] as const).map((m) => {
                const locked = m === 'deriv_real' && (!realAcknowledged || !session);
                return (
                  <button
                    key={m}
                    type="button"
                    role="menuitemradio"
                    aria-checked={mode === m}
                    onClick={() => void chooseMode(m)}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-xs transition-colors',
                      mode === m ? 'bg-coral-wash font-bold text-coral' : 'text-general hover:bg-state-hover',
                      locked && m !== 'deriv_real' && 'opacity-60',
                    )}
                    title={m === 'deriv_real' && locked ? 'Requires explicit acknowledgement in Risk settings' : MODE_LABEL[m]}
                  >
                    <span>{MODE_LABEL[m]}</span>
                    <span className="flex items-center gap-1.5">
                      {m === 'deriv_real' && locked && <ShieldAlert size={12} className="text-loss" />}
                      {mode === m && <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-profit' : 'bg-blue')} />}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xxs leading-relaxed text-less-prominent">
              Demo and real results are kept separate and are never summed together. Market data streams from Deriv&apos;s public socket even before you log in; placing orders needs a connected account.
            </p>
          </div>

          {/* --- Deriv accounts --- */}
          {session && (
            <div className="border-b border-line p-3">
              <div className="dt-section-title mb-2">Deriv accounts</div>
              {accounts.length === 0 ? (
                <p className="text-xs text-less-prominent">No other accounts on this session.</p>
              ) : (
                <div className="flex max-h-[180px] flex-col gap-1 overflow-y-auto">
                  {accounts.map((a) => (
                    <button
                      key={a.loginid}
                      type="button"
                      role="menuitemradio"
                      aria-checked={a.loginid === session.loginid}
                      disabled={busy === 'switch-account'}
                      onClick={() => {
                        // Close the menu the instant the user chooses — the switch itself
                        // (server select + market rebind) continues in the background and
                        // must never leave the dropdown sitting open on a slow network.
                        setOpen(false);
                        void (async () => {
                          const r = await selectAccount(a.loginid);
                          if (!r.ok) pushLog('error', r.message);
                        })();
                      }}
                      className={cn(
                        'flex items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left transition-colors',
                        a.loginid === session.loginid ? 'bg-section-1' : 'hover:bg-state-hover',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="num block text-xs font-bold text-prominent">{a.loginid}</span>
                        <span className="block text-xxs text-less-prominent">{a.isVirtual ? 'Demo' : 'Real'}</span>
                      </span>
                      <span className="num shrink-0 text-xs text-general">
                        {a.balance.toFixed(2)} {a.currency}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* --- Navigation --- */}
          <div className="p-2">
            <MenuLink href="/risk" icon={<ShieldAlert size={13} />} label="Risk settings" onClick={() => setOpen(false)} />
            <MenuLink href="/history" icon={<HistoryIcon size={13} />} label="Trade history" onClick={() => setOpen(false)} />
            {session && (
              <button
                type="button"
                role="menuitem"
                disabled={busy === 'sync-balances'}
                onClick={async () => {
                  const r = await syncBalances();
                  if (!r.ok) pushLog('warn', r.message);
                }}
                className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs text-general transition-colors hover:bg-state-hover disabled:opacity-50"
                title="Re-read live balances from Deriv's classic socket (one-shot, browser-side)"
              >
                <RefreshCw size={13} /> {busy === 'sync-balances' ? 'Syncing…' : 'Sync balances'}
              </button>
            )}
            <MenuLink href="/connect" icon={<PlugZap size={13} />} label={session ? 'Connection details' : 'Connect account'} onClick={() => setOpen(false)} />
            {session && (
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  await disconnect();
                  setOpen(false);
                }}
                className="mt-1 flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-loss hover:bg-loss-wash"
              >
                <LogOut size={13} />
                Disconnect
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  label,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-2 rounded px-2.5 py-2 text-xs text-general hover:bg-state-hover hover:text-prominent"
    >
      {icon}
      {label}
    </Link>
  );
}
