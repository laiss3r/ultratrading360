import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, STATE_COOKIE, VERIFIER_COOKIE } from '@/lib/oauth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Disconnect: destroys the local session and clears every credential cookie.
 *
 * Retention policy: this deployment keeps no server-side copy of any credential, so clearing
 * the cookie is a complete local disconnect. Deriv issues no refresh token, so nothing can be
 * used to silently re-establish the session. The token itself remains valid at Deriv until it
 * expires or the user revokes it in their Deriv account — the UI says so explicitly.
 */
export async function POST() {
  const store = await cookies();
  const had = !!store.get(SESSION_COOKIE)?.value;
  const res = NextResponse.json({ ok: true, disconnected: had });
  for (const name of [SESSION_COOKIE, STATE_COOKIE, VERIFIER_COOKIE]) {
    res.cookies.set(name, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' });
  }
  return res;
}
