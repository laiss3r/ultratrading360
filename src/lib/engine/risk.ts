/**
 * Centralised risk manager.
 *
 * This is the ONLY authority that can approve a trade. It is consulted before every order,
 * in simulation AND on a live account, and its decision cannot be overridden by a strategy,
 * by recovery mode, or by the UI. Recovery mode is deliberately implemented as a *stake
 * suggestion* that is then clamped by the risk manager — it can never raise a limit.
 */

export interface RiskLimits {
  maxStake: number;
  minStake: number;
  /** Maximum currency value of contracts open at once. */
  maxOpenExposure: number;
  /** Maximum total stake committed during one session. */
  maxSessionExposure: number;
  maxTrades: number;
  /** Stop when cumulative session P/L falls below -maxSessionLoss. */
  maxSessionLoss: number;
  /**
   * Take-profit halt: stop when cumulative session P/L reaches this amount. 0 disables it.
   * Symmetric with maxSessionLoss — a session target is a stop condition, so it is enforced here
   * rather than by a UI timer that could be bypassed.
   */
  maxSessionProfit: number;
  /** Stop when cumulative P/L for the current UTC day falls below -maxDailyLoss. */
  maxDailyLoss: number;
  /** Stop when equity falls this fraction below its session peak. 0 disables. */
  maxDrawdownPct: number;
  /** Hard kill switch. When true nothing may trade regardless of other settings. */
  tradingEnabled: boolean;
  /** Real-money trading requires a separate, explicit acknowledgement. */
  realTradingAcknowledged: boolean;
}

export interface RecoveryConfig {
  enabled: boolean;
  multiplier: number;
  stepLimit: number;
  maxStake: number;
  /** Stop escalating after this cumulative drawdown. */
  maxDrawdown: number;
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxStake: 10,
  minStake: 0.35,
  maxOpenExposure: 50,
  maxSessionExposure: 500,
  maxTrades: 100,
  maxSessionProfit: 0,
  maxSessionLoss: 100,
  maxDailyLoss: 250,
  maxDrawdownPct: 0.25,
  tradingEnabled: false,
  realTradingAcknowledged: false,
};

export const DEFAULT_RECOVERY: RecoveryConfig = {
  enabled: false,
  multiplier: 1.5,
  stepLimit: 4,
  maxStake: 25,
  maxDrawdown: 100,
};

export interface RiskSnapshot {
  tradesThisSession: number;
  sessionPnl: number;
  dailyPnl: number;
  dailyDate: string;
  openExposure: number;
  sessionExposure: number;
  equityPeak: number;
  equity: number;
  consecutiveLosses: number;
  recoveryStep: number;
  /**
   * Set once evaluate() returns a halt decision. Persisted in the snapshot so the UI can explain
   * WHY trading stopped instead of just showing a disabled button. Cleared by resetSession().
   */
  halted: boolean;
  haltReason?: string;
  haltDetail?: string;
}

export interface RiskDecision {
  allowed: boolean;
  /** Final stake after clamping. May be lower than requested. */
  stake: number;
  requestedStake: number;
  clamped: boolean;
  reasons: string[];
  /** True when the session must halt. */
  halt: boolean;
  haltReason?: string;
}

function utcDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export class RiskManager {
  private snap: RiskSnapshot;

  constructor(
    public limits: RiskLimits = { ...DEFAULT_RISK_LIMITS },
    public recovery: RecoveryConfig = { ...DEFAULT_RECOVERY },
    startingEquity = 0,
  ) {
    this.snap = {
      tradesThisSession: 0,
      sessionPnl: 0,
      dailyPnl: 0,
      dailyDate: utcDate(),
      openExposure: 0,
      sessionExposure: 0,
      equityPeak: startingEquity,
      equity: startingEquity,
      consecutiveLosses: 0,
      recoveryStep: 0,
      halted: false,
    };
  }

  getSnapshot(): RiskSnapshot {
    return { ...this.snap };
  }

  /** Roll the daily counters at UTC midnight so a long-running bot does not use stale limits. */
  private rollDay(now = new Date()) {
    const today = utcDate(now);
    if (today !== this.snap.dailyDate) {
      this.snap.dailyDate = today;
      this.snap.dailyPnl = 0;
    }
  }

  setEquity(equity: number) {
    this.snap.equity = equity;
    if (equity > this.snap.equityPeak) this.snap.equityPeak = equity;
  }

  /** Called when a contract is opened. */
  openExposure(stake: number) {
    this.snap.openExposure += stake;
    this.snap.sessionExposure += stake;
  }

  /** Called when a contract settles. */
  closeExposure(stake: number, profit: number, now = new Date()) {
    this.rollDay(now);
    this.snap.openExposure = Math.max(0, this.snap.openExposure - stake);
    this.snap.tradesThisSession += 1;
    this.snap.sessionPnl += profit;
    this.snap.dailyPnl += profit;
    this.snap.equity += profit;
    if (this.snap.equity > this.snap.equityPeak) this.snap.equityPeak = this.snap.equity;

    if (profit < 0) {
      this.snap.consecutiveLosses += 1;
      this.snap.recoveryStep = Math.min(this.snap.recoveryStep + 1, 99);
    } else if (profit > 0) {
      this.snap.consecutiveLosses = 0;
      this.snap.recoveryStep = 0;
    }
  }

  /** Recovery multiplier applied to a base stake, then clamped by recovery + risk limits. */
  suggestRecoveryStake(baseStake: number): number {
    if (!this.recovery.enabled || this.snap.recoveryStep === 0) return baseStake;
    const step = Math.min(this.snap.recoveryStep, this.recovery.stepLimit);
    const raw = baseStake * Math.pow(this.recovery.multiplier, step);
    return Math.min(raw, this.recovery.maxStake, this.limits.maxStake);
  }

  /**
   * The gate. Returns the decision AND the stake to actually use.
   * `halt: true` means the session must stop submitting orders entirely.
   */
  evaluate(requestedStake: number, mode: 'simulation' | 'deriv_demo' | 'deriv_real', now = new Date()): RiskDecision {
    this.rollDay(now);
    const reasons: string[] = [];
    const L = this.limits;

    // Kill switch first — nothing else matters if trading is disabled.
    if (!L.tradingEnabled) {
      return refuse(requestedStake, ['Trading is disabled. Enable it explicitly in Risk settings.'], true, 'trading_disabled');
    }
    if (mode === 'deriv_real' && !L.realTradingAcknowledged) {
      return refuse(
        requestedStake,
        ['REAL-MONEY trading is not acknowledged. You must explicitly confirm the account and accept the risk.'],
        true,
        'real_not_acknowledged',
      );
    }

    let halt = false;
    let haltReason: string | undefined;

    if (this.snap.tradesThisSession >= L.maxTrades) {
      halt = true;
      haltReason = 'max_trades';
      reasons.push(`Trade limit reached (${this.snap.tradesThisSession}/${L.maxTrades}).`);
    }
    if (this.snap.sessionPnl <= -Math.abs(L.maxSessionLoss)) {
      halt = true;
      haltReason = 'session_loss';
      reasons.push(`Session loss limit hit (${this.snap.sessionPnl.toFixed(2)} <= -${L.maxSessionLoss}).`);
    }
    if (L.maxSessionProfit > 0 && this.snap.sessionPnl >= L.maxSessionProfit) {
      halt = true;
      haltReason = 'session_target';
      reasons.push(`Session profit target reached (${this.snap.sessionPnl.toFixed(2)} >= ${L.maxSessionProfit}). Stopping while ahead.`);
    }
    if (this.snap.dailyPnl <= -Math.abs(L.maxDailyLoss)) {
      halt = true;
      haltReason = 'daily_loss';
      reasons.push(`Daily loss limit hit (${this.snap.dailyPnl.toFixed(2)} <= -${L.maxDailyLoss}).`);
    }
    if (L.maxDrawdownPct > 0 && this.snap.equityPeak > 0) {
      const dd = (this.snap.equityPeak - this.snap.equity) / this.snap.equityPeak;
      if (dd >= L.maxDrawdownPct) {
        halt = true;
        haltReason = 'drawdown';
        reasons.push(`Max drawdown hit (${(dd * 100).toFixed(1)}% >= ${(L.maxDrawdownPct * 100).toFixed(1)}%).`);
      }
    }
    if (this.recovery.enabled && this.snap.recoveryStep >= this.recovery.stepLimit) {
      reasons.push(
        `Recovery step limit reached (${this.snap.recoveryStep}/${this.recovery.stepLimit}); stake is capped, not escalated further.`,
      );
    }
    if (this.recovery.enabled && -this.snap.sessionPnl >= this.recovery.maxDrawdown) {
      halt = true;
      haltReason = 'recovery_drawdown';
      reasons.push(`Recovery max drawdown hit (${-this.snap.sessionPnl.toFixed(2)} >= ${this.recovery.maxDrawdown}).`);
    }

    if (halt) {
      // Record WHY, so the UI can explain a stopped bot instead of showing a dead button.
      this.snap.halted = true;
      this.snap.haltReason = haltReason;
      this.snap.haltDetail = reasons.join(' ');
      return refuse(requestedStake, reasons, true, haltReason);
    }

    // Clamp the stake. Recovery can suggest more; the risk manager always has the last word.
    let stake = requestedStake;
    let clamped = false;
    if (stake < L.minStake) {
      stake = L.minStake;
      clamped = true;
      reasons.push(`Stake raised to the broker minimum ${L.minStake}.`);
    }
    if (stake > L.maxStake) {
      stake = L.maxStake;
      clamped = true;
      reasons.push(`Stake capped at maxStake ${L.maxStake}.`);
    }
    if (this.recovery.enabled && stake > this.recovery.maxStake) {
      stake = this.recovery.maxStake;
      clamped = true;
      reasons.push(`Stake capped by recovery.maxStake ${this.recovery.maxStake}.`);
    }

    const roomExposure = L.maxOpenExposure - this.snap.openExposure;
    if (stake > roomExposure) {
      if (roomExposure <= 0) {
        return refuse(requestedStake, [`Open exposure limit reached (${this.snap.openExposure}/${L.maxOpenExposure}).`], false, 'max_open_exposure');
      }
      stake = roomExposure;
      clamped = true;
      reasons.push(`Stake reduced to remaining open exposure ${roomExposure.toFixed(2)}.`);
    }

    const roomSession = L.maxSessionExposure - this.snap.sessionExposure;
    if (stake > roomSession) {
      if (roomSession <= 0) {
        return refuse(requestedStake, [`Session exposure limit reached (${this.snap.sessionExposure}/${L.maxSessionExposure}).`], true, 'max_session_exposure');
      }
      stake = roomSession;
      clamped = true;
      reasons.push(`Stake reduced to remaining session exposure ${roomSession.toFixed(2)}.`);
    }

    if (stake < L.minStake) {
      return refuse(requestedStake, [...reasons, `After clamping, stake ${stake.toFixed(2)} is below the minimum ${L.minStake}.`], false, 'below_minimum');
    }

    return { allowed: true, stake: round2(stake), requestedStake, clamped, reasons, halt: false };
  }

  /** Reset per-session counters but keep the daily counters (they span the UTC day). */
  resetSession() {
    this.snap.halted = false;
    this.snap.haltReason = undefined;
    this.snap.haltDetail = undefined;
    this.snap.tradesThisSession = 0;
    this.snap.sessionPnl = 0;
    this.snap.openExposure = 0;
    this.snap.sessionExposure = 0;
    this.snap.consecutiveLosses = 0;
    this.snap.recoveryStep = 0;
  }

  resetAll(startingEquity = 0) {
    this.snap.halted = false;
    this.snap.haltReason = undefined;
    this.snap.haltDetail = undefined;
    this.snap = {
      tradesThisSession: 0,
      sessionPnl: 0,
      dailyPnl: 0,
      dailyDate: utcDate(),
      openExposure: 0,
      sessionExposure: 0,
      equityPeak: startingEquity,
      equity: startingEquity,
      consecutiveLosses: 0,
      recoveryStep: 0,
      halted: false,
    };
  }
}

function refuse(requestedStake: number, reasons: string[], halt: boolean, haltReason?: string): RiskDecision {
  return { allowed: false, stake: 0, requestedStake, clamped: false, reasons, halt, haltReason };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
