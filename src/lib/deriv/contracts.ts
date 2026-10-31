import { requiredBrokerNumber } from './numbers';
import { DerivClient } from './client';
import type { ContractSpec, Proposal } from './types';

export type DigitContractType =
  | 'DIGITODD'
  | 'DIGITEVEN'
  | 'DIGITOVER'
  | 'DIGITUNDER'
  | 'DIGITMATCH'
  | 'DIGITDIFF';

export type RiseFallContractType = 'CALL' | 'PUT';
export type ContractType = DigitContractType | RiseFallContractType;

export interface ProposalRequest {
  underlying: string;
  contractType: ContractType;
  amount: number;
  basis: 'stake' | 'payout';
  currency: string;
  duration: number;
  durationUnit: 't' | 's' | 'm' | 'h' | 'd';
  barrier?: string;
}

/**
 * Contract discovery and pricing.
 *
 * IMPORTANT: the current API renamed the field. Proposals must send `underlying_symbol`;
 * sending `symbol` returns InputValidationFailed {"symbol":"field is not allowed"}.
 * Verified live 2026-10-29.
 */
export class ContractService {
  constructor(private client: DerivClient) {}

  async contractsFor(underlying: string): Promise<ContractSpec[]> {
    const res = await this.client.send<{ contracts_for: { available: ContractSpec[] } }>({
      contracts_for: underlying,
    });
    return res.contracts_for?.available ?? [];
  }

  async supportedContractTypes(underlying: string): Promise<string[]> {
    const specs = await this.contractsFor(underlying);
    return Array.from(new Set(specs.map((s) => s.contract_type))).sort();
  }

  /**
   * Request a live proposal. The returned `ask_price` and `payout` are the broker's actual
   * numbers — every purchase must be priced from a proposal, never from an assumed payout.
   */
  async proposal(req: ProposalRequest): Promise<{ proposal: Proposal; impliedProbability: number }> {
    const body: Record<string, unknown> = {
      proposal: 1,
      amount: req.amount,
      basis: req.basis,
      contract_type: req.contractType,
      currency: req.currency,
      duration: req.duration,
      duration_unit: req.durationUnit,
      underlying_symbol: req.underlying,
    };
    if (req.barrier !== undefined) body.barrier = String(req.barrier);

    const res = await this.client.send<{ proposal: Proposal }>(body);
    const p = {...res.proposal,ask_price:requiredBrokerNumber(res.proposal.ask_price,'proposal ask'),payout:requiredBrokerNumber(res.proposal.payout,'proposal payout')};
    if(p.ask_price<=0||p.payout<=0||typeof p.id!=='string'||!p.id)throw new Error('Broker proposal is invalid; refusing purchase.');
    // Deriv quotes `payout` for basis=stake and `ask_price` for basis=payout; normalise both.
    const stake = req.basis === 'stake' ? p.ask_price : req.amount;
    const payout = req.basis === 'payout' ? p.ask_price : p.payout;
    const impliedProbability = payout > 0 ? stake / payout : 0;
    return { proposal: p, impliedProbability };
  }

  /** Digit contracts that require a barrier (0..9). */
  static requiresBarrier(t: ContractType): boolean {
    return t === 'DIGITOVER' || t === 'DIGITUNDER' || t === 'DIGITMATCH' || t === 'DIGITDIFF';
  }
}
