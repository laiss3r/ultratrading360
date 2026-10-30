import { NextResponse } from 'next/server';
import { buildSession, DerivAuthError, validatePat } from '@/lib/deriv/auth';
import { encryptSession, publicSession, SESSION_COOKIE, sessionExpirySeconds } from '@/lib/oauth/session';

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
    const { accounts, scopes } = await validatePat(raw);
    const primary = accounts.find((a) => a.is_virtual !== 1) ?? accounts[0];
    // PATs carry no expiry we can read from the API; cap the local session at 8 hours so a
    // stale cookie cannot outlive a revoked token by much.
    const session = { ...buildSession('pat', primary, scopes, null), accessToken: raw.trim() };

    const res = NextResponse.json({
      ok: true,
      session: publicSession(session),
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
    return res;
  } catch (e) {
    if (e instanceof DerivAuthError) {
      const status = e.httpStatus ?? (e.code === 'network' ? 502 : 400);
      return NextResponse.json({ ok: false, error: e.code, message: e.message }, { status });
    }
    return NextResponse.json({ ok: false, error: 'unexpected', message: (e as Error).message }, { status: 500 });
  }
}
