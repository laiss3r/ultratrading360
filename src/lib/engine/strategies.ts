import type {EliteConfig} from '../elite/config';
import {validateElite} from '../elite/config';
import { validateLeg, type ContractRotation } from './rotation';
import type { ConditionGroup } from './conditions';
import type { ProgressionConfig } from './progressions';
import { validateGroup } from './conditions';
import type { ContractType } from '../deriv/contracts';
import { ContractService } from '../deriv/contracts';
import { DEFAULT_RECOVERY, DEFAULT_RISK_LIMITS, type RecoveryConfig, type RiskLimits } from './risk';

export interface Strategy {
  elite?:EliteConfig;
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
  /**
   * Named stake progression (Martingale, D'Alembert, Oscar's Grind, 1-3-2-6, ...).
   *
   * When present this governs the stake and the older `recovery` escalation is
   * bypassed — applying both would compound two escalations into one. The risk
   * manager still caps the result at `limits.maxStake`, so a progression can
   * never out-run the user's own exposure limits.
   */
  progression?: ProgressionConfig;
  contractRotation?: ContractRotation;
  /** Versioned live-pattern qualification, mandatory for Overlord-created setups. */
  signalGate?: { version: 1 };
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
    progression: partial.progression,
    contractRotation: partial.contractRotation,
    signalGate: partial.signalGate,
    notes: partial.notes,elite:partial.elite,
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
  if(s.elite)errors.push(...validateElite(s.elite));
  if((s.signalGate||s.name.startsWith('Overlord ·')) && ((s.signalGate&&s.signalGate.version!==1) || s.durationUnit!=='t' || s.duration>10)) errors.push('Signal-gated strategies require policy v1 and 1–10 tick duration.');

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

  errors.push(...validateGroup(s.entry), ...validateLeg(s));
  if (s.contractRotation) {
    errors.push(...validateLeg(s.contractRotation.recovery));
    if (!['return-after-recovery', 'switch-on-loss', 'alternate'].includes(s.contractRotation.mode)) errors.push('Invalid contract rotation mode.');
    if (!Number.isInteger(s.contractRotation.alternateTimes) || s.contractRotation.alternateTimes < 1 || s.contractRotation.alternateTimes > 5) errors.push('Contract alternation must be 1–5 settled entries.');
  }
  if (s.progression) {
    if (!['flat','martingale','reverse_martingale','dalembert','reverse_dalembert','oscars_grind','one_three_two_six'].includes(s.progression.kind)) errors.push('Invalid stake progression.');
    if (!Number.isFinite(s.progression.unit) || s.progression.unit <= 0) errors.push('Progression stake must be finite and positive.');
    if (s.progression.multiplier !== undefined && (!Number.isFinite(s.progression.multiplier) || s.progression.multiplier <= 1)) errors.push('Progression multiplier must be finite and greater than 1.');
    if (s.progression.stepLimit !== undefined && (!Number.isInteger(s.progression.stepLimit) || s.progression.stepLimit < 1 || s.progression.stepLimit > 10)) errors.push('Progression step limit must be 1–10.');
  }
  for (const [key,value] of Object.entries(s.limits)) if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) errors.push(`Invalid risk limit: ${key}.`);
  if (!Number.isFinite(s.stake) || !Number.isFinite(s.cooldownSeconds) || !Number.isInteger(s.maxTrades)) errors.push('Strategy amounts and entry count must be finite.');

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


/** Per-bot settings may tighten global caps, never relax permissions or safety limits. */
export function effectiveStrategyLimits(global: RiskLimits, strategy: Strategy): RiskLimits {
  const next = { ...global };
  const caps: (keyof RiskLimits)[] = ['maxStake','maxOpenExposure','maxSessionExposure','maxTrades','maxSessionLoss','maxDailyLoss'];
  for (const key of caps) (next as unknown as Record<string,number|boolean>)[key] = Math.min(global[key] as number, strategy.limits[key] as number);
  const positiveMin = (a:number,b:number) => a > 0 && b > 0 ? Math.min(a,b) : Math.max(a,b);
  next.minStake = Math.max(global.minStake, strategy.limits.minStake);
  next.maxSessionProfit = positiveMin(global.maxSessionProfit, strategy.limits.maxSessionProfit);
  next.maxDrawdownPct = positiveMin(global.maxDrawdownPct, strategy.limits.maxDrawdownPct);
  next.maxTrades = Math.min(next.maxTrades, strategy.maxTrades);
  next.maxSessionExposure = Math.min(next.maxSessionExposure, strategy.maxExposure);
  return next;
}
