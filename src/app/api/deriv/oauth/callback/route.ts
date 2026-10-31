import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getOAuthClientId, getRedirectUri } from '@/lib/deriv/config';
import { buildNoAccountsSession, buildSession, DerivAuthError, ensureOptionsAccount, exchangeAuthorizationCode, validateAccountsForToken } from '@/lib/deriv/auth';
import type { AccountInfo } from '@/lib/deriv/types';
import { safeEqual } from '@/lib/oauth/pkce';
import {
  encryptSession,
  publicSession,
  HANDOFF_COOKIE,
  SESSION_COOKIE,
  sessionExpirySeconds,
  signValue,
  STATE_COOKIE,
  VERIFIER_COOKIE,
  verifySignedValue,
} from '@/lib/oauth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

/**
 * Complete the OAuth2 authorization-code + PKCE flow SERVER-SIDE.
 *
 *  1. Validate `state` against the signed httpOnly cookie (CSRF), constant-time compare.
 *  2. Read the signed code_verifier, exchange the single-use authorization code.
 *  3. Fetch the authorized accounts with the new bearer token — proving the token actually works.
 *  4. Store an AES-256-GCM encrypted httpOnly session cookie. The access token is never
 *     returned to the browser and never appears in frontend JavaScript.
 *  5. Clear state + verifier immediately; both are single-use.
 *
 * The authorization code, verifier and access token are never written to logs. Error responses
 * carry a stable machine code and a human message only.
 */
export async function POST(req: Request) {
  let body: { code?: string; state?: string };
  try {
    body = (await req.json()) as { code?: string; state?: string };
  } catch {
    return fail('bad_request', 'Request body could not be parsed.', 400);
  }

  const code = body.code?.trim();
  const state = body.state?.trim();
  if (!code) return fail('missing_code', 'Deriv did not return an authorization code.', 400);
  if (!state) return fail('missing_state', 'Deriv did not return a state parameter.', 400);

  const store = await cookies();
  const stateCookie = store.get(STATE_COOKIE)?.value;
  const verifierCookie = store.get(VERIFIER_COOKIE)?.value;

  if (!stateCookie || !verifierCookie) {
    return fail(
      'state_expired',
      'This sign-in attempt expired, or was started in a different browser tab. Please start the Deriv sign-in again.',
      400,
    );
  }

  const expectedState = verifySignedValue(stateCookie);
  const verifier = verifySignedValue(verifierCookie);
  if (!expectedState || !verifier) {
    return fail('state_invalid', 'Session integrity check failed. Please start the Deriv sign-in again.', 400);
  }
  if (!safeEqual(expectedState, state)) {
    // Possible CSRF or authorization-code injection: refuse and burn the cookies.
    const res = fail(
      'state_mismatch',
      'The state parameter did not match this browser session. The sign-in was rejected as a possible CSRF attempt.',
      400,
    );
    clearAuthCookies(res);
    return res;
  }

  const clientId = getOAuthClientId();
  if (!clientId) {
    return fail('oauth_not_configured', 'DERIV_OAUTH_CLIENT_ID is not set on this deployment.', 503);
  }

  const redirectUri = getRedirectUri();
  let token: { accessToken: string; expiresIn: number };
  try {
    token = await exchangeAuthorizationCode({ clientId, code, codeVerifier: verifier, redirectUri });
  } catch (e) {
    const err = e as DerivAuthError;
    clearAuthCookies(fail('token_exchange_failed', 'Token exchange failed.', 400));
    return fail(err.code ?? 'token_exchange_failed', err.message, 400);
  }

  let accounts: AccountInfo[] = [];
  let scopes: string[] = [];
  let noAccounts = false;
  let source: 'options_rest' | 'classic_ws' | 'classic_browser' = 'options_rest';
  try {
    ({ accounts, scopes, source } = await validateAccountsForToken(token.accessToken, 'oauth'));
  } catch (e) {
    const err = e as DerivAuthError;
    if (err.code !== 'no_accounts') {
      return fail(err.code ?? 'account_fetch_failed', err.message, 401);
    }
    // Authenticated token, zero Options accounts: a legitimate state on the new
    // platform, not a failed sign-in. Try the idempotent demo creation once so the
    // sign-in can finish with a real row; otherwise fall through flagged.
    noAccounts = true;
    const created = await ensureOptionsAccount(token.accessToken, 'oauth');
    if (created) {
      accounts = [created];
      noAccounts = false;
    }
  }

  // Prefer a real account for display, but never silently promote one: the UI shows every
  // account and requires an explicit selection before real trading is enabled.
  const primary = accounts.find((a) => a.is_virtual !== 1) ?? accounts[0];
  const expiresAt = token.expiresIn > 0 ? Date.now() + token.expiresIn * 1000 : null;
  const session = noAccounts
    ? { ...buildNoAccountsSession('oauth', expiresAt), accessToken: token.accessToken }
    : {
        ...buildSession('oauth', primary as AccountInfo, scopes, expiresAt),
        accountsSource: source,
        accessToken: token.accessToken,
      };

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
  });
  res.cookies.set(SESSION_COOKIE, encryptSession(session), {
    httpOnly: true,
    secure: redirectUri.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: sessionExpirySeconds(session),
  });
  if (noAccounts) {
    // Permit exactly one browser-side classic discovery run (120s, single-use).
    res.cookies.set(HANDOFF_COOKIE, signValue('1'), {
      httpOnly: true,
      secure: redirectUri.startsWith('https://'),
      sameSite: 'lax',
      path: '/',
      maxAge: 120,
    });
  }
  clearAuthCookies(res);
  return res;
}

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

function clearAuthCookies(res: NextResponse) {
  res.cookies.set(STATE_COOKIE, '', { path: '/', maxAge: 0 });
  res.cookies.set(VERIFIER_COOKIE, '', { path: '/', maxAge: 0 });
}
