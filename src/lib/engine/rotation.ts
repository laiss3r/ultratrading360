import { ContractService, type ContractType } from '../deriv/contracts';

export interface ContractLeg { contractType: ContractType; barrier?: number }
export interface ContractRotation {
  mode: 'return-after-recovery' | 'switch-on-loss' | 'alternate';
  recovery: ContractLeg;
  alternateTimes: number;
}
export interface RotationOutcome { profit: number }
export const SUPPORTED_CONTRACTS: ContractType[] = ['DIGITEVEN','DIGITODD','DIGITOVER','DIGITUNDER','DIGITMATCH','DIGITDIFF','CALL','PUT'];

export function validateLeg(leg: ContractLeg): string[] {
  if (!SUPPORTED_CONTRACTS.includes(leg.contractType)) return ['Unsupported contract type.'];
  if (!ContractService.requiresBarrier(leg.contractType)) return [];
  if (!Number.isInteger(leg.barrier) || leg.barrier! < 0 || leg.barrier! > 9) return ['Prediction must be an integer from 0 to 9.'];
  if (leg.contractType === 'DIGITOVER' && leg.barrier === 9) return ['Over 9 cannot win.'];
  if (leg.contractType === 'DIGITUNDER' && leg.barrier === 0) return ['Under 0 cannot win.'];
  return [];
}

/** Decisions use settled broker P/L only; zero-net settlements count as non-wins. */
export function nextContract(primary: ContractLeg, rotation: ContractRotation | undefined, history: RotationOutcome[]): ContractLeg {
  if (!rotation || !history.length) return primary;
  let useRecovery = false;
  switch (rotation.mode) {
    case 'return-after-recovery': useRecovery = history.at(-1)!.profit <= 0; break;
    case 'switch-on-loss': useRecovery = history.filter((t)=>t.profit <= 0).length % 2 === 1; break;
    case 'alternate': useRecovery = Math.floor(history.length / rotation.alternateTimes) % 2 === 1; break;
  }
  return useRecovery ? rotation.recovery : primary;
}
