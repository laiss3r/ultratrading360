import { DerivClient } from './client';
import type { ActiveSymbol, Candle, DerivMessage, Tick, TickHistoryResponse } from './types';
import { lastDigit } from './digits';

/** Market-data operations. All of these work on the PUBLIC socket with no credential. */
export class MarketDataService {
  constructor(private client: DerivClient) {}

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
  async ticksHistory(symbol: string, count = 1000): Promise<{ ticks: Tick[]; pipSize: number }> {
    const res = await this.client.send<TickHistoryResponse & { msg_type: string }>({
      ticks_history: symbol,
      adjust_start_time: 1,
      count,
      end: 'latest',
      start: 1,
      style: 'ticks',
    });
    const prices = res.history?.prices ?? [];
    const times = res.history?.times ?? [];
    const pipSize = res.pip_size ?? 2;
    const ticks: Tick[] = prices.map((quote, i) => ({
      symbol,
      quote,
      epoch: times[i] ?? 0,
      pip_size: pipSize,
    }));
    return { ticks, pipSize };
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
    const first = await this.client.subscribe({ ticks: symbol }, handle);
    subId = (first.subscription?.id as string) ?? null;
    return () => {
      if (subId) void this.client.forget(subId);
    };
  }

  /** Convenience: the digit series for a symbol at correct precision. */
  async digitSeries(symbol: string, count = 1000): Promise<{ digits: number[]; pipSize: number }> {
    const { ticks, pipSize } = await this.ticksHistory(symbol, count);
    return { digits: ticks.map((t) => lastDigit(t.quote, pipSize)), pipSize };
  }
}
