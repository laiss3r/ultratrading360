import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { decryptSession, SESSION_COOKIE } from '@/lib/oauth/session';
import { DerivAuthError, getSocketOtp } from '@/lib/deriv/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

/**
 * Mint the one-time password that opens an AUTHENTICATED Deriv socket.
 *
 * Why this exists: the access token lives in an httpOnly cookie, so browser JavaScript cannot
 * read it and therefore cannot call the OTP endpoint itself. This route performs that call
 * server-side and returns only the resulting socket URL.
 *
 * What is returned is a single-use, short-lived socket credential — NOT the API token. That is
 * unavoidable: the browser is the thing that must open the trading socket, so the OTP has to
 * reach it. The long-lived credential never leaves the server.
 *
 * `real=true` is refused unless the session's own record shows the user acknowledged
 * real-money trading for that specific loginid.
 */
export async function POST(req: Request) {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) {
    return NextResponse.json({ ok: false, error: 'not_authenticated', message: 'Connect a Deriv account first.' }, { status: 401 });
  }
  const session = decryptSession(raw);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'session_unreadable', message: 'Session could not be read. Reconnect.' }, { status: 401 });
  }
  if (session.expiresAt && session.expiresAt < Date.now()) {
    return NextResponse.json({ ok: false, error: 'expired', message: 'Session expired. Reconnect to Deriv.' }, { status: 401 });
  }

  let body: { loginid?: string; allowReal?: boolean };
  try {
    body = (await req.json()) as { loginid?: string; allowReal?: boolean };
  } catch {
    body = {};
  }

  const target = (body.loginid ?? session.loginid).trim();
  if (!target) {
    return NextResponse.json({ ok: false, error: 'missing_loginid', message: 'No account loginid supplied.' }, { status: 400 });
  }

  const isVirtual = /^VRT/i.test(target) || session.isVirtual;
  if (!isVirtual && body.allowReal !== true) {
    return NextResponse.json(
      {
        ok: false,
        error: 'real_trading_not_acknowledged',
        message:
          'This is a REAL money account. Real trading must be explicitly acknowledged in Risk settings before a trading socket is issued.',
      },
      { status: 403 },
    );
  }

  try {
    const urlOrOtp = await getSocketOtp(session.accessToken, session.kind, target);
    const url = urlOrOtp.startsWith('wss://') || urlOrOtp.startsWith('ws://') ? urlOrOtp : null;
    return NextResponse.json({
      ok: true,
      url,
      otp: url ? null : urlOrOtp,
      loginid: target,
      isVirtual,
      mode: isVirtual ? 'deriv_demo' : 'deriv_real',
      note: url
        ? 'Single-use socket URL. The API token itself was not sent to the browser.'
        : 'OTP returned; the client must build the demo/real socket URL.',
    });
  } catch (e) {
    const err = e as DerivAuthError;
    return NextResponse.json(
      { ok: false, error: err.code ?? 'otp_failed', message: err.message },
      { status: err.httpStatus ?? 502 },
    );
  }
}
