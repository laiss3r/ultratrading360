import { NextResponse } from 'next/server';
import { pingLegacyWs } from '@/lib/deriv/wsAuthorize';
import { getOAuthClientId, getRedirectUri, OAUTH_SCOPES } from '@/lib/deriv/config';
import { buildAuthorizeUrl, deriveCodeChallenge, generateCodeVerifier } from '@/lib/oauth/pkce';
import { interpretProbeRedirect } from '@/lib/oauth/probe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Live, session-free check of whether the redirect URI this deployment sends
 * is actually registered on the Deriv app.
 *
 * Deriv validates redirect_uri before showing any UI for `prompt=none`
 * requests: registered URIs are bounced back to themselves with
 * error=login_required, unregistered ones go to Deriv's error page with
 * invalid_request. Nobody's Deriv session is touched and no secret is used —
 * the probe carries a throwaway PKCE challenge and a fixed state.
 */
export async function GET() {
  const clientId = getOAuthClientId();
  const redirectUri = getRedirectUri();
  if (!clientId || !redirectUri) {
    return NextResponse.json({ registered: null, detail: 'OAuth is not configured on this deployment.', redirectUri });
  }
  try {
    const url = buildAuthorizeUrl({
      clientId,
      redirectUri,
      scope: [...OAUTH_SCOPES],
      state: 'registration-probe',
      codeChallenge: await deriveCodeChallenge(generateCodeVerifier()),
      prompt: 'none',
    });
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(9000) });
    const location = res.headers.get('location') ?? '';
    const verdict = interpretProbeRedirect(location, redirectUri);
    return NextResponse.json({ registered: verdict.registered, detail: verdict.detail, location, redirectUri });
  } catch (e) {
    return NextResponse.json({
      registered: null,
      detail: `Probe could not reach Deriv (${e instanceof Error ? e.message : 'unknown error'}).`,
    legacyWs: await pingLegacyWs(),
      redirectUri,
    });
  }
}
