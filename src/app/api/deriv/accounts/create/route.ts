import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { DERIV_API_BASE } from '@/lib/deriv/config';
import { DerivAuthError, validateAccountsForToken, buildSession } from '@/lib/deriv/auth';
import type { AccountInfo } from '@/lib/deriv/types';
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

  const detail = (await res.json().catch(() => null)) as {
    message?: string;
    error?: string;
    data?:
      | { account_id?: string; currency?: string; balance?: number; account_type?: string }
      | Array<{ account_id?: string; currency?: string; balance?: number; account_type?: string }>;
  } | null;
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

  // Deriv's create response carries the account itself (201: array, 200: single
  // object when it already existed). Build the session from THAT - the listing
  // can lag behind - and only use a re-read to enrich the switcher list.
  const rawCreated = Array.isArray(detail?.data) ? detail?.data[0] : detail?.data;
  const createdRow: AccountInfo | null = rawCreated?.account_id
    ? {
        account_loginid: rawCreated.account_id,
        currency: (rawCreated.currency ?? currency).toUpperCase(),
        balance: Number(rawCreated.balance ?? 0),
        is_virtual: rawCreated.account_type === 'demo' ? 1 : 0,
      }
    : null;
  if (!createdRow) {
    return NextResponse.json(
      { ok: false, message: `Deriv answered HTTP ${res.status} without an account object.` },
      { status: 502 },
    );
  }
  try {
    let accounts: AccountInfo[] = [createdRow];
    let scopes = session.scopes ?? [];
    try {
      const v = await validateAccountsForToken(session.accessToken, session.kind);
      if (v.accounts.length > 0) {
        accounts = v.accounts.some((a) => a.account_loginid === createdRow.account_loginid)
          ? v.accounts
          : [createdRow, ...v.accounts];
        scopes = v.scopes;
      }
    } catch {
      /* listing lag is fine: the create response already proved the account */
    }
    const primary = accounts.find((a) => a.account_loginid === createdRow.account_loginid) ?? accounts[0];
    const next = {
      ...buildSession(session.kind, primary, scopes, session.expiresAt),
      needsOptionsAccount: undefined,
      accountsSource: 'options_rest' as const,
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
    if (err.code === 'no_accounts') {
      // Deriv accepted the request but the listing has not caught up yet (or the
      // profile can only hold classic accounts). Keep the session as it was and
      // tell the user the truth instead of a scary failure.
      return NextResponse.json({
        ok: true,
        pending: true,
        session: publicSession(session),
        accounts: [],
        message:
          'Deriv accepted the request, but the new account is not in the listing yet. Stay signed in and reload in a minute - or use the classic accounts already shown in the switcher.',
      });
    }
    return NextResponse.json(
      { ok: false, message: err.message ?? 'The account was created but the session could not be refreshed. Sign in again.' },
      { status: 500 },
    );
  }
}
