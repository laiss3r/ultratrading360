import type { AccountInfo, AuthorizeResult } from './types';

/**
 * Pure mapping from a classic `authorize` payload to account rows. Shared by the
 * server-side legacy fallback and the browser-side discovery run, so both paths
 * produce identical switcher rows (loginid, Demo/Real, balance, currency).
 */
export function accountsFromAuthorizePayload(a: AuthorizeResult | null): AccountInfo[] {
  if (!a) return [];
  const list = Array.isArray(a.account_list) ? a.account_list : [];
  const rows = list.length > 0
    ? list.map((row) => {
        const loginid = (row.loginid ?? row.account_loginid ?? '') as string;
        const virt: 0 | 1 = row.is_virtual === 1 || /^VRT|CRSD|VRD/.test(loginid) ? 1 : 0;
        return {
          account_loginid: loginid,
          loginid,
          currency: (row.currency ?? 'USD') as string,
          balance: Number(row.balance ?? 0),
          is_virtual: virt,
        };
      })
    : (() => {
        const loginid = (a.account_loginid ?? a.loginid ?? '') as string;
        if (!loginid) return [];
        return [
          {
            account_loginid: loginid,
            loginid,
            currency: (a.currency ?? 'USD') as string,
            balance: Number(a.balance ?? 0),
            is_virtual: (a.is_virtual === 1 || /^VRT|CRSD|VRD/.test(loginid)) ? 1 as const : 0 as const,
          },
        ];
      })();
  return rows.filter((r) => r.account_loginid);
}

export function scopesFromAuthorizePayload(a: AuthorizeResult | null): string[] | null {
  const raw = a?.scope ?? a?.scopes;
  if (typeof raw === 'string' && raw.trim()) return raw.trim().split(/\s+/);
  if (Array.isArray(raw) && raw.length > 0) return raw.map(String);
  return null;
}

/** One row as the browser discovery run posts it back to the adopt route. */
export interface AdoptedRow {
  loginid: string;
  currency: string;
  balance: number;
  isVirtual: boolean;
}

/** Defence-in-depth for the adopt route: drop anything that is not a clean row. */
export function sanitizeAdoptedAccounts(rows: unknown): AdoptedRow[] {
  if (!Array.isArray(rows)) return [];
  const out: AdoptedRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const loginid = typeof o.loginid === 'string' ? o.loginid.trim() : '';
    if (!loginid || loginid.length > 32) continue;
    const currency = typeof o.currency === 'string' && o.currency.trim() ? o.currency.trim().toUpperCase().slice(0, 8) : 'USD';
    const balance = typeof o.balance === 'number' && Number.isFinite(o.balance) ? o.balance : 0;
    out.push({ loginid, currency, balance, isVirtual: o.isVirtual === true });
    if (out.length >= 20) break;
  }
  return out;
}
