import type { AccountMode } from '../deriv/types';
import type { ContractType } from '../deriv/contracts';
export type ExecutionPhase='preparing'|'waiting'|'qualified'|'pricing'|'buying'|'open'|'settled'|'stopping'|'stopped'|'halted'|'error';
export interface ExecutionEvent {
  operationId?:string;strategyId?:string;strategyName?:string;tool?:'elite';purchaseSubmitted?:boolean;outcomeUnresolved?:boolean;
  id:string;runId:string;at:number;phase:ExecutionPhase;detail:string;
  accountLoginid?:string;mode:AccountMode;currency:string;symbol:string;contractType:ContractType;
  duration:number;durationUnit:string;barrier?:number;stake?:number;potentialPayout?:number;
  longcode?:string;pipSize?:number;dateStart?:number;dateExpiry?:number;canSell?:boolean;recordedTicks?:number;totalTicks?:number;buyTransactionId?:string;sellTransactionId?:string;brokerStatus?:string;
  contractId?:number;entryPrice?:number;exitPrice?:number;currentSpot?:number;contractValue?:number;profit?:number;
}
export interface ContractUpdate {
  longcode?:string;pipSize?:number;dateStart?:number;dateExpiry?:number;canSell?:boolean;recordedTicks?:number;totalTicks?:number;buyTransactionId?:string;sellTransactionId?:string;brokerStatus?:string;
  phase:'buying'|'open';contractId?:number;stake?:number;potentialPayout?:number;
  entryPrice?:number;exitPrice?:number;currentSpot?:number;contractValue?:number;profit?:number;
}
