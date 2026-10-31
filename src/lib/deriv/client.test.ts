import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DerivClient } from './client';

class Socket {
  static OPEN = 1; static CONNECTING = 0;
  static instances: Socket[] = [];
  readyState = 0;
  onopen?: () => void; onclose?: () => void; onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  sent: Record<string, unknown>[] = [];
  constructor(public url: string) { Socket.instances.push(this); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(value: object) { this.onmessage?.({ data: JSON.stringify(value) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}

beforeEach(() => { Socket.instances = []; vi.useFakeTimers(); vi.stubGlobal('WebSocket', Socket); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('account scoped WebSocket lifecycle', () => {
  it('requests a fresh OTP URL after disconnection', async () => {
    let issued = 0;
    const factory = vi.fn(async () => `wss://example.test/demo?otp=${++issued}`);
    const c = new DerivClient({ urlFactory: factory });
    const connected = c.connect(); await Promise.resolve();
    Socket.instances[0].open(); await connected;
    Socket.instances[0].close();
    await vi.advanceTimersByTimeAsync(800);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(Socket.instances[1].url).toContain('otp=2');
    Socket.instances[1].open(); c.close();
  });
  it('rebinds subscription callbacks to new request ids after reconnect', async () => {
    const c = new DerivClient({ url: 'wss://example.test' });
    const connected = c.connect(); Socket.instances[0].open(); await connected;
    const received = vi.fn();
    const sub = c.subscribe({ balance: 1 }, received, 'balance');
    const first = Socket.instances[0].sent.at(-1)!;
    Socket.instances[0].message({ req_id: first.req_id, subscription: { id: 'old' }, balance: { balance: 5 } });
    await sub;
    Socket.instances[0].close(); await vi.advanceTimersByTimeAsync(800);
    Socket.instances[1].open();
    const replay = Socket.instances[1].sent.at(-1)!;
    Socket.instances[1].message({ req_id: replay.req_id, subscription: { id: 'new' }, balance: { balance: 6 } });
    expect(received).toHaveBeenCalled();
    expect(received.mock.calls.at(-1)?.[0].balance.balance).toBe(6);
    c.close();
  });
  it('does not open an abandoned account socket when OTP renewal finishes late', async () => {
    let release!: (url: string) => void;
    const c = new DerivClient({ urlFactory: () => new Promise((resolve) => { release = resolve; }) });
    const connection = c.connect(); c.close(); release('wss://example.test/old'); await connection;
    expect(Socket.instances).toHaveLength(0);
  });
  it('rejects connection errors instead of leaving initialization pending', async () => {
    const c = new DerivClient({ url: 'wss://example.test' });
    const connected = c.connect(); Socket.instances[0].onerror?.();
    await expect(connected).rejects.toThrow('connection error'); c.close();
  });
});

it('does not replay a completed contract after its named subscription is forgotten',async()=>{
  const c=new DerivClient({url:'wss://example.test'});const connected=c.connect();Socket.instances[0].open();await connected;
  const sub=c.subscribe({proposal_open_contract:1,contract_id:123},()=>{},'poc_123');const first=Socket.instances[0].sent.at(-1)!;
  Socket.instances[0].message({req_id:first.req_id,subscription:{id:'settled-contract'},proposal_open_contract:{is_sold:1}});await sub;
  const forgotten=c.forget('settled-contract','poc_123');const forget=Socket.instances[0].sent.at(-1)!;Socket.instances[0].message({req_id:forget.req_id,forget:1});await forgotten;
  Socket.instances[0].close();await vi.advanceTimersByTimeAsync(800);Socket.instances[1].open();expect(Socket.instances[1].sent.some((r)=>r.proposal_open_contract)).toBe(false);c.close();
});
