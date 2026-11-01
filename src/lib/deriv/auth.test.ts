import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adoptedRowsToAccounts, buildNoAccountsSession, classifyRevalidation, DerivAuthError, ensureOptionsAccount, validateAccountsForToken } from './auth';
import { sanitizeAdoptedAccounts } from './authorizeMap';
import { authorizeViaSocket, classicWsUrl } from './wsAuthorize';

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

beforeEach(() => {
  // Keep discovery deterministic: the legacy socket failover list points at an
  // unreachable host so tests never touch the real network.
  process.env.DERIV_LEGACY_WS_HOSTS = '127.0.0.1:9';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DERIV_LEGACY_WS_HOSTS;
});

describe('validateAccountsForToken', () => {
  it('does not discard the official data-array Real account or try classic fallback', async () => {
    const fetchMock = stubAccountsJson({ data: [
      { account_id: 'DOT93175071', balance: 4172.24, currency: 'USD', account_type: 'demo', group: 'row', status: 'active' },
      { account_id: 'ROT123456', balance: 0, currency: 'USD', account_type: 'real', group: 'row', status: 'active' },
    ] });
    const result = await validateAccountsForToken('synthetic-token', 'oauth');
    expect(result.source).toBe('options_rest');
    expect(result.accounts.map((a) => a.account_loginid)).toEqual(['DOT93175071', 'ROT123456']);
    expect(result.accounts[1].is_virtual).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects with the stable no_accounts code when the listing is empty', async () => {
    const fetchMock = stubAccountsJson({ data: { accounts: [] } });
    const err = await validateAccountsForToken('a-valid-looking-token', 'oauth').catch((e) => e);
    expect(err).toBeInstanceOf(DerivAuthError);
    expect((err as DerivAuthError).code).toBe('no_accounts');
    // Accounts plus two bounded, read-only migration checks; no legacy socket hop.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('separates malformed responses from genuine empty listings', async () => {
    stubAccountsJson({ data: {} });
    const err = await validateAccountsForToken('a-valid-looking-token', 'oauth').catch((e) => e);
    expect((err as DerivAuthError).code).toBe('account_response_invalid');
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

describe('classifyRevalidation', () => {
  it('treats only definitive rejections as dead', () => {
    expect(classifyRevalidation('invalid_token')).toBe('dead');
    expect(classifyRevalidation('malformed_token')).toBe('dead');
    expect(classifyRevalidation('empty_token')).toBe('dead');
  });
  it('keeps empty listings separate from transient faults', () => {
    expect(classifyRevalidation('no_accounts')).toBe('empty');
    expect(classifyRevalidation('network')).toBe('transient');
    expect(classifyRevalidation('http_error')).toBe('transient');
    expect(classifyRevalidation('endpoint_not_found')).toBe('transient');
    expect(classifyRevalidation('')).toBe('transient');
  });
});

describe('ensureOptionsAccount (idempotent demo create)', () => {
  it('parses a 201 created array into one row', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ data: [{ account_id: 'DOT90004580', currency: 'USD', balance: 10000, account_type: 'demo' }] }),
    })));
    const row = await ensureOptionsAccount('tokentoken', 'oauth');
    expect(row?.account_loginid).toBe('DOT90004580');
    expect(row?.is_virtual).toBe(1);
  });

  it('parses a 200 already-exists single object', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { account_id: 'ROT123', currency: 'USD', balance: 0, account_type: 'real' } }),
    })));
    const row = await ensureOptionsAccount('tokentoken', 'oauth');
    expect(row?.account_loginid).toBe('ROT123');
    expect(row?.is_virtual).toBe(0);
  });

  it('returns null on refusals and empty payloads instead of inventing accounts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ message: 'nope' }) })));
    expect(await ensureOptionsAccount('tokentoken', 'oauth')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    expect(await ensureOptionsAccount('tokentoken', 'oauth')).toBeNull();
  });
});

describe('adopted classic rows', () => {
  it('sanitises away junk and keeps clean rows', () => {
    const rows = sanitizeAdoptedAccounts([
      { loginid: 'VRTC123', currency: 'usd', balance: 4172.24, isVirtual: true },
      { loginid: 'CR456', currency: 'USD', balance: 0, isVirtual: false },
      { loginid: '', balance: 1 },
      { loginid: 'x'.repeat(40), balance: 1 },
      'nope',
      null,
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ loginid: 'VRTC123', currency: 'USD', balance: 4172.24, isVirtual: true });
    const accounts = adoptedRowsToAccounts(rows);
    expect(accounts[0].is_virtual).toBe(1);
    expect(accounts[1].is_virtual).toBe(0);
  });
});

describe('classic socket authorize fallback', () => {
  it('builds the legacy v3 URL with app id, language and brand', () => {
    expect(classicWsUrl('ws.derivws.com', '34P4UiyGfp4cBEekMAF9S')).toBe(
      'wss://ws.derivws.com/websockets/v3?app_id=34P4UiyGfp4cBEekMAF9S&l=EN&brand=deriv',
    );
  });

  it('degrades to null when every legacy host is unreachable, fast', async () => {
    const started = Date.now();
    const res = await authorizeViaSocket('sometoken', '1089', 1500, ['127.0.0.1:9']);
    expect(res).toBeNull();
    expect(Date.now() - started).toBeLessThan(1500);
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
