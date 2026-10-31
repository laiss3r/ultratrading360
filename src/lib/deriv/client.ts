import type { DerivMessage } from './types';
import { DERIV_APP_ID, DERIV_WS_PUBLIC } from './config';

type Resolver = { resolve: (m: DerivMessage) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export interface DerivClientOptions {
  /** Full socket URL. Defaults to the public market-data endpoint with the configured app_id. */
  url?: string;
  /** Authenticated socket URL (already contains ?otp=...). Overrides `url`. */
  authenticatedUrl?: string;
  origin?: string;
  /** Fresh OTP URL for each authenticated connection/reconnection. */
  urlFactory?: () => Promise<string>;
  requestTimeoutMs?: number;
  pingIntervalMs?: number;
  maxReconnectAttempts?: number;
  onMessage?: (m: DerivMessage) => void;
  onStatusChange?: (s: ConnectionStatus) => void;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

/**
 * Minimal, dependency-free Deriv WebSocket client for the CURRENT API.
 *
 * Design notes:
 *  - req_id correlation so concurrent calls never cross-talk.
 *  - Subscription-aware: frames carrying `subscription.id` are routed to handlers AND resolved
 *    once, so `ticks: subscribe:1` returns the first tick immediately and keeps streaming.
 *  - Exponential backoff reconnect with jitter; subscriptions are re-established after reconnect
 *    (this is what "WebSocket reconnects restore the correct session state" requires).
 *  - A stopped client never silently keeps emitting: status transitions are observable.
 */
export class DerivClient {
  private ws: WebSocket | null = null;
  private reqId = 0;
  private pending = new Map<number, Resolver>();
  private subscriptionHandlers = new Map<string, (m: DerivMessage) => void>();
  /** Requests that must be replayed after a reconnect, keyed by a caller-chosen id. */
  private replayable = new Map<string, Record<string, unknown>>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onlineRetryArmed = false;

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private intentionallyClosed = false;
  status: ConnectionStatus = 'idle';

  constructor(private opts: DerivClientOptions = {}) {}

  private get url(): string {
    if (this.opts.authenticatedUrl) return this.opts.authenticatedUrl;
    if (this.opts.url) return this.opts.url;
    return `${DERIV_WS_PUBLIC}?app_id=${encodeURIComponent(DERIV_APP_ID)}`;
  }

  connect(): Promise<void> {
    this.intentionallyClosed = false;
    return this.open();
  }

  private async open(): Promise<void> {
    if (this.intentionallyClosed) return;
    if (this.opts.urlFactory) {
      this.opts.authenticatedUrl = await this.opts.urlFactory();
      if (this.intentionallyClosed) return;
    }
    return new Promise((resolve, reject) => {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        resolve();
        return;
      }
      this.setStatus('connecting');
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        this.setStatus('error');
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      this.ws = ws;

      ws.onopen = () => {
        this.reconnectAttempt = 0;
        this.setStatus('open');
        this.startPing();
        void this.replaySubscriptions();
        resolve();
      };

      ws.onmessage = (ev) => {
        let msg: DerivMessage;
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
        } catch {
          return;
        }
        this.opts.onMessage?.(msg);
        const id = msg.req_id ?? msg.echo_req?.req_id;
        if (typeof id === 'number' && this.pending.has(id)) {
          const p = this.pending.get(id)!;
          // Keep the resolver alive for streaming responses; drop it for terminal errors.
          if (msg.error || !msg.subscription) {
            this.pending.delete(id);
            clearTimeout(p.timer);
          } else {
            clearTimeout(p.timer);
            p.timer = setTimeout(() => {
              this.pending.delete(id);
            }, this.opts.requestTimeoutMs ?? 15000);
          }
          p.resolve(msg);
        }
        const subId = msg.subscription?.id;
        if (subId) {
          const h = this.subscriptionHandlers.get(String(id ?? subId));
          h?.(msg);
        }
      };

      ws.onerror = () => {
        this.setStatus('error');
        reject(new Error('WebSocket connection error'));
      };

      ws.onclose = () => {
        reject(new Error('WebSocket closed before connection completed'));
        this.stopPing();
        this.ws = null;
        this.failAllPending(new Error('WebSocket closed'));
        if (this.intentionallyClosed) {
          this.setStatus('closed');
          return;
        }
        this.setStatus('reconnecting');
        this.scheduleReconnect();
      };
    });
  }

  private scheduleReconnect() {
    const max = this.opts.maxReconnectAttempts ?? 8;
    if (this.reconnectAttempt >= max) {
      this.setStatus('error');
      // Long outages (airplane mode, dead coverage) exhaust the backoff budget.
      // Come back immediately when the OS says the network is alive again.
      if (typeof window !== 'undefined' && !this.onlineRetryArmed) {
        this.onlineRetryArmed = true;
        window.addEventListener(
          'online',
          () => {
            this.onlineRetryArmed = false;
            if (this.intentionallyClosed) return;
            this.reconnectAttempt = 0;
            this.open().catch(() => {
              /* onclose will re-schedule */
            });
          },
          { once: true },
        );
      }
      return;
    }
    const base = Math.min(30000, 500 * Math.pow(2, this.reconnectAttempt));
    const delay = base + Math.floor(Math.random() * 250);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open().catch(() => {
        // OTP renewal may fail before a socket exists (so no onclose fires).
        if (!this.intentionallyClosed && !this.reconnectTimer && !this.ws) this.scheduleReconnect();
      });
    }, delay);
  }

  private async replaySubscriptions() {
    for (const [key, req] of this.replayable) {
      try {
        const handler = this.subscriptionHandlers.get(key);
        const id = this.rawSend(req);
        if (handler) this.subscriptionHandlers.set(String(id), handler);
      } catch {
        /* will be retried on next reconnect */
      }
    }
  }

  private setStatus(s: ConnectionStatus) {
    if (this.status === s) return;
    this.status = s;
    this.opts.onStatusChange?.(s);
  }

  private startPing() {
    this.stopPing();
    const iv = this.opts.pingIntervalMs ?? 30000;
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.rawSend({ ping: 1 });
    }, iv);
  }
  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private failAllPending(err: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private rawSend(obj: Record<string, unknown>): number {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Socket is not open');
    }
    const req_id = ++this.reqId;
    this.ws.send(JSON.stringify({ ...obj, req_id }));
    return req_id;
  }

  /** Send a request and resolve on the first matching response. */
  send<T extends object = DerivMessage>(request: Record<string, unknown>): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Socket is not open — call connect() first'));
    }
    return new Promise<T>((resolve, reject) => {
      let req_id: number;
      try {
        req_id = this.rawSend(request);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(req_id);
        reject(new Error(`Deriv request timed out: ${JSON.stringify(request).slice(0, 120)}`));
      }, this.opts.requestTimeoutMs ?? 15000);
      this.pending.set(req_id, {
        resolve: (m) => {
          if (m.error) {
            clearTimeout(timer);
            this.pending.delete(req_id);
            reject(new DerivApiError(m.error.code, m.error.message, m.error.details));
            return;
          }
          resolve(m as unknown as T);
        },
        reject,
        timer,
      });
    });
  }

  /**
   * Subscribe to a stream. Resolves with the first frame, then invokes `onFrame` for every
   * subsequent frame. The request is replayed automatically after a reconnect.
   */
  async subscribe(
    request: Record<string, unknown>,
    onFrame: (m: DerivMessage) => void,
    key?: string,
  ): Promise<DerivMessage> {
    const replayKey = key ?? JSON.stringify(request);
    const first = await this.send({ ...request, subscribe: 1 });
    const id = String(first.req_id ?? first.echo_req?.req_id ?? replayKey);
    this.subscriptionHandlers.set(id, onFrame);
    this.subscriptionHandlers.set(replayKey, onFrame);
    this.replayable.set(replayKey, { ...request, subscribe: 1 });
    return first;
  }

  /** Cancel one subscription. */
  async forget(subscriptionId: string, replayKey?: string): Promise<void> {
    if (replayKey) {
      const handler = this.subscriptionHandlers.get(replayKey);
      this.replayable.delete(replayKey);
      if (handler) for (const [key, value] of this.subscriptionHandlers) if (value === handler) this.subscriptionHandlers.delete(key);
    }
    for (const [k, req] of this.replayable) {
      if (JSON.stringify(req).includes(subscriptionId)) this.replayable.delete(k);
    }
    try {
      await this.send({ forget: subscriptionId });
    } catch {
      /* already gone */
    }
  }

  /** Cancel every subscription of a type, e.g. 'ticks'. */
  async forgetAll(...types: string[]): Promise<void> {
    this.replayable.clear();
    this.subscriptionHandlers.clear();
    try {
      await this.send({ forget_all: types.length ? types : ['ticks', 'candles', 'proposal_open_contract'] });
    } catch {
      /* ignore */
    }
  }

  /** Hard stop. A closed client will not reconnect and will not emit further frames. */
  close(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopPing();
    this.replayable.clear();
    this.subscriptionHandlers.clear();
    this.failAllPending(new Error('Client closed'));
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    this.setStatus('closed');
  }
}

export class DerivApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'DerivApiError';
  }
}
