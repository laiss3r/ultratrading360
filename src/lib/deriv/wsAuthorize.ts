import WebSocket from 'ws';
import { DERIV_APP_ID, legacyWsHosts } from './config';
import type { AuthorizeResult } from './types';

/**
 * The classic Deriv authentication call: `{ authorize: token }` on a legacy
 * v3 socket. This is the call every Deriv client — official and community —
 * uses to obtain the account list the switcher shows (loginid, currency,
 * balance, virtual flag, full account_list), and it is the only call that
 * echoes CLASSIC accounts (CR…/VRTC…): the new platform's REST listing only
 * knows Options accounts (DOT…/ROT…), and the new WebSocket has no authorize
 * method at all (it authenticates via OTP and answers UnknownMethod).
 *
 * Reachability notes, verified empirically (Oct 2026):
 *  - the legacy edge sits behind Cloudflare and answers HTTP 520 to bare
 *    cloud-side handshakes, so we send browser-like Origin/User-Agent;
 *  - hosts are tried in failover order (ws.derivws.com → ws.binaryws.com →
 *    wss.derivws.com) within one shared deadline;
 *  - failures degrade to null: the caller then falls back to the flagged
 *    "no Options account yet" session instead of failing the sign-in.
 */
const BROWSER_HEADERS = {
  Origin: 'https://ultratrading360.vercel.app',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
};

export function classicWsUrl(host: string, appId: string): string {
  return `wss://${host}/websockets/v3?app_id=${encodeURIComponent(appId)}&l=EN&brand=deriv`;
}

function attempt(url: string, token: string, timeoutMs: number): Promise<AuthorizeResult | null> {
  return new Promise<AuthorizeResult | null>((resolve) => {
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
      ws = new WebSocket(url, { handshakeTimeout: Math.min(4000, timeoutMs), headers: BROWSER_HEADERS });
    } catch {
      finish(null);
      return;
    }
    ws.on('open', () => {
      try {
        ws?.send(JSON.stringify({ authorize: token, req_id: 1 }));
      } catch {
        finish(null);
      }
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as {
          msg_type?: string;
          authorize?: AuthorizeResult;
          error?: { code?: string };
        };
        if (msg.msg_type === 'authorize' && msg.authorize) finish(msg.authorize);
        else if (msg.error) finish(null); // invalid token, scope refusal, etc.
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.on('error', () => finish(null));
    ws.on('close', () => finish(null));
  });
}

/** Unauthenticated reachability probe used by the live check route: does the
 *  legacy edge accept our handshake from this network at all? */
export async function pingLegacyWs(timeoutMs = 2500, hosts: string[] = legacyWsHosts()): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (const host of hosts) {
    const left = deadline - Date.now();
    if (left < 300) break;
    const ok = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (v: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { ws?.close(); } catch { /* closed */ }
        resolve(v);
      };
      const timer = setTimeout(() => finish(false), left);
      let ws: WebSocket | null = null;
      try {
        ws = new WebSocket(classicWsUrl(host, DERIV_APP_ID), { handshakeTimeout: Math.min(2000, left), headers: BROWSER_HEADERS });
      } catch {
        finish(false);
        return;
      }
      ws.on('open', () => { try { ws?.send(JSON.stringify({ ping: 1 })); } catch { finish(false); } });
      ws.on('message', (raw) => {
        try {
          const m = JSON.parse(raw.toString()) as { msg_type?: string };
          finish(m.msg_type === 'ping');
        } catch { finish(false); }
      });
      ws.on('error', () => finish(false));
    });
    if (ok) return true;
  }
  return false;
}

export async function authorizeViaSocket(
  token: string,
  appId: string = DERIV_APP_ID,
  timeoutMs = 7000,
  hosts: string[] = legacyWsHosts(),
): Promise<AuthorizeResult | null> {
  const deadline = Date.now() + timeoutMs;
  for (const host of hosts) {
    const left = deadline - Date.now();
    if (left < 500) break;
    const res = await attempt(classicWsUrl(host, appId), token, left);
    if (res) return res;
  }
  return null;
}

export { accountsFromAuthorizePayload, scopesFromAuthorizePayload } from './authorizeMap';
