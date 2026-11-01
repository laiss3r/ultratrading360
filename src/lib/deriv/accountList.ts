import type { AccountInfo } from './types';

/** Current official GET /options/accounts response: data is an ARRAY, not data.accounts.
 * Retain older nested responses for compatibility, but normalize identity/type once.
 * Never infer a real account from a demo balance or synthesize a missing login ID.
 */
export function optionsAccountRows(payload: unknown): unknown[] | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;
  const nested = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : null;
  const rows = Array.isArray(body.data) ? body.data : nested?.accounts ?? body.accounts;
  if (!Array.isArray(rows)) return null;
  return rows;
}

export function parseOptionsAccounts(payload: unknown): AccountInfo[] {
  const rows = optionsAccountRows(payload);
  if (!rows) return [];
  const accounts = new Map<string, AccountInfo>();
  for (const value of rows) {
    if (!value || typeof value !== 'object') continue;
    const r = value as Record<string, unknown>;
    const id = r.account_id ?? r.account_loginid ?? r.loginid;
    if (typeof id !== 'string' || !id.trim() || typeof r.currency !== 'string') continue;
    const demo = r.account_type === 'demo' ? true : r.account_type === 'real' ? false : r.is_virtual === 1 ? true : r.is_virtual === 0 ? false : /^(DOT|VRT|CRSD|VRD)/i.test(id) ? true : /^(ROT|CR)/i.test(id) ? false : null;
    // Canonical decimal strings are used by some broker money fields. Never
    // coerce null, whitespace, booleans or objects into a fabricated zero.
    const balance = typeof r.balance === 'number' ? r.balance : typeof r.balance === 'string' && /^-?\d+(?:\.\d+)?$/.test(r.balance) ? Number(r.balance) : undefined;
    if (demo === null || (r.balance !== undefined && (balance === undefined || !Number.isFinite(balance)))) continue;
    accounts.set(id, { account_loginid: id, loginid: id, currency: r.currency,
      balance, account_type: demo ? 'demo' : 'real', is_virtual: demo ? 1 : 0 });
  }
  return [...accounts.values()];
}
