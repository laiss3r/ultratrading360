import { NextResponse } from 'next/server';
import {
  DERIV_APP_ID,
  DERIV_API_BASE,
  DERIV_DEVELOPER_PORTAL,
  DERIV_PAT_PAGE,
  DERIV_WS_PUBLIC,
  OAUTH_SCOPES,
  getOAuthClientId,
  getRedirectUri,
} from '@/lib/deriv/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Non-secret runtime configuration for the client.
 * The OAuth client_id is a PUBLIC identifier (it travels in the browser redirect), so it is
 * safe to expose. No token, secret or session value is ever returned from this route.
 */
export async function GET() {
  const clientId = getOAuthClientId();
  return NextResponse.json({
    appId: DERIV_APP_ID,
    apiBase: DERIV_API_BASE,
    wsPublic: DERIV_WS_PUBLIC,
    oauth: {
      configured: !!clientId,
      clientId,
      redirectUri: getRedirectUri(),
      scopes: [...OAUTH_SCOPES],
      authorizeUrl: 'https://auth.deriv.com/oauth2/auth',
      portalUrl: DERIV_DEVELOPER_PORTAL,
    },
    patPage: DERIV_PAT_PAGE,
  });
}
