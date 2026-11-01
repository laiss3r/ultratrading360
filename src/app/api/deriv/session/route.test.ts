import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSession, type StoredSession } from '@/lib/oauth/session';

const edge = vi.hoisted(() => ({ cookie: '', validate: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (name: string) => name === 'ut_session' ? { value: edge.cookie } : undefined }) }));
vi.mock('@/lib/deriv/auth', async (original) => ({ ...(await original<typeof import('@/lib/deriv/auth')>()), validateAccountsForToken: edge.validate }));
import { GET } from './route';

const session: StoredSession = { accessToken: 'test-only-credential', kind: 'oauth', loginid: 'VRTC123', currency: 'USD', balance: 4172.24, isVirtual: true, scopes: ['trade'], expiresAt: null };
beforeEach(() => { process.env.DERIV_SESSION_SECRET = 'unit-test-secret-only'; edge.cookie = encryptSession(session); edge.validate.mockReset(); });

describe('session revalidation isolation', () => {
  it('boot does not make a Deriv call', async () => {
    const r = await GET(new Request('https://example.test/api/deriv/session'));
    expect((await r.json()).authenticated).toBe(true);
    expect(edge.validate).not.toHaveBeenCalled();
  });
  it.each(['network', 'http_error', 'no_accounts'])('preserves authentication on %s', async (code) => {
    edge.validate.mockRejectedValue(Object.assign(new Error('fixture failure'), { code }));
    const r = await GET(new Request('https://example.test/api/deriv/session?refresh=1'));
    const data = await r.json();
    expect(data.authenticated).toBe(true);
    expect(data.session.loginid).toBe(session.loginid);
    expect(data.session.balance).toBe(4172.24);
  });
  it('does not borrow a different account balance', async () => {
    edge.validate.mockResolvedValue({ accounts: [{ account_loginid: 'ROT1', balance: 0, currency: 'USD', is_virtual: 0 }] });
    const data = await (await GET(new Request('https://example.test/api/deriv/session?refresh=1'))).json();
    expect(data.session.balance).toBe(4172.24);
    expect(data.session.isVirtual).toBe(true);
  });
  it('rejects a definitively revoked credential', async () => {
    edge.validate.mockRejectedValue(Object.assign(new Error('revoked'), { code: 'invalid_token' }));
    const r = await GET(new Request('https://example.test/api/deriv/session?refresh=1'));
    expect(r.status).toBe(401);
    expect((await r.json()).authenticated).toBe(false);
  });
  it('rejects expired sessions without a network call', async () => {
    edge.cookie = encryptSession({ ...session, expiresAt: Date.now() - 1 });
    const data = await (await GET(new Request('https://example.test/api/deriv/session'))).json();
    expect(data.authenticated).toBe(false);
    expect(data.reason).toBe('expired');
    expect(edge.validate).not.toHaveBeenCalled();
  });
});


describe('fresh-login Real preference', () => {
  it('reports the Real candidate without a stale GET overwriting the selected cookie', async () => {
    edge.cookie = encryptSession({ ...session, initialRealAccountPending: true });
    edge.validate.mockResolvedValue({ accounts: [{ account_loginid: 'ROT1', balance: 0, currency: 'USD', is_virtual: 0 }] });
    const response=await GET(new Request('https://example.test/api/deriv/session?refresh=1'));
    const data=await response.json();
    expect(data.session.loginid).toBe(session.loginid);expect(data.preferReal).toBe(true);
    expect(data.accounts).toContainEqual({loginid:'ROT1',balance:0,balanceKnown:true,currency:'USD',isVirtual:false});
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(data.session.accessToken).toBeUndefined();
    expect(data.session.initialRealAccountPending).toBeUndefined();
  });
  it('keeps Demo if no Real account is returned', async () => {
    edge.cookie = encryptSession({ ...session, initialRealAccountPending: true });
    edge.validate.mockResolvedValue({ accounts: [{ account_loginid: session.loginid, balance: 4172.24, currency: 'USD', is_virtual: 1 }] });
    const data = await (await GET(new Request('https://example.test/api/deriv/session?refresh=1'))).json();
    expect(data.session.loginid).toBe(session.loginid);
  });
});
