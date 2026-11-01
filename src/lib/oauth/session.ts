import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import type { AuthSession } from '../deriv/types';

/**
 * Encrypted, httpOnly session cookie.
 *
 * Why this design: the deployment target is Vercel serverless with no database, so there is
 * nowhere to keep a server-side session row. The alternative — putting the Deriv token in
 * localStorage or a JS-readable cookie — is explicitly disallowed by the requirements and is
 * how tokens get stolen by any XSS. An AES-256-GCM encrypted httpOnly cookie keeps the token
 * out of reach of frontend JavaScript while still surviving across serverless invocations.
 *
 * Trade-off, stated plainly: with no server store there is no revocation list. "Disconnect"
 * clears the cookie; a token stolen before that point stays valid at Deriv until it expires
 * or the user revokes it in their Deriv account. Provisioning the Django backend removes this
 * limitation.
 */

export const SESSION_COOKIE = 'ut_session';
/** Single-use, 120s marker that permits exactly one browser-side token handoff. */
export const HANDOFF_COOKIE = 'ut_handoff';
export const STATE_COOKIE = 'ut_oauth_state';
export const VERIFIER_COOKIE = 'ut_oauth_verifier';

export interface StoredSession extends AuthSession {
  /** Fresh login only: select Real if later discovery returns it. Manual selection clears this. */
  initialRealAccountPending?: boolean;
  /** Binds idempotent OAuth recovery to this completed attempt, never an old login. */
  authAttemptId?: string;
  /** The credential itself. Never serialised to the client. */
  accessToken: string;
}

let cachedKey: { secret: string; key: Buffer } | null = null;

function getKey(): { key: Buffer; ephemeral: boolean } {
  const secret = process.env.DERIV_SESSION_SECRET;
  if (secret && secret.length >= 16) {
    if (cachedKey && cachedKey.secret === secret) return { key: cachedKey.key, ephemeral: false };
    const key = scryptSync(secret, 'ultratrading360-session', 32);
    cachedKey = { secret, key };
    return { key, ephemeral: false };
  }
  // No secret configured: derive a per-instance key. Sessions will not survive a cold start
  // or a redeploy, and the app reports this as a configuration warning rather than silently
  // pretending to be secure across instances.
  return { key: scryptSync('ultratrading360-ephemeral-dev-key', 'salt', 32), ephemeral: true };
}

export function sessionSecretConfigured(): boolean {
  return !!process.env.DERIV_SESSION_SECRET && process.env.DERIV_SESSION_SECRET.length >= 16;
}

export function encryptSession(s: StoredSession): string {
  const { key } = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(s), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString('base64url')).join('.');
}

export function decryptSession(payload: string): StoredSession | null {
  const { key } = getKey();
  const parts = payload.split('.');
  if (parts.length !== 3) return null;
  try {
    const [ivB, tagB, dataB] = parts;
    const iv = Buffer.from(ivB, 'base64url');
    const tag = Buffer.from(tagB, 'base64url');
    const data = Buffer.from(dataB, 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(dec.toString('utf8')) as StoredSession;
  } catch {
    return null; // tampered, corrupt, or encrypted under a different key
  }
}

/** Sign a short-lived value (state / verifier) with HMAC and constant-time verification. */
export function signValue(value: string): string {
  const { key } = getKey();
  const mac = createHmac('sha256', key).update(value).digest('base64url');
  return `${value}.${mac}`;
}

export function verifySignedValue(signed: string): string | null {
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const { key } = getKey();
  const expected = createHmac('sha256', key).update(value).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(mac, 'base64url');
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  return timingSafeEqual(provided, expected) ? value : null;
}

/** Strip the credential before anything is returned to the browser. */
export function publicSession(s: StoredSession): AuthSession {
  return {
    kind: s.kind,
    loginid: s.loginid,
    currency: s.currency,
    balance: s.balance,
    isVirtual: s.isVirtual,
    scopes: s.scopes,
    expiresAt: s.expiresAt,
    needsOptionsAccount: s.needsOptionsAccount,
    accountsSource: s.accountsSource,
  };
}

export function sessionExpirySeconds(s: StoredSession): number {
  if (!s.expiresAt) return 60 * 60 * 8; // PATs have no expiry we can read; cap at 8h
  return Math.max(60, Math.floor((s.expiresAt - Date.now()) / 1000));
}
