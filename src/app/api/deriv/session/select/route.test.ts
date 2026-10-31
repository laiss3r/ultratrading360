import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptSession, encryptSession, SESSION_COOKIE, type StoredSession } from '@/lib/oauth/session';
const edge = vi.hoisted(() => ({ cookie: '', validate: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: edge.cookie }) }) }));
vi.mock('@/lib/deriv/auth', async (original) => ({ ...(await original<typeof import('@/lib/deriv/auth')>()), validateAccountsForToken: edge.validate }));
import { POST } from './route';
const demo = { account_loginid: 'DOT1', is_virtual: 1 as const, currency: 'USD', balance: 100 };
const real = { account_loginid: 'ROT1', is_virtual: 0 as const, currency: 'USD', balance: 0 };
const session: StoredSession = { accessToken: 'test-only-credential', kind: 'oauth', loginid: 'DOT1', currency: 'USD', balance: 100, isVirtual: true, scopes: ['trade'], expiresAt: null, accountRows: [demo] };
const request = (loginid: string) => new Request('https://example.test/api/deriv/session/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginid }) });
beforeEach(() => { process.env.DERIV_SESSION_SECRET = 'unit-test-secret-only'; edge.cookie = encryptSession(session); edge.validate.mockReset(); edge.validate.mockResolvedValue({ accounts: [demo, real] }); });
describe('server-backed real account selection', () => {
  it('selects a newly discovered Real row even when the cookie listed only Demo', async () => {
    const response = await POST(request('ROT1')); const data = await response.json();
    expect(response.status).toBe(200); expect(data.session).toMatchObject({ loginid: 'ROT1', isVirtual: false, balance: 0 });
    const saved = decryptSession(response.cookies.get(SESSION_COOKIE)!.value)!;
    expect(saved.loginid).toBe('ROT1'); expect(saved.accountRows).toHaveLength(2);
    expect(data.session.accessToken).toBeUndefined();
  });
  it('never invents a Real account when Deriv returns only Demo', async () => {
    edge.validate.mockResolvedValue({ accounts: [demo] });
    expect((await POST(request('ROT1'))).status).toBe(404);
  });
  it('refuses a revoked token rather than selecting cached metadata', async () => {
    edge.validate.mockRejectedValue(Object.assign(new Error('revoked'), { code: 'invalid_token' }));
    expect((await POST(request('DOT1'))).status).toBe(401);
  });
  it('can select an existing display row during an upstream outage', async () => {
    edge.validate.mockRejectedValue(Object.assign(new Error('offline'), { code: 'network' }));
    expect((await POST(request('DOT1'))).status).toBe(200);
  });
});

it('an explicit Demo choice cancels pending initial Real preference', async () => {
  edge.cookie=encryptSession({...session,initialRealAccountPending:true});
  const response=await POST(request('DOT1'));
  const saved=decryptSession(response.cookies.get(SESSION_COOKIE)!.value)!;
  expect(saved.loginid).toBe('DOT1');expect(saved.initialRealAccountPending).toBe(false);
});
