import type { ConditionGroup } from './conditions';
import { validateGroup } from './conditions';
import type { ContractType } from '../deriv/contracts';
import { ContractService } from '../deriv/contracts';
import { DEFAULT_RECOVERY, DEFAULT_RISK_LIMITS, type RecoveryConfig, type RiskLimits } from './risk';

export interface Strategy {
  id: string;
  name: string;
  /** Monotonic. Bumped on every save so a running bot never silently changes behaviour. */
  version: number;
  createdAt: number;
  updatedAt: number;
  market: string;
  contractType: ContractType;
  barrier?: number;
  duration: number;
  durationUnit: 't' | 's' | 'm' | 'h' | 'd';
  stake: number;
  currency: string;
  entry: ConditionGroup;
  cooldownSeconds: number;
  maxTrades: number;
  maxExposure: number;
  limits: RiskLimits;
  recovery: RecoveryConfig;
  notes?: string;
}

export function newStrategyId(): string {
  return `stg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createStrategy(partial: Partial<Strategy> = {}): Strategy {
  const now = Date.now();
  return {
    id: partial.id ?? newStrategyId(),
    name: partial.name ?? 'Untitled strategy',
    version: partial.version ?? 1,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    market: partial.market ?? 'R_100',
    contractType: partial.contractType ?? 'DIGITODD',
    barrier: partial.barrier,
    duration: partial.duration ?? 1,
    durationUnit: partial.durationUnit ?? 't',
    stake: partial.stake ?? 0.35,
    currency: partial.currency ?? 'USD',
    entry: partial.entry ?? {
      id: 'root',
      op: 'AND',
      children: [{ id: 'c1', kind: 'odd' }],
    },
    cooldownSeconds: partial.cooldownSeconds ?? 2,
    maxTrades: partial.maxTrades ?? 50,
    maxExposure: partial.maxExposure ?? 100,
    limits: { ...DEFAULT_RISK_LIMITS, ...(partial.limits ?? {}) },
    recovery: { ...DEFAULT_RECOVERY, ...(partial.recovery ?? {}) },
    notes: partial.notes,
  };
}

export interface StrategyValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateStrategy(s: Strategy): StrategyValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!s.name.trim()) errors.push('Strategy needs a name.');
  if (!s.market.trim()) errors.push('Strategy needs a market symbol.');
  if (!(s.stake > 0)) errors.push(`Stake must be > 0 (got ${s.stake}).`);
  if (!(s.duration > 0) || !Number.isInteger(s.duration)) errors.push('Duration must be a positive integer.');
  if (!['t', 's', 'm', 'h', 'd'].includes(s.durationUnit)) errors.push('Invalid duration unit.');
  if (s.cooldownSeconds < 0) errors.push('Cooldown cannot be negative.');
  if (s.maxTrades <= 0) errors.push('maxTrades must be positive.');

  if (ContractService.requiresBarrier(s.contractType)) {
    if (s.barrier === undefined || !Number.isInteger(s.barrier) || s.barrier < 0 || s.barrier > 9) {
      errors.push(`${s.contractType} requires a barrier digit 0..9.`);
    }
    if (s.contractType === 'DIGITOVER' && s.barrier === 9) errors.push('DIGITOVER with barrier 9 can never win.');
    if (s.contractType === 'DIGITUNDER' && s.barrier === 0) errors.push('DIGITUNDER with barrier 0 can never win.');
    if (s.contractType === 'DIGITMATCH' && warnings) warnings.push('DIGITMATCH wins ~10% of the time; a single loss wipes ~9 wins at typical payouts.');
  } else if (s.barrier !== undefined && (s.contractType === 'DIGITODD' || s.contractType === 'DIGITEVEN')) {
    warnings.push('DIGITODD/DIGITEVEN ignore the barrier field.');
  }

  errors.push(...validateGroup(s.entry));

  if (s.stake > s.limits.maxStake) {
    errors.push(`Stake ${s.stake} exceeds limits.maxStake ${s.limits.maxStake} — the risk manager will refuse every trade.`);
  }
  if (s.recovery.enabled) {
    if (s.recovery.multiplier <= 1) errors.push('Recovery multiplier must be > 1.');
    if (s.recovery.multiplier > 3) warnings.push(`Recovery multiplier ${s.recovery.multiplier} escalates very aggressively.`);
    if (s.recovery.stepLimit < 1) errors.push('Recovery stepLimit must be >= 1.');
    if (s.recovery.maxStake > s.limits.maxStake) {
      warnings.push(`recovery.maxStake ${s.recovery.maxStake} is above limits.maxStake ${s.limits.maxStake}; the risk limit wins.`);
    }
  }
  if (s.limits.maxSessionLoss <= 0) warnings.push('maxSessionLoss <= 0 will halt the bot on the first losing trade.');
  if (!s.limits.tradingEnabled) warnings.push('limits.tradingEnabled is false — the bot will refuse to trade until you enable it.');

  return { valid: errors.length === 0, errors, warnings };
}

/** Save-time versioning: bump version and updatedAt, keep id/createdAt. */
export function bumpVersion(s: Strategy, patch: Partial<Strategy>): Strategy {
  return { ...s, ...patch, id: s.id, createdAt: s.createdAt, version: s.version + 1, updatedAt: Date.now() };
}
