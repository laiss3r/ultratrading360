
export interface BalanceUpdate { loginid: string; balance: number; currency: string }
export type BalanceStatus = 'connecting' | 'live' | 'stale';

/** Only account-specific amounts are accepted. Never use combined demo/real totals. */
export function parseClassicBalances(payload: unknown): BalanceUpdate[] {
  if (!payload || typeof payload !== 'object') return [];
  const b = (payload as { balance?: unknown }).balance;
  if (!b || typeof b !== 'object') return [];
  const value = b as Record<string, unknown>;
  const result: BalanceUpdate[] = [];
  const add = (row: unknown, id?: string) => {
    if (!row || typeof row !== 'object') return;
    const r = row as Record<string, unknown>;
    const loginid = typeof r.loginid === 'string' ? r.loginid : id;
    if (!loginid || !/^[A-Z]+\d+$/i.test(loginid) || typeof r.balance !== 'number' || !Number.isFinite(r.balance) || typeof r.currency !== 'string') return;
    result.push({ loginid, balance: r.balance, currency: r.currency });
  };
  if (value.accounts && typeof value.accounts === 'object' && !Array.isArray(value.accounts)) {
    for (const [id, row] of Object.entries(value.accounts)) add(row, id);
  } else add(value);
  return result;
}

/**
 * Read-only classic balance channel. Token is used for authorization only, cleared
 * after sending, never stored, and never used to buy. Reconnect fetches a new handoff.
 * The authenticated socket (not the token) lives across route changes.
 */
export function watchClassicBalances(
  onBalances: (updates: BalanceUpdate[]) => void,
  onStatus: (status: BalanceStatus, message?: string) => void,
): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  let hostIndex = 0;
  let attempts = 0;
  const clear = () => {
    if (heartbeat) clearInterval(heartbeat);
    if (deadline) clearTimeout(deadline);
    heartbeat = null; deadline = null;
  };
  const schedule = (message: string) => {
    if (stopped) return;
    onStatus('stale', message);
    clear();
    if (retry) return;
    retry = setTimeout(() => { retry = null; void connect(); }, Math.min(60000, 2000 * 2 ** Math.min(attempts++, 5)));
  };
  const connect = async () => {
    if (stopped) return;
    onStatus('connecting');
    let credential: string | undefined;
    try {
      const marker = await fetch('/api/deriv/handoff/refresh', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
      if (!marker.ok) throw new Error('Session unavailable for balance connection.');
      const response = await fetch('/api/deriv/handoff', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('Balance authorization unavailable.');
      const h = await response.json() as { token?: string; hosts?: string[] };
      credential = h.token;
      h.token = undefined;
      if (!credential || !h.hosts?.length) throw new Error('No classic balance endpoint available.');
      if (stopped) { credential = undefined; return; }
      const host = h.hosts[hostIndex++ % h.hosts.length];
      const base = host.includes('://') ? host : `wss://${host}`;
      const ws = new WebSocket(`${base}/websockets/v3?app_id=${encodeURIComponent(process.env.NEXT_PUBLIC_DERIV_APP_ID ?? '')}`);
      socket = ws;
      deadline = setTimeout(() => { ws.close(); schedule('Balance stream timed out; showing last known values.'); }, 12000);
      ws.onopen = () => {
        if (stopped || socket !== ws) { credential = undefined; ws.close(); return; }
        ws.send(JSON.stringify({ authorize: credential, req_id: 1 }));
        credential = undefined;
      };
      ws.onmessage = (event) => {
        if (stopped || socket !== ws) return;
        let frame: { msg_type?: string; error?: { message?: string } };
        try { frame = JSON.parse(String(event.data)); } catch { return; }
        if (frame.error) { ws.close(); schedule(frame.error.message ?? 'Balance subscription refused.'); return; }
        if (frame.msg_type === 'authorize') {
          // Classic login tokens support account:all. PATs can be refused here;
          // refusal is visible, never replaced by invented or cached "live" data.
          ws.send(JSON.stringify({ balance: 1, account: 'all', subscribe: 1, req_id: 2 }));
          heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ping: 1 })); }, 30000);
        }
        const updates = parseClassicBalances(frame);
        if (updates.length) {
          if (deadline) clearTimeout(deadline);
          deadline = null; attempts = 0;
          onBalances(updates); onStatus('live');
        }
      };
      ws.onerror = () => { credential = undefined; ws.close(); schedule('Balance connection failed; showing last known values.'); };
      ws.onclose = () => { credential = undefined; if (stopped || socket !== ws) return; socket = null; schedule('Balance stream disconnected; showing last known values.'); };
    } catch (e) {
      credential = undefined;
      schedule((e as Error).message);
    }
  };
  const online = () => { if (stopped || socket?.readyState === WebSocket.OPEN) return; if (retry) clearTimeout(retry); retry = null; void connect(); };
  if (typeof window !== 'undefined') window.addEventListener('online', online);
  void connect();
  return () => {
    stopped = true; clear(); if (retry) clearTimeout(retry);
    socket?.close(); socket = null;
    if (typeof window !== 'undefined') window.removeEventListener('online', online);
  };
}
