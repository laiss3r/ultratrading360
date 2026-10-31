import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseClassicBalances, watchClassicBalances } from './classicBalances';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('classic balance identity', () => {
  it('accepts one identified account, including a genuine zero', () => {
    expect(parseClassicBalances({ balance: { loginid: 'CR123', balance: 0, currency: 'USD' } })).toEqual([{ loginid: 'CR123', balance: 0, currency: 'USD' }]);
  });
  it('maps an all-account response without summing Demo and Real', () => {
    const rows = parseClassicBalances({ balance: { accounts: { CR1: { balance: 7, currency: 'USD' }, VRTC2: { balance: 100, currency: 'USD' } }, total: { deriv: { amount: 107, currency: 'USD' } } } });
    expect(rows).toHaveLength(2); expect(rows[0].balance).toBe(7); expect(rows[1].balance).toBe(100);
  });
  it('rejects unidentified, malformed, and total-only responses', () => {
    expect(parseClassicBalances({ balance: { balance: 10, currency: 'USD' } })).toEqual([]);
    expect(parseClassicBalances({ balance: { loginid: 'CR1', balance: '10', currency: 'USD' } })).toEqual([]);
    expect(parseClassicBalances({ balance: { total: { amount: 123 } } })).toEqual([]);
  });
  it('keeps the authorized socket subscribed for subsequent changes, then cleans up', async () => {
    vi.useFakeTimers();
    const sent: object[] = [];
    let ws!: TestSocket;
    class TestSocket {
      static OPEN = 1; readyState = 1;
      onopen?: () => void; onmessage?: (event: { data: string }) => void;
      onclose?: () => void; onerror?: () => void;
      // Expose the fake socket to the test driver.
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      constructor() { ws = this; }
      send(text: string) { sent.push(JSON.parse(text)); }
      close() { this.readyState = 3; this.onclose?.(); }
    }
    vi.stubGlobal('WebSocket', TestSocket);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/handoff') ? { token: 'synthetic-test-token', hosts: ['example.test'] } : { ok: true } })));
    const changes = vi.fn(); const statuses = vi.fn();
    const stop = watchClassicBalances(changes, statuses);
    await vi.advanceTimersByTimeAsync(0);
    ws.onopen?.(); expect(sent[0]).toEqual({ authorize: 'synthetic-test-token', req_id: 1 });
    ws.onmessage?.({ data: JSON.stringify({ msg_type: 'authorize', authorize: {} }) });
    expect(sent[1]).toEqual({ balance: 1, account: 'all', subscribe: 1, req_id: 2 });
    for (const balance of [5, 6]) ws.onmessage?.({ data: JSON.stringify({ balance: { loginid: 'CR1', balance, currency: 'USD' } }) });
    expect(changes).toHaveBeenCalledTimes(2); expect(changes.mock.calls[1][0][0].balance).toBe(6);
    stop(); await vi.advanceTimersByTimeAsync(120000);
    expect(fetch).toHaveBeenCalledTimes(2); expect(ws.readyState).toBe(3);
  });
});
