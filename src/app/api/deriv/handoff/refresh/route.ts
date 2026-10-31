import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { decryptSession, HANDOFF_COOKIE, SESSION_COOKIE, signValue } from '@/lib/oauth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

/**
 * Lets a signed-in browser ask for a fresh single-use handoff marker so it can
 * re-run the classic discovery/balance sync on demand ("Sync balances"), not
 * only at sign-in. Session cookie required; the marker stays one-shot/120s.
 */
export async function POST() {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  const session = raw ? decryptSession(raw) : null;
  if (!session?.accessToken || (session.expiresAt && session.expiresAt < Date.now())) {
    return NextResponse.json({ ok: false, message: 'No Deriv session. Sign in first.' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(HANDOFF_COOKIE, signValue('1'), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 120,
  });
  return res;
}
