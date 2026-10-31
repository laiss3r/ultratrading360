import WebSocket from 'ws';
import { DERIV_APP_ID, DERIV_WS_PUBLIC } from './config';
import type { AccountInfo, AuthorizeResult } from './types';

/**
 * The classic Deriv authentication call: open an authenticated socket and send
 * `{ authorize: token }`. Every Deriv client — official and community — relies
 * on it, and unlike the REST accounts listing it always echoes the authorized
 * loginid, currency, balance, scopes and (when present) the full account list,
 * which makes it the dependable fallback when a REST listing comes back empty.
 */
export async function authorizeViaSocket(token: string, appId: string = DERIV_APP_ID, timeoutMs = 9000): Promise<AuthorizeResult | null> {
  const url = DERIV_WS_PUBLIC.replace(/\/public$/, `/${encodeURIComponent(appId)}`);
  return await new Promise<AuthorizeResult | null>((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;
    const finish = (v: AuthorizeResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* already closed */
      }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      ws = new WebSocket(url);
    } catch {
      finish(null);
      return;
    }
    ws.on('open', () => {
      try {
        ws?.send(JSON.stringify({ authorize: token }));
      } catch {
        finish(null);
      }
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { msg_type?: string; authorize?: AuthorizeResult; error?: unknown };
        if (msg.msg_type === 'authorize') finish(msg.authorize ?? null);
        else if (msg.error) finish(null);
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.on('error', () => finish(null));
  });
}

/**
 * Pure mapping from an authorize payload to the account rows the session and
 * the switcher use. An authorize response normally carries `account_list`;
 * some tokens (scoped narrowly, or issued by the new developer portal) return
 * the authorized loginid without a list — that single account is still a real,
 * authenticated account, so it becomes one row instead of "no accounts".
 */
export function accountsFromAuthorizePayload(a: AuthorizeResult | null | undefined): AccountInfo[] {
  if (!a) return [];
  const list = Array.isArray(a.account_list) ? a.account_list : [];
  if (list.length > 0) {
    return list
      .filter((e) => Boolean(e && (e.loginid || e.account_loginid)))
      .map((e) => ({
        account_loginid: e.account_loginid || e.loginid || '',
        account_type: e.account_type,
        currency: e.currency || a.currency || 'USD',
        balance: typeof e.balance === 'number' ? e.balance : a.balance,
        is_virtual: e.is_virtual === 1 || /^VRT|CRSD|VRD/.test(e.account_loginid || e.loginid || '') ? 1 : 0,
        loginid: e.loginid || e.account_loginid,
      }));
  }
  if (a.loginid) {
    return [
      {
        account_loginid: a.loginid,
        currency: a.currency || 'USD',
        balance: typeof a.balance === 'number' ? a.balance : 0,
        is_virtual: a.is_virtual === 1 || /^VRT|CRSD|VRD/.test(a.loginid) ? 1 : 0,
        loginid: a.loginid,
      },
    ];
  }
  return [];
}

/** Scopes the token actually carries, when Deriv echoes them. */
export function scopesFromAuthorizePayload(a: AuthorizeResult | null | undefined): string[] | null {
  return a && Array.isArray(a.scopes) && a.scopes.length > 0 ? [...a.scopes] : null;
}
