import type { AccountMode, Tick, OpenContract } from '../deriv/types';
import { DerivClient } from '../deriv/client';
import { MarketDataService } from '../deriv/market';
import { ContractService, type ContractType } from '../deriv/contracts';
import { TradingService, type BuyRequest } from '../deriv/trading';
import { brokerNumber } from '../deriv/numbers';
import { lastDigit } from '../deriv/digits';
import type { ContractUpdate } from './execution';

export interface Quote {
  symbol: string;
  price: number;
  digit: number;
  epoch: number;
  pipSize: number;
  /** Where this number came from. Surfaced in the UI so data provenance is never ambiguous. */
  source: 'deriv_live' | 'deriv_history';
}

export interface PricedContract {
  stake: number;
  payout: number;
  askPrice: number;
  contractType: ContractType;
  symbol: string;
  barrier?: string;
  source: 'deriv_live';
}

export interface SettledContract {
  won: boolean;
  potentialPayout?:number;pipSize?:number;longcode?:string;buyTransactionId?:string;sellTransactionId?:string;dateExpiry?:number;
  contractId?: number;
  openedAt?: number;
  closedAt?: number;
  stake: number;
  payout: number;
  profit: number;
  entryDigit?: number;
  exitDigit?: number;
  entryPrice?: number;
  exitPrice?: number;
  source: 'deriv_live';
}

/**
 * The provider abstraction. The Deriv provider is the only implementation, so the bot
 * engine, the statistics and the risk manager are identical in both modes — the only
 * difference is where numbers come from, and every emitted record carries its `source`.
 */
/**
 * One shared pricing request type, used by the interface and by the Deriv provider.
 *
 * This exists because the two providers had independently written parameter lists and drifted:
 * an earlier implementation omitted duration/durationUnit/currency, and TypeScript's method-parameter
 * bivariance let `implements MarketProvider` pass anyway. Callers holding a concrete
 * then could not pass the fields the interface promises. A single named type
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

/** Authorization context for execution. The provider refuses to execute without it. */
export interface ExecuteOptions {
  /** True only when the socket is authorized for the account being traded. */
  authorized: boolean;
  /** Rechecked immediately before buy, after the broker reprices. */
  shouldExecute?: (quote?: {askPrice:number;payout:number}) => boolean;
  onUpdate?: (update:ContractUpdate) => void;
}

export interface MarketProvider {
  readonly mode: AccountMode;
  readonly source: 'deriv_live';
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  /** Prime the provider with `count` historical quotes. */
  history(symbol: string, count: number, signal?: AbortSignal, onProgress?: (loaded:number,total:number)=>void): Promise<Quote[]>;
  /** Subscribe to live quotes. Returns a disposer. */
  stream(symbol: string, onQuote: (q: Quote) => void): Promise<() => void>;
  /** Price a contract from a real Deriv proposal. */
  price(req: PriceRequest): Promise<PricedContract>;
  /**
   * Execute and settle a contract. Deriv performs a real purchase and waits for `proposal_open_contract` to settle.
   */
  execute(priced: PricedContract, opts: ExecuteOptions): Promise<SettledContract>;
}

export class DerivProvider implements MarketProvider {
  readonly source = 'deriv_live' as const;
  private client: DerivClient;
  private marketSvc: MarketDataService;
  private contractSvc: ContractService;
  private tradingSvc: TradingService;
  private pipSizes = new Map<string, number>();
  private pricedRequests = new WeakMap<PricedContract, PriceRequest>();

  constructor(
    public readonly mode: 'deriv_demo' | 'deriv_real',
    opts: { authenticatedUrl?: string; urlFactory?: () => Promise<string>; onStatus?: (s: string) => void } = {},
  ) {
    this.client = new DerivClient({
      authenticatedUrl: opts.authenticatedUrl,
      urlFactory: opts.urlFactory,
      requestTimeoutMs: 15000,
      onStatusChange: opts.onStatus ? (s) => opts.onStatus!(s) : undefined,
    });
    this.marketSvc = new MarketDataService(this.client);
    this.contractSvc = new ContractService(this.client);
    this.tradingSvc = new TradingService(this.client, this.contractSvc);
  }

  async streamBalance(onBalance: (balance: number, currency: string) => void, expected?: {loginid:string;currency:string}): Promise<void> {
    const parse = (m: import('@/lib/deriv/types').DerivMessage) => {
      const b = m.balance as { balance?: unknown; currency?: unknown; loginid?: unknown } | undefined;
      const amount = brokerNumber(b?.balance);
      if (amount === undefined || amount < 0 || typeof b?.currency !== 'string' || !b.currency.trim())
        throw new Error('Deriv balance verification returned a missing or invalid amount/currency. No purchase is allowed.');
      if (expected && (b.currency !== expected.currency || (b.loginid !== undefined && b.loginid !== expected.loginid)))
        throw new Error('Deriv balance identity/currency does not match the selected account. No purchase is allowed.');
      return {balance:amount,currency:b.currency};
    };
    const handle = (m: import('@/lib/deriv/types').DerivMessage) => {
      if (!m.balance) return;
      try { const b=parse(m);onBalance(b.balance,b.currency); }
      catch { this.client.close(); } // Revoke verification on a malformed or mismatched replay.
    };
    const first = await this.client.subscribe({ balance: 1 }, handle, 'account-balance');
    const b=parse(first); // Fail explicitly, rather than returning an apparently verified socket.
    onBalance(b.balance,b.currency);
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
  async contractsFor(symbol:string):Promise<import('@/lib/deriv/types').ContractSpec[]> { return this.contractSvc.contractsFor(symbol); }

  async activeSymbols(productType?: string): Promise<import('@/lib/deriv/types').ActiveSymbol[]> {
    return this.marketSvc.activeSymbols(productType);
  }

  async history(symbol: string, count: number, signal?: AbortSignal, onProgress?: (loaded:number,total:number)=>void): Promise<Quote[]> {
    if (!this.isConnected()) throw new Error('Deriv socket is not connected.');
    const { ticks, pipSize } = await this.marketSvc.ticksHistory(symbol, count, signal, onProgress);
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
    const priced: PricedContract = {
      stake: Number(proposal.ask_price),
      payout: Number(proposal.payout),
      askPrice: Number(proposal.ask_price),
      contractType: req.contractType,
      symbol: req.symbol,
      barrier: req.barrier,
      source: 'deriv_live',
    };
    this.pricedRequests.set(priced, Object.freeze({ ...req }));
    return priced;
  }

  async inspectContract(contractId:number):Promise<OpenContract>{
    if(!this.isConnected())throw Error('Reconnect the authenticated account channel first.');
    const frame=await this.client.send<{proposal_open_contract:OpenContract}>({proposal_open_contract:1,contract_id:contractId});
    return frame.proposal_open_contract;
  }

  async execute(priced: PricedContract, opts: ExecuteOptions): Promise<SettledContract> {
    if (!this.isConnected()) {
      throw new Error('Deriv socket dropped — refusing to report a trade that was not placed.');
    }
    const context = this.pricedRequests.get(priced);
    if (!context) throw new Error('Missing or already consumed pricing context; refusing an unverified purchase.');
    this.pricedRequests.delete(priced);
    const req: BuyRequest = {
      underlying: context.symbol, contractType: context.contractType,
      stake: priced.stake, currency: context.currency,
      duration: context.duration, durationUnit: context.durationUnit, barrier: context.barrier,
    };
    const trade = await this.tradingSvc.buy(req, { authorized: opts.authorized, maxAcceptablePrice: priced.askPrice, shouldExecute: (proposal) => opts.shouldExecute?.({askPrice:proposal.ask_price,payout:proposal.payout}) ?? true, onBuying: () => opts.onUpdate?.({phase:'buying'}) });
    opts.onUpdate?.({phase:'open',contractId:trade.contractId,stake:trade.buyPrice,potentialPayout:trade.payout,longcode:trade.longcode,pipSize:this.pipFor(priced.symbol),dateStart:trade.dateStart*1000,dateExpiry:trade.dateExpiry*1000,buyTransactionId:trade.transactionId});
    const settled = await this.tradingSvc.watchContract(trade.contractId,(c)=>opts.onUpdate?.({phase:'open',contractId:trade.contractId,entryPrice:c.entry_tick,exitPrice:c.exit_tick,currentSpot:c.current_spot,contractValue:c.bid_price,profit:c.profit,canSell:c.is_valid_to_sell===0?false:c.is_valid_to_sell===1?true:undefined,recordedTicks:Array.isArray(c.tick_stream)?c.tick_stream.length:undefined,totalTicks:c.tick_count,buyTransactionId:c.transaction_ids?.buy===undefined?undefined:String(c.transaction_ids.buy),sellTransactionId:c.transaction_ids?.sell===undefined?undefined:String(c.transaction_ids.sell),brokerStatus:c.status}));
    if(!Number.isFinite(settled.profit))throw new Error('Broker settlement has no finite profit; reconcile this contract before restarting.');
    const profit=Number(settled.profit);
    return {
      won: profit > 0,
      potentialPayout:trade.payout,pipSize:this.pipFor(priced.symbol),longcode:trade.longcode,dateExpiry:trade.dateExpiry*1000,buyTransactionId:settled.transaction_ids?.buy===undefined?trade.transactionId:String(settled.transaction_ids.buy),sellTransactionId:settled.transaction_ids?.sell===undefined?undefined:String(settled.transaction_ids.sell),
      contractId: trade.contractId,
      openedAt: trade.dateStart*1000,
      closedAt: settled.date_settlement?settled.date_settlement*1000:Date.now(),
      stake: trade.buyPrice,
      payout: round2(Math.max(0,trade.buyPrice+profit)),
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
