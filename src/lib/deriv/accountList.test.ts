import { describe, expect, it } from 'vitest';
import { parseOptionsAccounts } from './accountList';

describe('official 2026 Options listing shape', () => {
  it('reads the data ARRAY and maps account_id/account_type for both environments', () => {
    const rows = parseOptionsAccounts({ data: [
      { account_id: 'DOT93175071', account_type: 'demo', currency: 'USD', balance: 4172.24, group: 'row', status: 'active' },
      { account_id: 'ROT123456', account_type: 'real', currency: 'USD', balance: 0, group: 'row', status: 'active' },
    ] });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ account_loginid: 'DOT93175071', is_virtual: 1, balance: 4172.24 });
    expect(rows[1]).toMatchObject({ account_loginid: 'ROT123456', is_virtual: 0, balance: 0 });
  });
  it('retains compatibility with the older nested account representation', () => {
    expect(parseOptionsAccounts({ data: { accounts: [{ account_loginid: 'CR1', currency: 'USD', is_virtual: 0, balance: 5 }] } })[0].account_loginid).toBe('CR1');
  });
  it('does not fabricate a real account when only Demo is returned', () => {
    const rows = parseOptionsAccounts({ data: [{ account_id: 'DOT1', currency: 'USD', account_type: 'demo', balance: 0 }] });
    expect(rows.filter((r) => r.is_virtual === 0)).toEqual([]);
  });
  it('drops missing identity, invalid balances, and unclassified rows', () => {
    expect(parseOptionsAccounts({ data: [{ currency: 'USD' }, { account_id: 'ROT1', currency: 'USD', balance: NaN }, { account_id: 'unknown', currency: 'USD' }] })).toEqual([]);
  });
});
