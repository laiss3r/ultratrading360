import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { DERIV_API_BASE } from '@/lib/deriv/config';
import { DerivAuthError, validateAccountsForToken, buildSession } from '@/lib/deriv/auth';
import { decryptSession, encryptSession, publicSession, SESSION_COOKIE, sessionExpirySeconds } from '@/lib/oauth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Create an Options trading account on Deriv's new platform for the connected
 * credential. The new REST API keeps Options accounts (DOT…/ROT…) separate from
 * classic Deriv loginids, and a profile can authenticate perfectly while having
 * none — so this route exists to close that gap with one explicit click.
 *
 * Defaults to a demo account. A real Options account is only ever attempted if
 * the caller explicitly asks for one, and Deriv's own funding rules then apply;
 * nothing is created automatically anywhere else in the app.
 */
export async function POST(req: Request) {
  let body: { accountType?: string; currency?: string };
  try {
    body = (await req.json()) as { accountType?: string; currency?: string };
  } catch {
    body = {};
  }
  const accountType = body.accountType === 'real' ? 'real' : 'demo';

  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  const session = raw ? decryptSession(raw) : null;
  if (!session?.accessToken) {
    return NextResponse.json({ ok: false, message: 'No Deriv session. Sign in first.' }, { status: 401 });
  }

  const currency = (body.currency || session.currency || 'USD').toUpperCase();
  let res: Response;
  try {
    res = await fetch(`${DERIV_API_BASE}/trading/v1/options/accounts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({ currency, group: 'row', account_type: accountType }),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, message: `Could not reach Deriv (${(e as Error).message}).` }, { status: 502 });
  }

  const detail = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        message:
          detail?.message ??
          detail?.error ??
          `Deriv refused the ${accountType} Options account (HTTP ${res.status}). Real accounts need a funded Deriv wallet; demo accounts need the account_manage scope.`,
      },
      { status: res.status },
    );
  }

  // Re-read the account list and reissue the session around the new account.
  try {
    const { accounts, scopes } = await validateAccountsForToken(session.accessToken, session.kind);
    const primary = accounts.find((a) => a.is_virtual !== 1) ?? accounts[0];
    const next = {
      ...buildSession(session.kind, primary, scopes, session.expiresAt),
      needsOptionsAccount: undefined,
      accessToken: session.accessToken,
    };
    const out = NextResponse.json({
      ok: true,
      session: publicSession(next),
      accounts: accounts.map((a) => ({
        loginid: a.account_loginid,
        currency: a.currency,
        balance: a.balance ?? 0,
        isVirtual: a.is_virtual === 1,
      })),
    });
    out.cookies.set(SESSION_COOKIE, encryptSession(next), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: sessionExpirySeconds(next),
    });
    return out;
  } catch (e) {
    const err = e as DerivAuthError;
    return NextResponse.json(
      { ok: false, message: err.message ?? 'The account was created but the session could not be refreshed. Sign in again.' },
      { status: 500 },
    );
  }
}
