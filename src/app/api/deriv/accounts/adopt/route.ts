import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adoptedRowsToAccounts, buildSession } from '@/lib/deriv/auth';
import { sanitizeAdoptedAccounts } from '@/lib/deriv/authorizeMap';
import { decryptSession, encryptSession, publicSession, SESSION_COOKIE, sessionExpirySeconds } from '@/lib/oauth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

/**
 * Adopt the classic account rows the browser-side discovery run read straight from
 * Deriv's legacy authorize call, so the switcher shows exactly what every other
 * Deriv client shows (loginid, Demo/Real, balance). Cookie-authenticated: only this
 * browser's own session can receive the rows, and the stored token is untouched —
 * trading still authorises with the real credential server-side.
 */
export async function POST(req: Request) {
  let body: { accounts?: unknown; scopes?: unknown };
  try {
    body = (await req.json()) as { accounts?: unknown; scopes?: unknown };
  } catch {
    body = {};
  }
  const rows = sanitizeAdoptedAccounts(body.accounts);
  if (rows.length === 0) {
    return NextResponse.json({ ok: false, message: 'No clean account rows to adopt.' }, { status: 400 });
  }

  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  const session = raw ? decryptSession(raw) : null;
  if (!session?.accessToken) {
    return NextResponse.json({ ok: false, message: 'No Deriv session. Sign in first.' }, { status: 401 });
  }

  const merged = new Map((session.accountRows ?? []).map((a) => [a.account_loginid, a]));
  for (const a of adoptedRowsToAccounts(rows)) merged.set(a.account_loginid, a);
  const accounts = Array.from(merged.values());
  // Keep whichever primary the session already trades with (the created Options
  // row), otherwise prefer an Options row, otherwise the first virtual classic row.
  const primary =
    accounts.find((a) => a.account_loginid === session.loginid) ??
    accounts.find((a) => /^(DOT|ROT)/.test(a.account_loginid)) ??
    accounts.find((a) => a.is_virtual === 1) ??
    accounts[0];
  const scopes =
    Array.isArray(body.scopes) && body.scopes.every((x) => typeof x === 'string')
      ? (body.scopes as string[])
      : session.scopes;
  const next = {
    ...buildSession(session.kind, primary, scopes, session.expiresAt),
    needsOptionsAccount: undefined,
    accountsSource: 'classic_browser' as const,
    accountRows: accounts,
    accessToken: session.accessToken,
  };
  const res = NextResponse.json({
    ok: true,
    session: publicSession(next),
    accounts: accounts.map((a) => ({
      loginid: a.account_loginid,
      currency: a.currency,
      balance: a.balance ?? 0,
      isVirtual: a.is_virtual === 1,
    })),
  });
  res.cookies.set(SESSION_COOKIE, encryptSession(next), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: sessionExpirySeconds(next),
  });
  return res;
}
