import { NextResponse } from 'next/server';
import { getOAuthClientId, getRedirectUri, OAUTH_SCOPES } from '@/lib/deriv/config';
import { buildAuthorizeUrl, generateCodeVerifier, generateState, deriveCodeChallenge } from '@/lib/oauth/pkce';
import { signValue, STATE_COOKIE, VERIFIER_COOKIE } from '@/lib/oauth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SHORT_TTL = 600; // 10 minutes to complete the redirect

/**
 * Begin the OAuth2 authorization-code + PKCE flow.
 * Generates fresh state and code_verifier, stores them SIGNED in short-lived httpOnly cookies,
 * and returns the Deriv authorization URL for the browser to navigate to.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const signup = searchParams.get('signup') === '1';

  const clientId = getOAuthClientId();
  const redirectUri = getRedirectUri();

  if (!clientId) {
    return NextResponse.json(
      {
        error: 'oauth_not_configured',
        message:
          'OAuth is not configured. Register an OAuth2 application at developers.deriv.com, then set DERIV_OAUTH_CLIENT_ID (and DERIV_REDIRECT_URI) in Vercel environment variables.',
        portal: 'https://developers.deriv.com/dashboard/',
        redirectUriExpected: redirectUri,
      },
      { status: 503 },
    );
  }

  const state = generateState(16);
  const verifier = generateCodeVerifier(64);
  const challenge = await deriveCodeChallenge(verifier);

  const url = buildAuthorizeUrl({
    clientId,
    redirectUri,
    scope: [...OAUTH_SCOPES],
    state,
    codeChallenge: challenge,
    prompt: signup ? 'registration' : undefined,
  });

  const res = NextResponse.json({ authorizeUrl: url, redirectUri, state });
  const secure = redirectUri.startsWith('https://');
  const common = {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SHORT_TTL,
  };
  res.cookies.set(STATE_COOKIE, signValue(state), common);
  res.cookies.set(VERIFIER_COOKIE, signValue(verifier), common);
  return res;
}
