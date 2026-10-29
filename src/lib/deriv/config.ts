/**
 * Deriv API configuration.
 *
 * VERIFIED 2026-10-29 against the live API:
 *  - The legacy V1 socket hosts (ws.derivws.com, ws.binaryws.com) return HTTP 520 and are DEAD.
 *  - The current public market-data socket is api.derivws.com/trading/v1/options/ws/public.
 *  - `app_id` is NOT validated on the public socket: 1089, 90470, 1, 99999999 and even an
 *    empty value all return the same 89 markets. It is an attribution/identifier field only.
 *  - OAuth2 DOES validate client_id: an unregistered id is rejected with `invalid_client`.
 *    A legacy V1 app_id (e.g. 90470) is NOT an OAuth2 client_id and will be rejected.
 */

/** Public market-data WebSocket. No credential of any kind is required for ticks/candles/proposals. */
export const DERIV_WS_PUBLIC =
  process.env.NEXT_PUBLIC_DERIV_WS_PUBLIC ??
  'wss://api.derivws.com/trading/v1/options/ws/public';

/** REST base. Authenticated calls need `Authorization: Bearer` (+ `Deriv-App-ID` for PAT tokens). */
export const DERIV_API_BASE =
  process.env.NEXT_PUBLIC_DERIV_API_BASE ?? 'https://api.derivws.com';

export const DERIV_OAUTH_AUTHORIZE_URL = 'https://auth.deriv.com/oauth2/auth';
export const DERIV_OAUTH_TOKEN_URL = 'https://auth.deriv.com/oauth2/token';
export const DERIV_DEVELOPER_PORTAL = 'https://developers.deriv.com/dashboard/';
export const DERIV_PAT_PAGE = 'https://app.deriv.com/account/api-token';

/**
 * Application identifier sent on the public socket and as the `Deriv-App-ID` header for PAT auth.
 *
 * 90470 is the legacy V1 app_id recovered from the Dmastertool repo audit. It is usable as an
 * identifier, but it is NOT a registered OAuth2 client and it grants nothing by itself.
 * Override with your own registration from developers.deriv.com.
 */
export const DERIV_APP_ID = process.env.NEXT_PUBLIC_DERIV_APP_ID ?? '90470';

/**
 * OAuth2 client_id. Server-side only (no NEXT_PUBLIC_ prefix) — it is used by the token-exchange
 * route. Left unset, OAuth is reported as NOT_CONFIGURED rather than silently failing.
 */
export function getOAuthClientId(): string | null {
  const v = process.env.DERIV_OAUTH_CLIENT_ID?.trim();
  return v && v.length > 0 ? v : null;
}

/** Registered redirect URI. Must match the Deriv dashboard registration byte-for-byte. */
export function getRedirectUri(): string {
  const explicit = process.env.DERIV_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const base = process.env.FRONTEND_URL?.trim() || process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/callback`;
}

export const OAUTH_SCOPES = ['trade', 'account_manage', 'application_read'] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

/** Authenticated sockets are reached via a one-time OTP minted over REST. */
export function otpEndpoint(accountId: string): string {
  return `${DERIV_API_BASE}/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`;
}
export function accountsEndpoint(): string {
  return `${DERIV_API_BASE}/trading/v1/options/accounts`;
}
