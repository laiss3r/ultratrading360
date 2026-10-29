/**
 * PKCE + state generation for Deriv's OAuth2 authorization-code flow.
 *
 * Deriv is a PUBLIC PKCE client: there is no client_secret and no refresh token.
 * The code_verifier is generated server-side and stored in a short-lived httpOnly cookie
 * rather than sessionStorage, because the token exchange also happens server-side. That is
 * strictly stronger than the browser-storage pattern the docs describe for SPA clients.
 */

const VERIFIER_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** Generate a code_verifier. Node uses crypto.randomBytes; browsers use crypto.getRandomValues. */
export function generateCodeVerifier(length = 64): string {
  if (length < 43 || length > 128) throw new RangeError('code_verifier length must be 43..128');
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += VERIFIER_CHARSET[bytes[i] % VERIFIER_CHARSET.length];
  return out;
}

/** code_challenge = BASE64URL(SHA256(code_verifier)), method always S256. */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const digest = await sha256(new TextEncoder().encode(verifier));
  return base64UrlEncode(digest);
}

/** Random hex state for CSRF protection. Fresh per request, never reused. */
export function generateState(bytes = 16): string {
  return toHex(randomBytes(bytes));
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return typeof btoa === 'function'
    ? btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    : Buffer.from(bytes).toString('base64url');
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Both the Node runtime (>= 19) and every modern browser expose WebCrypto on globalThis,
 * so one implementation serves the API routes and the client without a conditional require.
 */
function webcrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.getRandomValues || !c.subtle) {
    throw new Error('WebCrypto is unavailable in this runtime; refusing to generate weak randomness.');
  }
  return c;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  webcrypto().getRandomValues(out);
  return out;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const d = await webcrypto().subtle.digest('SHA-256', data as BufferSource);
  return new Uint8Array(d);
}

/** Constant-time string comparison — used for state validation to avoid timing leaks. */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  scope: string[];
  state: string;
  codeChallenge: string;
  prompt?: 'registration';
}

/** Build the Deriv authorization URL. */
export function buildAuthorizeUrl(p: AuthorizeParams): string {
  const u = new URL('https://auth.deriv.com/oauth2/auth');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', p.clientId);
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('scope', p.scope.join(' '));
  u.searchParams.set('state', p.state);
  u.searchParams.set('code_challenge', p.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (p.prompt) u.searchParams.set('prompt', p.prompt);
  return u.toString();
}
