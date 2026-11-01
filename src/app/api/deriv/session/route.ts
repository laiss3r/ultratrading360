import { NextResponse } from 'next/server';
import { classifyRevalidation } from '@/lib/deriv/auth';
import { cookies } from 'next/headers';
import {
  decryptSession,
  publicSession,
  SESSION_COOKIE,
  type StoredSession,
} from '@/lib/oauth/session';
import { validateAccountsForToken } from '@/lib/deriv/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

function snapshot(session: StoredSession) {
  return { authenticated: true, session: publicSession(session), preferReal: session.initialRealAccountPending === true,
    accounts: (session.accountRows ?? []).map((a) => ({loginid:a.account_loginid,currency:a.currency,balance:Number(a.balance??0), balanceKnown: typeof a.balance === 'number' && Number.isFinite(a.balance),isVirtual:a.is_virtual===1})) };
}

/**
 * Current session WITHOUT the credential.
 * `?refresh=1` re-validates against Deriv and updates the balance, so a stale figure is never
 * presented as current.
 */
export async function GET(req: Request) {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return NextResponse.json({ authenticated: false, session: null });

  const session = decryptSession(raw);
  if (!session) {
    // Tampered, corrupt, or encrypted under a previous DERIV_SESSION_SECRET.
    const res = NextResponse.json({ authenticated: false, session: null, reason: 'session_unreadable' });
    return res;
  }

  if (session.expiresAt && session.expiresAt < Date.now()) {
    const res = NextResponse.json({ authenticated: false, session: null, reason: 'expired' });
    return res;
  }

  const refresh = new URL(req.url).searchParams.get('refresh') === '1';
  if (!refresh) {
    return NextResponse.json(snapshot(session));
  }

  try {
    let accounts;
    try {
      ({ accounts } = await validateAccountsForToken(session.accessToken, session.kind));
    } catch (e) {
      const verdict = classifyRevalidation((e as { code?: string }).code ?? '');
      if (verdict !== 'dead') {
        // empty: known Deriv state for this profile generation; transient: a network
        // or HTTP blip between us and Deriv. Neither may log a signed-in user out -
        // that was the mobile navigation/logout loop. Transient keeps the session but
        // flags it stale so the client retries in the background.
        return NextResponse.json({
          ...snapshot({...session, accountDiagnostics: (e as import('@/lib/deriv/auth').DerivAuthError).diagnostics ?? session.accountDiagnostics}),
          stale: verdict === 'transient',
        });
      }
      throw e;
    }
    const merged = new Map((session.accountRows ?? []).map((a) => [a.account_loginid, a]));
    for (const account of accounts) merged.set(account.account_loginid, account);
    const rows = [...merged.values()];
    const current = rows.find((a) => a.account_loginid === session.loginid);
    if (!current) return NextResponse.json({...snapshot({...session,accountRows:rows}),stale:true});
    const updated: StoredSession = {
      ...session,
      loginid: current.account_loginid,
      accountRows: rows,
      initialRealAccountPending: session.initialRealAccountPending === true && current.is_virtual !== 0,
      balance: Number(current.balance ?? (current.account_loginid === session.loginid ? session.balance : 0)),
      currency: current.currency ?? session.currency,
      isVirtual: current.is_virtual === 1,
      needsOptionsAccount: undefined,
    };
    // GET is read-only. Only explicit serialized identity mutations set cookies.
    return NextResponse.json(snapshot(updated));
  } catch (e) {
    return NextResponse.json(
      {
        authenticated: false,
        session: publicSession(session),
        reason: 'revalidation_failed',
        message: (e as Error).message,
      },
      { status: 401 },
    );
  }
}
