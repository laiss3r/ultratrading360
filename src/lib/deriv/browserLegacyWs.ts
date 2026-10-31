import { accountsFromAuthorizePayload, scopesFromAuthorizePayload } from './authorizeMap';
import type { AccountInfo, AuthorizeResult } from './types';

/**
 * Browser-side classic account discovery: the one call every Deriv client makes
 * (`{ authorize: token }` on the legacy v3 socket), run from the visitor's own
 * network because Deriv's legacy edge refuses cloud IPs. Used exactly once per
 * sign-in via the single-use handoff route; the token lives only in this
 * function's scope and is discarded when it returns. Nothing is persisted.
 */
export interface ClassicDiscovery {
  accounts: AccountInfo[];
  scopes: string[];
}

function attempt(url: string, token: string, timeoutMs: number): Promise<AuthorizeResult | null> {
  return new Promise((resolve) => {
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
    ws.onopen = () => {
      try {
        ws?.send(JSON.stringify({ authorize: token, req_id: 1 }));
      } catch {
        finish(null);
      }
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(String(ev.data)) as { msg_type?: string; authorize?: AuthorizeResult; error?: unknown };
        if (m.msg_type === 'authorize' && m.authorize) finish(m.authorize);
        else if (m.error) finish(null);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onerror = () => finish(null);
    ws.onclose = () => finish(null);
  });
}

export async function discoverClassicAccounts(
  token: string,
  hosts: string[],
  timeoutMs = 9000,
): Promise<ClassicDiscovery | null> {
  const deadline = Date.now() + timeoutMs;
  for (const host of hosts) {
    const left = deadline - Date.now();
    if (left < 500) break;
    const url = `wss://${host}/websockets/v3?app_id=${encodeURIComponent(process.env.NEXT_PUBLIC_DERIV_APP_ID ?? '')}&l=EN&brand=deriv`;
    const payload = await attempt(url, token, left);
    const accounts = accountsFromAuthorizePayload(payload);
    if (accounts.length > 0) {
      return { accounts, scopes: scopesFromAuthorizePayload(payload) ?? [] };
    }
  }
  return null;
}
