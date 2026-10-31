import { NextResponse } from 'next/server';
import { buildNoAccountsSession, buildSession, DerivAuthError, ensureOptionsAccount, validatePat } from '@/lib/deriv/auth';
import { encryptSession, HANDOFF_COOKIE, publicSession, SESSION_COOKIE, sessionExpirySeconds, signValue } from '@/lib/oauth/session';
import type { AccountInfo } from '@/lib/deriv/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

/**
 * Personal Access Token login.
 *
 * The token is accepted in the POST body, validated by a real call to Deriv, and then stored
 * ONLY in an encrypted httpOnly cookie. It is never echoed back, never logged, never placed in
 * a NEXT_PUBLIC_ variable, and never readable by frontend JavaScript.
 */
export async function POST(req: Request) {
  let body: { token?: string };
  try {
    body = (await req.json()) as { token?: string };
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'Invalid request body.' }, { status: 400 });
  }

  const raw = body.token;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: 'empty_token', message: 'Enter a Deriv API token. An empty value is never accepted as valid.' },
      { status: 400 },
    );
  }

  try {
    let accounts: AccountInfo[] = [];
    let scopes: string[] = [];
    let noAccounts = false;
    let source: 'options_rest' | 'classic_ws' | 'classic_browser' = 'options_rest';
    try {
      ({ accounts, scopes, source } = await validatePat(raw));
    } catch (e) {
      const err = e as DerivAuthError;
      if (err.code !== 'no_accounts') throw err;
      noAccounts = true; // authenticated PAT, profile without an Options account yet
      const created = await ensureOptionsAccount(raw, 'pat');
      if (created) {
        accounts = [created];
        noAccounts = false;
      }
    }
    const primary = accounts.find((a) => a.is_virtual !== 1) ?? accounts[0];
    // PATs carry no expiry we can read from the API; cap the local session at 8 hours so a
    // stale cookie cannot outlive a revoked token by much.
    const session = noAccounts
      ? { ...buildNoAccountsSession('pat', null), accessToken: raw.trim() }
      : { ...buildSession('pat', primary as AccountInfo, scopes, null), accountsSource: source, accessToken: raw.trim() };

    const res = NextResponse.json({
      ok: true,
      session: publicSession(session),
      needsOptionsAccount: noAccounts,
      accounts: accounts.map((a) => ({
        loginid: a.account_loginid,
        currency: a.currency,
        balance: a.balance ?? 0,
        isVirtual: a.is_virtual === 1,
      })),
      warning:
        'Token accepted and stored in an encrypted httpOnly cookie. For trading you must also grant the trade scope when creating the token at Deriv.',
    });
    res.cookies.set(SESSION_COOKIE, encryptSession(session), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: sessionExpirySeconds(session),
    });
    if (noAccounts) {
      res.cookies.set(HANDOFF_COOKIE, signValue('1'), {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 120,
      });
    }
    return res;
  } catch (e) {
    if (e instanceof DerivAuthError) {
      const status = e.httpStatus ?? (e.code === 'network' ? 502 : 400);
      return NextResponse.json({ ok: false, error: e.code, message: e.message }, { status });
    }
    return NextResponse.json({ ok: false, error: 'unexpected', message: (e as Error).message }, { status: 500 });
  }
}
