import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  decryptSession,
  encryptSession,
  publicSession,
  SESSION_COOKIE,
  sessionExpirySeconds,
  type StoredSession,
} from '@/lib/oauth/session';
import { validateAccountsForToken } from '@/lib/deriv/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

function cookieOptions(maxAge: number) {
  return { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge };
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
    res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
    return res;
  }

  if (session.expiresAt && session.expiresAt < Date.now()) {
    const res = NextResponse.json({ authenticated: false, session: null, reason: 'expired' });
    res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
    return res;
  }

  const refresh = new URL(req.url).searchParams.get('refresh') === '1';
  if (!refresh) {
    return NextResponse.json({ authenticated: true, session: publicSession(session) });
  }

  try {
    let accounts;
    try {
      ({ accounts } = await validateAccountsForToken(session.accessToken, session.kind));
    } catch (e) {
      // An authenticated token whose profile lists nothing on the new platform is a
      // known Deriv state, not a dead credential: keep the session exactly as stored
      // (this used to 401 here and log signed-in users out on every refresh).
      if ((e as { code?: string }).code === 'no_accounts') {
        return NextResponse.json({ authenticated: true, session: publicSession(session), accounts: [] });
      }
      throw e;
    }
    const current = accounts.find((a) => a.account_loginid === session.loginid) ?? accounts[0];
    const updated: StoredSession = {
      ...session,
      balance: Number(current.balance ?? session.balance),
      currency: current.currency ?? session.currency,
      isVirtual: current.is_virtual === 1 || session.isVirtual,
      needsOptionsAccount: undefined,
    };
    const res = NextResponse.json({ authenticated: true, session: publicSession(updated) });
    res.cookies.set(SESSION_COOKIE, encryptSession(updated), cookieOptions(sessionExpirySeconds(updated)));
    return res;
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
