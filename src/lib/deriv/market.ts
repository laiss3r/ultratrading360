import { DerivClient } from './client';
import type { ActiveSymbol, Candle, DerivMessage, Tick, TickHistoryResponse } from './types';
import { lastDigit } from './digits';

/** Market-data operations. All of these work on the PUBLIC socket with no credential. */
export class MarketDataService {
  private streamSequence = 0;
  private historyQueue: Promise<void> = Promise.resolve();
  private nextHistoryAt = 0;
  constructor(private client: DerivClient, private historyPacingMs = 1200) {}

  /** Shared pacing/backoff is for READS only, never proposal/buy retries. */
  private historyRequest(request: Record<string, unknown>, signal?: AbortSignal): Promise<TickHistoryResponse & { msg_type: string }> {
    const pause = (ms: number) => new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('History request cancelled.')); return; }
      const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('History request cancelled.')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
      signal?.addEventListener('abort', abort, { once: true });
    });
    const task = this.historyQueue.then(async () => {
      if (signal?.aborted) throw new Error('History request cancelled.');
      const wait = Math.max(0, this.nextHistoryAt - Date.now());
      if (wait) await pause(wait);
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            const response = await this.client.send<TickHistoryResponse & { msg_type: string }>(request);
            if (signal?.aborted) throw new Error('History request cancelled.');
            return response;
          }
          catch (error) {
            if (attempt >= 4 || !/rate.?limit/i.test((error as Error).message)) throw error;
            await pause(5000 * 2 ** attempt);
          }
        }
      } finally { this.nextHistoryAt = Date.now() + this.historyPacingMs; }
    });
    this.historyQueue = task.then(() => {}, () => {});
    return task;
  }

  async activeSymbols(marketFilter = 'synthetic_index'): Promise<ActiveSymbol[]> {
    // NOTE: `product_type` was REMOVED from the current API — sending it returns
    // InputValidationFailed "product_type: field is not allowed". Verified 2026-10-29.
    const res = await this.client.send<{ active_symbols: ActiveSymbol[] }>({
      active_symbols: 'brief',
    });
    const all = res.active_symbols ?? [];
    return marketFilter === 'all' ? all : all.filter((s) => s.market === marketFilter);
  }

  /**
   * Historical ticks. Returns quotes paired with epochs and the instrument's pip_size,
   * which is required for correct digit extraction.
   */
  async ticksHistory(symbol: string, count = 1000, signal?: AbortSignal, onProgress?: (loaded:number,total:number)=>void): Promise<{ ticks: Tick[]; pipSize: number }> {
    if (!Number.isInteger(count) || count < 1 || count > 5000) throw new Error('Tick history count must be between 1 and 5000.');
    // The current public API can silently cap a response at 1,000 rows, even
    // when count=5000. Page backwards by the broker epoch, never fabricate rows.
    const page = async (end: string, size: number) => {
      const res = await this.historyRequest({
        ticks_history: symbol, adjust_start_time: 1, count: size, end, start: 1, style: 'ticks',
      }, signal);
      const prices = res.history?.prices ?? [], times = res.history?.times ?? [];
      const pipSize = res.pip_size ?? 2;
      if (prices.length !== times.length || times.some((epoch, i) => !Number.isFinite(epoch) || (i > 0 && epoch < times[i - 1]))) throw new Error('Broker returned invalid tick history epochs.');
      return { pipSize, ticks: prices.map((quote, i): Tick => ({ symbol, quote, epoch: times[i], pip_size: pipSize })) };
    };
    const first = await page('latest', Math.min(count, 1000));
    let ticks = first.ticks;
    onProgress?.(Math.min(count,ticks.length),count);
    for (let attempts = 0; ticks.length < count && ticks.length && attempts < 5; attempts++) {
      const oldest = ticks[0].epoch;
      const older = await page(String(oldest - 1), Math.min(count - ticks.length, 1000));
      if (older.pipSize !== first.pipSize) throw new Error('Broker history precision changed during pagination.');
      if (!older.ticks.length) break;
      if (older.ticks.some((tick) => tick.epoch >= oldest)) throw new Error('Broker did not honour the historical page boundary.');
      ticks = [...older.ticks, ...ticks];
      onProgress?.(Math.min(count,ticks.length),count);
    }
    if (count > 1000) {
      // Paging old data must not leave the seed stale before streaming starts.
      const latest = await page('latest', Math.min(count, 1000));
      if (latest.pipSize !== first.pipSize) throw new Error('Broker history precision changed during pagination.');
      const end = ticks.at(-1)?.epoch ?? -Infinity;
      ticks = [...ticks, ...latest.ticks.filter((tick) => tick.epoch > end)];
    }
    return { ticks: ticks.slice(-count), pipSize: first.pipSize };
  }

  async candles(symbol: string, granularity = 60, count = 100): Promise<Candle[]> {
    const res = await this.client.send<{ candles: Candle[] }>({
      ticks_history: symbol,
      adjust_start_time: 1,
      count,
      end: 'latest',
      style: 'candles',
      granularity,
    });
    return res.candles ?? [];
  }

  /** Live tick stream. Returns a disposer. */
  async streamTicks(symbol: string, onTick: (t: Tick) => void): Promise<() => void> {
    let subId: string | null = null;
    const handle = (m: DerivMessage) => {
      const t = m.tick as Tick | undefined;
      if (t && typeof t.quote === 'number') onTick(t);
    };
    const replayKey = `ticks_${symbol}_${++this.streamSequence}`;
    const first = await this.client.subscribe({ ticks: symbol }, handle, replayKey);
    subId = (first.subscription?.id as string) ?? null;
    handle(first);
    return () => {
      if (subId) void this.client.forget(subId, replayKey);
    };
  }

  /** Convenience: the digit series for a symbol at correct precision. */
  async digitSeries(symbol: string, count = 1000): Promise<{ digits: number[]; pipSize: number }> {
    const { ticks, pipSize } = await this.ticksHistory(symbol, count);
    return { digits: ticks.map((t) => lastDigit(t.quote, pipSize)), pipSize };
  }
}
