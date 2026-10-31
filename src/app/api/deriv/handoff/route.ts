import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { legacyWsHosts } from '@/lib/deriv/config';
import { decryptSession, HANDOFF_COOKIE, SESSION_COOKIE, verifySignedValue } from '@/lib/oauth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

/**
 * Single-use, seconds-long token handoff for the classic account discovery run.
 *
 * Deriv's legacy socket (the call every Deriv client uses to list classic CR/VRTC
 * accounts) refuses cloud IPs, so the discovery has to run in the visitor's own
 * browser. The token normally never leaves its encrypted httpOnly cookie; when —
 * and only when — a sign-in lands on a profile with no account on the new platform,
 * the login routes set a signed 120-second marker cookie. This route consumes that
 * marker ONCE (clearing it in the same response), verifies the session cookie, and
 * returns the token plus the legacy host list so the callback page can perform one
 * authorize call. The page discards the token immediately afterwards; nothing is
 * written to localStorage, sessionStorage or IndexedDB.
 */
export async function POST() {
  const store = await cookies();
  const marker = store.get(HANDOFF_COOKIE)?.value;
  const raw = store.get(SESSION_COOKIE)?.value;
  const session = raw ? decryptSession(raw) : null;
  const allowed = Boolean(session?.accessToken && (!session.expiresAt || session.expiresAt > Date.now()) && marker && verifySignedValue(marker));

  const res = NextResponse.json(
    allowed
      ? { ok: true, token: session?.accessToken, hosts: legacyWsHosts() }
      : { ok: false, message: 'No single-use handoff is pending for this browser.' },
    { status: allowed ? 200 : 403 },
  );
  res.headers.set('Cache-Control', 'no-store');
  // Burn the marker either way: a handoff attempt is one-shot.
  res.cookies.set(HANDOFF_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
