import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { buildSession } from '@/lib/deriv/auth';
import { decryptSession, encryptSession, publicSession, SESSION_COOKIE, sessionExpirySeconds } from '@/lib/oauth/session';
import type { AccountInfo } from '@/lib/deriv/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

/**
 * Server-backed account selection. The active loginid lives in the encrypted
 * session cookie, so the choice survives every route, every reload and every
 * tab - client-only switching (the old behaviour) was invisible to the server
 * and was reverted by the next refresh. Only rows this session already lists
 * (created Options row / adopted classic rows) can be selected, but these display rows are NOT trading authorization.
 * The socket endpoint independently verifies identity against Deriv.
 */
export async function POST(req: Request) {
  let body: { loginid?: string };
  try {
    body = (await req.json()) as { loginid?: string };
  } catch {
    body = {};
  }
  const loginid = typeof body.loginid === 'string' ? body.loginid.trim() : '';
  if (!loginid) return NextResponse.json({ ok: false, message: 'No account specified.' }, { status: 400 });

  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  const session = raw ? decryptSession(raw) : null;
  if (!session?.accessToken || (session.expiresAt && session.expiresAt < Date.now())) {
    return NextResponse.json({ ok: false, message: 'No Deriv session. Sign in first.' }, { status: 401 });
  }

  const rows: AccountInfo[] = session.accountRows ?? [];
  const row = rows.find((r) => r.account_loginid === loginid);
  if (!row) {
    return NextResponse.json(
      { ok: false, message: `This session has no proof of account ${loginid}. Sync balances or sign in again.` },
      { status: 404 },
    );
  }

  const next = {
    ...buildSession(session.kind, row, session.scopes, session.expiresAt),
    needsOptionsAccount: undefined,
    accountsSource: session.accountsSource,
    accountRows: rows,
    accessToken: session.accessToken,
  };
  const res = NextResponse.json({
    ok: true,
    session: publicSession(next),
    accounts: rows.map((a) => ({
      loginid: a.account_loginid,
      currency: a.currency,
      balance: Number(a.balance ?? 0),
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
