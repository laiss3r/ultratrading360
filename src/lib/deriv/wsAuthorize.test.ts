import { describe, expect, it } from 'vitest';
import { accountsFromAuthorizePayload, scopesFromAuthorizePayload } from './wsAuthorize';

describe('accounts from an authorize payload', () => {
  it('maps a full account_list', () => {
    const accounts = accountsFromAuthorizePayload({
      loginid: 'CR123',
      currency: 'USD',
      balance: 10,
      account_list: [
        { loginid: 'CR123', currency: 'USD', balance: 10, is_virtual: 0 },
        { loginid: 'VRTC9', currency: 'USD', balance: 4172.24, is_virtual: 1 },
      ],
    });
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({ account_loginid: 'CR123', is_virtual: 0 });
    expect(accounts[1]).toMatchObject({ account_loginid: 'VRTC9', is_virtual: 1, balance: 4172.24 });
  });

  it('synthesises the single authorised account when the list is absent', () => {
    // New-portal tokens can authorize without echoing account_list; the
    // loginid in the response is still a real authenticated account.
    const accounts = accountsFromAuthorizePayload({ loginid: 'CR456', currency: 'USD', balance: 0, is_virtual: 0 });
    expect(accounts).toEqual([{ account_loginid: 'CR456', currency: 'USD', balance: 0, is_virtual: 0, loginid: 'CR456' }]);
  });

  it('detects virtual accounts from the loginid prefix even without the flag', () => {
    const accounts = accountsFromAuthorizePayload({ loginid: 'VRTC1234' });
    expect(accounts[0].is_virtual).toBe(1);
  });

  it('returns nothing for an empty payload instead of inventing accounts', () => {
    expect(accountsFromAuthorizePayload(null)).toEqual([]);
    expect(accountsFromAuthorizePayload({})).toEqual([]);
    expect(accountsFromAuthorizePayload({ account_list: [] })).toEqual([]);
  });

  it('reads scopes when Deriv echoes them', () => {
    expect(scopesFromAuthorizePayload({ scopes: ['trade', 'read'] })).toEqual(['trade', 'read']);
    expect(scopesFromAuthorizePayload({ scopes: [] })).toBeNull();
    expect(scopesFromAuthorizePayload(null)).toBeNull();
  });
});
