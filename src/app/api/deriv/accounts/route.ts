import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { decryptSession, SESSION_COOKIE } from '@/lib/oauth/session';
import { DerivAuthError, validateAccountsForToken } from '@/lib/deriv/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

/**
 * List the authorized Deriv accounts for the current session.
 * Runs server-side so the bearer token never reaches the browser. Returns loginid, currency,
 * balance and virtual/real flag — and explicitly labels which account is which, because the
 * UI must never let a demo balance be mistaken for a real one.
 */
export async function GET() {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) {
    return NextResponse.json({ ok: false, error: 'not_authenticated', message: 'No Deriv session. Connect first.' }, { status: 401 });
  }
  const session = decryptSession(raw);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'session_unreadable', message: 'Session could not be read. Reconnect.' }, { status: 401 });
  }

  try {
    let accounts;
    try {
      ({ accounts } = await validateAccountsForToken(session.accessToken, session.kind));
    } catch (e) {
      if ((e as { code?: string }).code === 'no_accounts') {
        return NextResponse.json({ ok: true, accounts: [] });
      }
      throw e;
    }
    return NextResponse.json({
      ok: true,
      accounts: accounts.map((a) => ({
        loginid: a.account_loginid,
        currency: a.currency,
        balance: Number(a.balance ?? 0),
        isVirtual: a.is_virtual === 1 || /^VRT/i.test(a.account_loginid ?? ''),
        accountType: a.account_type ?? null,
      })),
    });
  } catch (e) {
    const err = e as DerivAuthError;
    return NextResponse.json(
      { ok: false, error: err.code ?? 'failed', message: err.message },
      { status: err.httpStatus ?? 502 },
    );
  }
}
