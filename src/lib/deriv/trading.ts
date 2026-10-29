import { DerivClient, DerivApiError } from './client';
import { ContractService, type ContractType } from './contracts';
import type { OpenContract, Proposal } from './types';

export interface BuyRequest {
  underlying: string;
  contractType: ContractType;
  stake: number;
  currency: string;
  duration: number;
  durationUnit: 't' | 's' | 'm' | 'h' | 'd';
  barrier?: string;
}

export interface ExecutedTrade {
  contractId: number;
  proposalId: string;
  buyPrice: number;
  payout: number;
  longcode: string;
  currency: string;
  dateStart: number;
  dateExpiry: number;
  /** The proposal that was actually verified immediately before purchase. */
  verifiedProposal: Proposal;
}

/**
 * Purchase execution.
 *
 * Hard rule enforced here: NEVER buy without first obtaining a live proposal from the broker
 * and checking that the quoted payout is still acceptable. A cached or assumed payout is how
 * bots silently lose money. `buy` is also the only code path that touches real funds, so it
 * throws unless the caller passes an explicit `authorized` flag from the risk manager.
 */
export class TradingService {
  constructor(
    private client: DerivClient,
    private contracts: ContractService,
  ) {}

  async buy(
    req: BuyRequest,
    opts: { authorized: boolean; maxAcceptablePrice?: number; minAcceptablePayout?: number },
  ): Promise<ExecutedTrade> {
    if (!opts.authorized) {
      throw new Error('REFUSED: buy() requires an explicit authorization from the risk manager.');
    }
    if (!(req.stake > 0)) throw new Error(`Invalid stake: ${req.stake}`);

    // 1. Price it live.
    const { proposal } = await this.contracts.proposal({
      underlying: req.underlying,
      contractType: req.contractType,
      amount: req.stake,
      basis: 'stake',
      currency: req.currency,
      duration: req.duration,
      durationUnit: req.durationUnit,
      barrier: req.barrier,
    });

    // 2. Verify the quote is still within tolerance before committing funds.
    if (opts.maxAcceptablePrice !== undefined && proposal.ask_price > opts.maxAcceptablePrice) {
      throw new Error(
        `Price moved: broker asks ${proposal.ask_price} but the limit is ${opts.maxAcceptablePrice}. Trade aborted.`,
      );
    }
    if (opts.minAcceptablePayout !== undefined && proposal.payout < opts.minAcceptablePayout) {
      throw new Error(
        `Payout too low: broker offers ${proposal.payout} but the minimum is ${opts.minAcceptablePayout}. Trade aborted.`,
      );
    }

    // 3. Buy by proposal id.
    let res: { buy: { buy_price: number; contract_id: number; payout: number; longcode: string; currency: string; start_time?: number; purchase_time?: number } };
    try {
      res = await this.client.send({ buy: proposal.id, price: proposal.ask_price });
    } catch (e) {
      if (e instanceof DerivApiError) {
        throw new Error(translateBuyError(e));
      }
      throw e;
    }
    const b = res.buy;
    return {
      contractId: b.contract_id,
      proposalId: proposal.id,
      buyPrice: b.buy_price,
      payout: b.payout,
      longcode: b.longcode,
      currency: b.currency,
      dateStart: b.start_time ?? b.purchase_time ?? Math.floor(Date.now() / 1000),
      dateExpiry: proposal.date_expiry,
      verifiedProposal: proposal,
    };
  }

  /** Stream open-contract updates until settlement. Resolves with the settled contract. */
  watchContract(contractId: number, onUpdate?: (c: OpenContract) => void): Promise<OpenContract> {
    return new Promise((resolve, reject) => {
      let settled = false;
      this.client
        .subscribe(
          { proposal_open_contract: 1, contract_id: contractId },
          (m) => {
            const c = m.proposal_open_contract as OpenContract | undefined;
            if (!c) return;
            onUpdate?.(c);
            if (c.is_sold === 1 || c.status === 'sold' || c.status === 'won' || c.status === 'lost') {
              if (settled) return;
              settled = true;
              resolve(c);
            }
          },
          `poc_${contractId}`,
        )
        .catch(reject);
      // Safety net: never hang forever if the stream stalls.
      setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Timed out waiting for contract ${contractId} to settle.`));
        }
      }, 10 * 60 * 1000);
    });
  }

  async sell(contractId: number, price = 0): Promise<{ sold_for: number }> {
    const res = await this.client.send<{ sell: { sold_for: number } }>({ sell: contractId, price });
    return res.sell;
  }
}

function translateBuyError(e: DerivApiError): string {
  const c = e.code;
  if (/InsufficientBalance|insufficient/i.test(c + e.message)) {
    return `INSUFFICIENT FUNDS: ${e.message}`;
  }
  if (/InvalidContractProposal|contract/i.test(c)) return `CONTRACT REJECTED: ${e.message}`;
  if (/RateLimit|rate/i.test(c)) return `RATE LIMITED: ${e.message}. Backing off.`;
  if (/MarketIsClosed|closed/i.test(c)) return `MARKET CLOSED: ${e.message}`;
  if (/AuthorizationRequired|authorization/i.test(c)) {
    return `NOT AUTHORIZED: this socket is not authenticated. Real trading requires a connected account.`;
  }
  return `BUY FAILED [${c}]: ${e.message}`;
}
