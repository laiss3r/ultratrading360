import { parseClassicBalances, type BalanceUpdate } from './classicBalances';
import { identityRevision, sessionWrite } from './sessionWrites';
import { DERIV_APP_ID } from './config';
import { accountsFromAuthorizePayload, scopesFromAuthorizePayload } from './authorizeMap';
import type { AccountInfo, AuthorizeResult, AuthSession } from './types';

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
    let authorized: AuthorizeResult | null = null;
    const amounts = new Map<string, BalanceUpdate>();
    const confirmed = (): AuthorizeResult | null => {
      if (!authorized) return null;
      const current = authorized.account_loginid ?? authorized.loginid;
      const rows = authorized.account_list?.length ? authorized.account_list : [authorized];
      const known = rows.flatMap((row) => {
        const id = row.account_loginid ?? row.loginid;
        if (!id) return [];
        const update = amounts.get(id);
        const balance = update?.balance ?? row.balance ?? (id === current ? authorized!.balance : undefined);
        if (typeof balance !== 'number' || !Number.isFinite(balance)) return [];
        return [{ ...row, balance, currency: update?.currency ?? row.currency ?? authorized!.currency }];
      });
      return known.length ? { ...authorized, account_list: known } : null;
    };
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
    const timer = setTimeout(() => finish(confirmed()), timeoutMs);
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
        if (m.msg_type === 'authorize' && m.authorize) {
          authorized = m.authorize;
          const complete = confirmed();
          const expected = authorized.account_list?.length || 1;
          if (complete?.account_list?.length === expected) finish(complete);
          else ws?.send(JSON.stringify({ balance: 1, account: 'all', req_id: 2 }));
        } else if (m.msg_type === 'balance' && authorized) {
          for (const update of parseClassicBalances(m)) amounts.set(update.loginid, update);
          finish(confirmed());
        } else if (m.error) finish(confirmed());
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onerror = () => finish(confirmed());
    ws.onclose = () => finish(confirmed());
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
    const base = host.includes('://') ? host : `wss://${host}`; // scheme override = test stubs only
    const url = `${base}/websockets/v3?app_id=${encodeURIComponent(DERIV_APP_ID)}&l=EN&brand=deriv`;
    const payload = await attempt(url, token, Math.max(500, Math.floor(left / (hosts.length - hosts.indexOf(host)))));
    const accounts = accountsFromAuthorizePayload(payload);
    if (accounts.length > 0) {
      return { accounts, scopes: scopesFromAuthorizePayload(payload) ?? [] };
    }
  }
  return null;
}

/**
 * Full browser-side discovery run: consume the single-use handoff marker, read
 * the classic account list (with live balances) from Deriv's legacy socket, and
 * adopt the rows server-side. Shared by the callback page (every sign-in) and
 * the switcher's "Sync balances" action. Returns what the session now holds.
 */
export async function runClassicDiscovery(): Promise<{
  ok: boolean;
  accounts: Array<{ loginid: string; currency: string; balance: number; isVirtual: boolean }>;
  message: string;
  session?: AuthSession;
}> {
  const revision = identityRevision();
  const none = { ok: false, accounts: [] as Array<{ loginid: string; currency: string; balance: number; isVirtual: boolean }>, message: '' };
  try {
    const h = await fetch('/api/deriv/handoff', { method: 'POST', credentials: 'same-origin' });
    if (!h.ok) return { ...none, message: 'No handoff available.' };
    const hj = (await h.json()) as { ok?: boolean; token?: string; hosts?: string[] };
    if (!hj.ok || !hj.token) return { ...none, message: 'No handoff token issued.' };
    const credential = hj.token;
    hj.token = undefined;
    const disc = await discoverClassicAccounts(credential, hj.hosts ?? []);
    if (!disc || disc.accounts.length === 0) {
      return { ...none, message: 'Deriv’s legacy socket returned no accounts from this network.' };
    }
    const ad = await sessionWrite(async () => {
      if(revision!==identityRevision())throw new Error('Account selection changed; stale discovery discarded.');
      return fetch('/api/deriv/accounts/adopt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        accounts: disc.accounts.map((a) => ({
          loginid: a.account_loginid,
          currency: a.currency,
          balance: a.balance ?? 0,
          isVirtual: a.is_virtual === 1,
        })),
        scopes: disc.scopes,
      }),
    });
    });
    if (!ad.ok) return { ...none, message: `Adopt failed (HTTP ${ad.status}).` };
    const aj = (await ad.json()) as { accounts?: typeof none.accounts; session?: AuthSession };
    return { ok: true, accounts: aj.accounts ?? [], session: aj.session, message: 'Accounts synced from Deriv.' };
  } catch (e) {
    return { ...none, message: (e as Error).message };
  }
}
