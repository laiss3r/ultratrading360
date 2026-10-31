import { DERIV_APP_ID, accountsEndpoint, otpEndpoint } from './config';
import type { AdoptedRow } from './authorizeMap';

import type { AccountInfo, AuthSession } from './types';
import { accountsFromAuthorizePayload, authorizeViaSocket, scopesFromAuthorizePayload } from './wsAuthorize';

export class DerivAuthError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'auth_failed',
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'DerivAuthError';
  }
}

/** Scopes this platform needs before it will consider a token usable. */
export const MINIMUM_READ_SCOPES = ['read'];
export const TRADE_SCOPES = ['trade'];

function authHeaders(token: string, kind: 'pat' | 'oauth'): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  // Per Deriv docs: PAT tokens REQUIRE the Deriv-App-ID header on REST calls;
  // OAuth bearer tokens must NOT rely on it (the token already identifies the client).
  if (kind === 'pat') h['Deriv-App-ID'] = DERIV_APP_ID;
  return h;
}

/**
 * Validate ANY Deriv bearer credential (PAT or OAuth access token) by actually calling the API.
 *
 * A non-empty string is NEVER treated as valid: we require a 2xx from the accounts endpoint
 * AND a parseable, non-empty account list. Invalid, expired, revoked or under-scoped tokens
 * each produce a distinct, actionable message.
 */
export async function validateAccountsForToken(
  token: string,
  kind: 'pat' | 'oauth',
): Promise<{ accounts: AccountInfo[]; scopes: string[]; source: 'options_rest' | 'classic_ws' }> {
  const trimmed = token.trim();
  if (!trimmed) throw new DerivAuthError('Token is empty.', 'empty_token');
  if (trimmed.length < 8) {
    throw new DerivAuthError('Token is too short to be a Deriv credential.', 'malformed_token');
  }

  let res: Response;
  try {
    res = await fetch(accountsEndpoint(), {
      method: 'GET',
      headers: authHeaders(trimmed, kind),
      cache: 'no-store',
    });
  } catch (e) {
    throw new DerivAuthError(
      `Could not reach the Deriv API (${(e as Error).message}). Check your network connection.`,
      'network',
    );
  }

  if (res.status === 401) {
    throw new DerivAuthError(
      kind === 'pat'
        ? 'Deriv rejected this API token (401). It is invalid, expired, or has been revoked. Create a new one at app.deriv.com/account/api-token.'
        : 'Deriv rejected the OAuth access token (401). It has expired — Deriv issues no refresh token, so sign in again.',
      'invalid_token',
      401,
    );
  }
  if (res.status === 403) {
    throw new DerivAuthError(
      'Deriv refused this request (403). The token does not carry the scope needed to read accounts.',
      'insufficient_scope',
      403,
    );
  }
  if (res.status === 404) {
    throw new DerivAuthError(
      'The accounts endpoint returned 404. The Deriv API path may have changed — check developers.deriv.com.',
      'endpoint_not_found',
      404,
    );
  }
  if (!res.ok) {
    throw new DerivAuthError(`Deriv returned HTTP ${res.status}.`, 'http_error', res.status);
  }

  const body = (await res.json().catch(() => null)) as
    | { data?: { accounts?: AccountInfo[] }; accounts?: AccountInfo[] }
    | null;
  let accounts = body?.data?.accounts ?? body?.accounts ?? [];

  // An empty Options listing is NOT the end of discovery: the new REST endpoint
  // only knows Options accounts (DOT.../ROT...), while classic CR/VRTC accounts —
  // the ones every Deriv client's switcher shows — come from the legacy socket
  // authorize call. Try it (hardened handshake + host failover) before anyone is
  // told they have no accounts.
  let source: 'options_rest' | 'classic_ws' | 'classic_browser' = 'options_rest';
  let scopes: string[] | null = null;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    const authorize = await authorizeViaSocket(trimmed);
    const classic = accountsFromAuthorizePayload(authorize);
    if (classic.length > 0) {
      accounts = classic;
      scopes = scopesFromAuthorizePayload(authorize);
      source = 'classic_ws';
    }
  }

  // Authenticated token, zero accounts on BOTH paths: a legitimate state on the
  // new platform. Callers turn it into a flagged session that offers the explicit
  // demo-account creation step instead of failing the sign-in.
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new DerivAuthError(
      'Deriv authenticated this token, but the profile has no trading account on either the new Options listing or the classic account list yet. The Connect page offers the free demo creation step.',
      'no_accounts',
    );
  }
  return {
    accounts,
    scopes: scopes ?? (kind === 'pat' ? [...MINIMUM_READ_SCOPES] : ['trade', 'account_manage', 'application_read']),
    source,
  };
}

/**
 * Idempotent demo Options account creation (Deriv answers 201 with the new account,
 * or 200 with the existing one when the same parameters already exist). Used to
 * remove the manual "create" step on sign-in for profiles that have no account on
 * the new platform yet. Real accounts are NEVER created here.
 */
export async function ensureOptionsAccount(
  token: string,
  kind: 'pat' | 'oauth',
  currency = 'USD',
): Promise<AccountInfo | null> {
  try {
    const res = await fetch(accountsEndpoint(), {
      method: 'POST',
      headers: authHeaders(token.trim(), kind),
      cache: 'no-store',
      body: JSON.stringify({ currency, group: 'row', account_type: 'demo' }),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      data?:
        | { account_id?: string; currency?: string; balance?: number; account_type?: string }
        | Array<{ account_id?: string; currency?: string; balance?: number; account_type?: string }>;
    } | null;
    const raw = Array.isArray(body?.data) ? body?.data[0] : body?.data;
    if (!raw?.account_id) return null;
    return {
      account_loginid: raw.account_id,
      currency: (raw.currency ?? currency).toUpperCase(),
      balance: Number(raw.balance ?? 0),
      is_virtual: raw.account_type === 'demo' ? 1 : 0,
    };
  } catch {
    return null;
  }
}

/** Rows adopted from the browser-side classic discovery run. */
export function adoptedRowsToAccounts(rows: AdoptedRow[]): AccountInfo[] {
  return rows.map((r) => ({
    account_loginid: r.loginid,
    loginid: r.loginid,
    currency: r.currency,
    balance: r.balance,
    is_virtual: r.isVirtual ? 1 : 0,
  }));
}

/**
 * How a revalidation failure should be treated by the session route.
 *  - dead: Deriv definitively rejected the credential (expired/revoked/garbage).
 *  - empty: credential is fine, the profile simply lists no accounts.
 *  - transient: network/HTTP/endpoint trouble between us and Deriv - never a
 *    reason to log a signed-in user out (the classic mobile-navigation killer).
 */
export function classifyRevalidation(code: string): 'dead' | 'empty' | 'transient' {
  if (code === 'invalid_token' || code === 'empty_token' || code === 'malformed_token') return 'dead';
  if (code === 'no_accounts') return 'empty';
  return 'transient';
}

/**
 * Session for a token that Deriv authenticated but whose profile holds no Options
 * trading account yet. Placeholder identity, flagged so the UI offers the explicit
 * creation step; carries no token of its own — the caller attaches the real one.
 */
export function buildNoAccountsSession(kind: 'pat' | 'oauth', expiresAt: number | null): AuthSession {
  return {
    ...buildSession(kind, { account_loginid: '', currency: 'USD', balance: 0, is_virtual: 1 }, [], expiresAt),
    needsOptionsAccount: true,
  };
}

/** Convenience wrapper for the PAT login path. */
export async function validatePat(token: string): Promise<{ accounts: AccountInfo[]; scopes: string[]; source: 'options_rest' | 'classic_ws' }> {
  const { accounts, scopes, source } = await validateAccountsForToken(token, 'pat');
  // Trade capability is verified separately at buy time, and an unprivileged
  // token fails there with an explicit NOT AUTHORIZED error rather than being
  // assumed usable.
  return { accounts, scopes, source };
}

/** Build the session record the UI displays. Never contains the token. */
export function buildSession(
  kind: 'pat' | 'oauth',
  account: AccountInfo,
  scopes: string[],
  expiresAt: number | null,
): AuthSession {
  const isVirtual = account.is_virtual === 1 || /^VRT/.test(account.account_loginid ?? '');
  return {
    kind,
    loginid: account.account_loginid,
    currency: account.currency,
    balance: Number(account.balance ?? 0),
    isVirtual,
    scopes,
    expiresAt,
  };
}

/**
 * Mint the one-time password used to open an AUTHENTICATED socket.
 * The current API does not accept a raw token on the WebSocket — you exchange it for an OTP
 * over REST, then connect to /ws/demo or /ws/real with ?otp=.
 */
export async function getSocketOtp(token: string, kind: 'pat' | 'oauth', accountId: string): Promise<string> {
  const res = await fetch(otpEndpoint(accountId), {
    method: 'POST',
    headers: authHeaders(token, kind),
    cache: 'no-store',
  });
  if (res.status === 401) throw new DerivAuthError('Session expired while opening a trading socket (401).', 'invalid_token', 401);
  if (!res.ok) throw new DerivAuthError(`OTP request failed with HTTP ${res.status}.`, 'otp_failed', res.status);
  const body = (await res.json()) as { data?: { url?: string; otp?: string }; url?: string; otp?: string };
  const url = body?.data?.url ?? body?.url;
  if (url) return url;
  const otp = body?.data?.otp ?? body?.otp;
  if (!otp) throw new DerivAuthError('OTP response did not contain a url or otp field.', 'otp_failed');
  return otp;
}

/**
 * OAuth2 authorization-code + PKCE token exchange. Performed SERVER-SIDE only.
 * Deriv issues NO refresh token and NO client_secret — it is a public PKCE client.
 */
export async function exchangeAuthorizationCode(params: {
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<{ accessToken: string; expiresIn: number; tokenType: string }> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.clientId,
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: params.redirectUri,
  });
  let res: Response;
  try {
    res = await fetch('https://auth.deriv.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
      cache: 'no-store',
    });
  } catch (e) {
    throw new DerivAuthError(`Could not reach Deriv's token endpoint (${(e as Error).message}).`, 'network');
  }
  const body = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; token_type?: string; error?: string; error_description?: string }
    | null;

  if (!res.ok || !body?.access_token) {
    // Never include the code or verifier in the message — they are single-use secrets.
    const code = body?.error ?? `http_${res.status}`;
    const desc = body?.error_description ?? `Token exchange failed (HTTP ${res.status}).`;
    throw new DerivAuthError(humaniseOAuthError(code, desc), code);
  }
  return {
    accessToken: body.access_token,
    expiresIn: Number(body.expires_in ?? 0),
    tokenType: body.token_type ?? 'Bearer',
  };
}

function humaniseOAuthError(code: string, desc: string): string {
  switch (code) {
    case 'invalid_client':
      return 'Deriv does not recognise this OAuth client_id. Register an OAuth2 app at developers.deriv.com and set DERIV_OAUTH_CLIENT_ID.';
    case 'invalid_grant':
      return 'The authorization code was rejected — it expired, was already used, or the PKCE verifier did not match. Try signing in again.';
    case 'invalid_redirect_uri':
      return 'The redirect URI does not exactly match the one registered with Deriv (check scheme, host, port and trailing slash).';
    case 'access_denied':
      return 'You cancelled the Deriv authorization.';
    default:
      return desc;
  }
}
