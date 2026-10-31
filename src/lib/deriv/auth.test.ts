import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildNoAccountsSession, DerivAuthError, validateAccountsForToken } from './auth';

/**
 * Regression cover for the round-6 fix: an authenticated token whose profile has no
 * Options account must surface as the stable `no_accounts` code (which the OAuth
 * callback and PAT login convert into a flagged, connected session) — never as a
 * generic failure, and without any doomed socket round-trip.
 */

function stubAccountsJson(payload: unknown) {
  const fetchMock = vi.fn(async (_url: string) => ({
    ok: true,
    status: 200,
    json: async () => payload,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('validateAccountsForToken', () => {
  it('rejects with the stable no_accounts code when the listing is empty', async () => {
    const fetchMock = stubAccountsJson({ data: { accounts: [] } });
    const err = await validateAccountsForToken('a-valid-looking-token', 'oauth').catch((e) => e);
    expect(err).toBeInstanceOf(DerivAuthError);
    expect((err as DerivAuthError).code).toBe('no_accounts');
    // One REST call only: the new WebSocket has no authorize call, so no fallback hop.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a missing accounts key as empty rather than crashing', async () => {
    stubAccountsJson({ data: {} });
    const err = await validateAccountsForToken('a-valid-looking-token', 'oauth').catch((e) => e);
    expect((err as DerivAuthError).code).toBe('no_accounts');
  });

  it('returns the listing untouched when accounts exist', async () => {
    stubAccountsJson({
      data: {
        accounts: [
          { account_loginid: 'DOT90004580', currency: 'USD', balance: 10000, is_virtual: 1 },
        ],
      },
    });
    const { accounts, scopes } = await validateAccountsForToken('a-valid-looking-token', 'oauth');
    expect(accounts).toHaveLength(1);
    expect(accounts[0].account_loginid).toBe('DOT90004580');
    expect(scopes).toContain('trade');
  });

  it('maps a 401 to invalid_token, not no_accounts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => null })));
    const err = await validateAccountsForToken('a-valid-looking-token', 'oauth').catch((e) => e);
    expect((err as DerivAuthError).code).toBe('invalid_token');
  });
});

describe('buildNoAccountsSession', () => {
  it('flags the placeholder session and carries no token or fabricated identity', () => {
    const session = buildNoAccountsSession('oauth', 1234567890);
    expect(session.needsOptionsAccount).toBe(true);
    expect(session.loginid).toBe('');
    expect(session.currency).toBe('USD');
    expect(session.balance).toBe(0);
    expect(session.isVirtual).toBe(true);
    expect(session.scopes).toEqual([]);
    expect(session.expiresAt).toBe(1234567890);
    expect(JSON.stringify(session)).not.toMatch(/accessToken|"token"/i);
  });
});
