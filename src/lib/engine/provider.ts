import type { AccountMode, Tick } from '../deriv/types';
import { DerivClient } from '../deriv/client';
import { MarketDataService } from '../deriv/market';
import { ContractService, type ContractType } from '../deriv/contracts';
import { TradingService, type BuyRequest } from '../deriv/trading';
import { SyntheticMarket, presetFor } from './rng';
import { lastDigit } from '../deriv/digits';

export interface Quote {
  symbol: string;
  price: number;
  digit: number;
  epoch: number;
  pipSize: number;
  /** Where this number came from. Surfaced in the UI so data provenance is never ambiguous. */
  source: 'simulation' | 'deriv_live' | 'deriv_history';
}

export interface PricedContract {
  stake: number;
  payout: number;
  askPrice: number;
  contractType: ContractType;
  symbol: string;
  barrier?: string;
  source: 'simulation' | 'deriv_live';
}

export interface SettledContract {
  won: boolean;
  stake: number;
  payout: number;
  profit: number;
  entryDigit?: number;
  exitDigit?: number;
  entryPrice?: number;
  exitPrice?: number;
  source: 'simulation' | 'deriv_live';
}

/**
 * The provider abstraction. Simulation and Deriv implement the same contract so the bot
 * engine, the statistics and the risk manager are identical in both modes — the only
 * difference is where numbers come from, and every emitted record carries its `source`.
 */
/**
 * One shared pricing request type, used by the interface and by BOTH implementations.
 *
 * This exists because the two providers had independently written parameter lists and drifted:
 * SimulationProvider omitted duration/durationUnit/currency, and TypeScript's method-parameter
 * bivariance let `implements MarketProvider` pass anyway. Callers holding a concrete
 * SimulationProvider then could not pass the fields the interface promises. A single named type
 * makes that drift a compile error instead of a silent divergence.
 */
export interface PriceRequest {
  symbol: string;
  contractType: ContractType;
  stake: number;
  duration: number;
  durationUnit: 't' | 's' | 'm' | 'h' | 'd';
  barrier?: string;
  currency: string;
}

/** Authorization context for execution. Simulation ignores it; Deriv refuses without it. */
export interface ExecuteOptions {
  /** True only when the socket is authorized for the account being traded. */
  authorized: boolean;
}

export interface MarketProvider {
  readonly mode: AccountMode;
  readonly source: 'simulation' | 'deriv_live';
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  /** Prime the provider with `count` historical quotes. */
  history(symbol: string, count: number): Promise<Quote[]>;
  /** Subscribe to live quotes. Returns a disposer. */
  stream(symbol: string, onQuote: (q: Quote) => void): Promise<() => void>;
  /** Price a contract. Simulation prices from theory; Deriv prices from a real proposal. */
  price(req: PriceRequest): Promise<PricedContract>;
  /**
   * Execute and settle a contract. Simulation settles locally from its own tick stream.
   * Deriv performs a real purchase and waits for `proposal_open_contract` to settle.
   */
  execute(priced: PricedContract, opts: ExecuteOptions): Promise<SettledContract>;
}

/* ------------------------------------------------------------------ *
 * Simulation provider — deterministic, offline, never places an order
 * ------------------------------------------------------------------ */

export interface SimulationOptions {
  seed: string | number;
  /** Payout multiplier used when pricing. Deriv digit contracts pay roughly 0.9-9.5x stake. */
  payoutTable?: Partial<Record<ContractType, number>>;
}

const DEFAULT_PAYOUTS: Record<ContractType, number> = {
  DIGITODD: 1.96,
  DIGITEVEN: 1.96,
  DIGITOVER: 2.4,
  DIGITUNDER: 2.4,
  DIGITMATCH: 9.2,
  DIGITDIFF: 1.09,
  CALL: 1.9,
  PUT: 1.9,
};

export class SimulationProvider implements MarketProvider {
  readonly mode: AccountMode = 'simulation';
  readonly source = 'simulation' as const;
  private markets = new Map<string, SyntheticMarket>();
  private buffers = new Map<string, Quote[]>();
  private connected = false;
  private payoutTable: Record<ContractType, number>;

  constructor(private opts: SimulationOptions) {
    this.payoutTable = { ...DEFAULT_PAYOUTS, ...(opts.payoutTable ?? {}) };
  }

  async connect(): Promise<void> {
    this.connected = true;
  }
  disconnect(): void {
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }

  private market(symbol: string): SyntheticMarket {
    let m = this.markets.get(symbol);
    if (!m) {
      // Derive a per-symbol seed from the session seed so every market is independent but
      // the whole run stays reproducible from one seed.
      m = new SyntheticMarket(presetFor(symbol), `${this.opts.seed}:${symbol}`);
      this.markets.set(symbol, m);
    }
    return m;
  }

  async history(symbol: string, count: number): Promise<Quote[]> {
    const m = this.market(symbol);
    const cfg = m.config;
    const out: Quote[] = [];
    for (let i = 0; i < count; i++) {
      const t = m.next();
      out.push({
        symbol,
        price: t.quote,
        digit: lastDigit(t.quote, cfg.pipSize),
        epoch: t.epoch,
        pipSize: cfg.pipSize,
        source: 'simulation',
      });
    }
    this.buffers.set(symbol, out);
    return out;
  }

  async stream(symbol: string, onQuote: (q: Quote) => void): Promise<() => void> {
    if (!this.connected) throw new Error('Simulation provider is not connected.');
    const m = this.market(symbol);
    const cfg = m.config;
    let stopped = false;
    // Synthetic ticks are emitted on the instrument's real cadence so a 1s index behaves
    // like a 1s index. This is a timer, not a busy loop.
    const intervalMs = (cfg.tickIntervalSeconds ?? 2) * 1000;
    const timer = setInterval(() => {
      if (stopped) return;
      const t = m.next();
      const q: Quote = {
        symbol,
        price: t.quote,
        digit: lastDigit(t.quote, cfg.pipSize),
        epoch: t.epoch,
        pipSize: cfg.pipSize,
        source: 'simulation',
      };
      const buf = this.buffers.get(symbol) ?? [];
      buf.push(q);
      if (buf.length > 5000) buf.shift();
      this.buffers.set(symbol, buf);
      onQuote(q);
    }, Math.min(intervalMs, 1000));
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  async price(req: PriceRequest): Promise<PricedContract> {
    const base = this.payoutTable[req.contractType] ?? 1.9;
    // Barrier-specific fair pricing for over/under: a barrier of 5 covers 4 digits, not 5.
    let mult = base;
    if (req.contractType === 'DIGITOVER' || req.contractType === 'DIGITUNDER') {
      const b = Number(req.barrier ?? 5);
      const covered = req.contractType === 'DIGITOVER' ? 9 - b : b;
      const p = Math.max(covered, 1) / 10;
      mult = 0.98 / p; // 2% house margin applied to the fair inverse probability
    }
    const payout = round2(req.stake * mult);
    return {
      stake: req.stake,
      payout,
      askPrice: req.stake,
      contractType: req.contractType,
      symbol: req.symbol,
      barrier: req.barrier,
      source: 'simulation',
    };
  }

  /**
   * Settle a simulated contract by consuming the next tick(s) from the same deterministic
   * stream. Because the stream is seeded, an identical run produces identical results.
   */
  /**
   * Settles locally from this provider's own deterministic tick stream.
   *
   * `opts.authorized` is accepted for interface compatibility and deliberately IGNORED: a
   * simulation needs no Deriv authorization, and pretending otherwise would force users to
   * connect an account just to try the engine. Nothing here is ever sent to Deriv.
   */
  async execute(priced: PricedContract, _opts?: ExecuteOptions): Promise<SettledContract> {
    if (!this.connected) throw new Error('Simulation provider is not connected — refusing to pretend to trade.');
    const m = this.market(priced.symbol);
    const pipSize = m.config.pipSize;
    const entryTick = m.next();
    const exitTick = m.next();
    const entryDigit = lastDigit(entryTick.quote, pipSize);
    const exitDigit = lastDigit(exitTick.quote, pipSize);
    const won = this.settle(priced.contractType, priced.barrier, entryDigit, exitDigit, entryTick.quote, exitTick.quote);
    const profit = won ? round2(priced.payout - priced.stake) : round2(-priced.stake);
    return {
      won,
      stake: priced.stake,
      payout: won ? priced.payout : 0,
      profit,
      entryDigit,
      exitDigit,
      entryPrice: entryTick.quote,
      exitPrice: exitTick.quote,
      source: 'simulation',
    };
  }

  private settle(
    type: ContractType,
    barrier: string | undefined,
    entryDigit: number,
    exitDigit: number,
    entryPrice: number,
    exitPrice: number,
  ): boolean {
    const b = barrier === undefined ? undefined : Number(barrier);
    switch (type) {
      case 'DIGITODD': return exitDigit % 2 === 1;
      case 'DIGITEVEN': return exitDigit % 2 === 0;
      case 'DIGITOVER': return exitDigit > (b ?? 5);
      case 'DIGITUNDER': return exitDigit < (b ?? 5);
      case 'DIGITMATCH': return exitDigit === (b ?? 5);
      case 'DIGITDIFF': return exitDigit !== (b ?? 5);
      case 'CALL': return exitPrice > entryPrice;
      case 'PUT': return exitPrice < entryPrice;
    }
  }
}

/* ----------------------------------------------------------- *
 * Deriv provider — real market data, real proposals, real buys
 * ----------------------------------------------------------- */

export class DerivProvider implements MarketProvider {
  readonly source = 'deriv_live' as const;
  private client: DerivClient;
  private marketSvc: MarketDataService;
  private contractSvc: ContractService;
  private tradingSvc: TradingService;
  private pipSizes = new Map<string, number>();

  constructor(
    public readonly mode: 'deriv_demo' | 'deriv_real',
    opts: { authenticatedUrl?: string; onStatus?: (s: string) => void } = {},
  ) {
    this.client = new DerivClient({
      authenticatedUrl: opts.authenticatedUrl,
      requestTimeoutMs: 15000,
      onStatusChange: opts.onStatus ? (s) => opts.onStatus!(s) : undefined,
    });
    this.marketSvc = new MarketDataService(this.client);
    this.contractSvc = new ContractService(this.client);
    this.tradingSvc = new TradingService(this.client, this.contractSvc);
  }

  get connectionStatus() {
    return this.client.status;
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  disconnect(): void {
    this.client.close();
  }

  isConnected(): boolean {
    return this.client.status === 'open';
  }

  private pipFor(symbol: string, fallback = 2): number {
    return this.pipSizes.get(symbol) ?? fallback;
  }

  /**
   * Enumerate real Deriv markets. Only the live provider can do this; the simulation provider
   * deliberately has no equivalent, so callers branch on provider type.
   */
  async activeSymbols(productType?: string): Promise<import('@/lib/deriv/types').ActiveSymbol[]> {
    return this.marketSvc.activeSymbols(productType);
  }

  async history(symbol: string, count: number): Promise<Quote[]> {
    if (!this.isConnected()) throw new Error('Deriv socket is not connected.');
    const { ticks, pipSize } = await this.marketSvc.ticksHistory(symbol, count);
    this.pipSizes.set(symbol, pipSize);
    return ticks.map((t: Tick) => ({
      symbol,
      price: t.quote,
      digit: lastDigit(t.quote, pipSize),
      epoch: t.epoch,
      pipSize,
      source: 'deriv_history' as const,
    }));
  }

  async stream(symbol: string, onQuote: (q: Quote) => void): Promise<() => void> {
    if (!this.isConnected()) throw new Error('Deriv socket is not connected.');
    let pipSize = this.pipFor(symbol);
    return this.marketSvc.streamTicks(symbol, (t) => {
      if (typeof t.pip_size === 'number') {
        pipSize = t.pip_size;
        this.pipSizes.set(symbol, pipSize);
      }
      onQuote({
        symbol,
        price: t.quote,
        digit: lastDigit(t.quote, pipSize),
        epoch: t.epoch,
        pipSize,
        source: 'deriv_live',
      });
    });
  }

  async price(req: PriceRequest): Promise<PricedContract> {
    if (!this.isConnected()) throw new Error('Deriv socket is not connected — cannot price a contract.');
    const { proposal } = await this.contractSvc.proposal({
      underlying: req.symbol,
      contractType: req.contractType,
      amount: req.stake,
      basis: 'stake',
      currency: req.currency,
      duration: req.duration,
      durationUnit: req.durationUnit,
      barrier: req.barrier,
    });
    return {
      stake: Number(proposal.ask_price),
      payout: Number(proposal.payout),
      askPrice: Number(proposal.ask_price),
      contractType: req.contractType,
      symbol: req.symbol,
      barrier: req.barrier,
      source: 'deriv_live',
    };
  }

  async execute(priced: PricedContract, opts: ExecuteOptions): Promise<SettledContract> {
    if (!this.isConnected()) {
      throw new Error('Deriv socket dropped — refusing to report a trade that was not placed.');
    }
    const req: BuyRequest = {
      underlying: priced.symbol,
      contractType: priced.contractType,
      stake: priced.stake,
      currency: 'USD',
      duration: 1,
      durationUnit: 't',
      barrier: priced.barrier,
    };
    const trade = await this.tradingSvc.buy(req, { authorized: opts.authorized });
    const settled = await this.tradingSvc.watchContract(trade.contractId);
    const profit = Number(settled.profit ?? (settled.is_sold === 1 ? Number(settled.payout) - trade.buyPrice : 0));
    return {
      won: profit > 0,
      stake: trade.buyPrice,
      payout: Number(settled.payout ?? trade.payout),
      profit: round2(profit),
      entryPrice: settled.entry_tick,
      exitPrice: settled.exit_tick,
      entryDigit:
        settled.entry_tick !== undefined ? lastDigit(settled.entry_tick, this.pipFor(priced.symbol)) : undefined,
      exitDigit: settled.exit_tick !== undefined ? lastDigit(settled.exit_tick, this.pipFor(priced.symbol)) : undefined,
      source: 'deriv_live',
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
