import { describe, expect, it } from 'vitest';
import { DEFAULT_RECOVERY, DEFAULT_RISK_LIMITS, RiskManager, type RiskLimits } from './risk';

const enabled = (patch: Partial<RiskLimits> = {}): RiskLimits => ({
  ...DEFAULT_RISK_LIMITS,
  tradingEnabled: true,
  ...patch,
});

describe('RiskManager kill switches', () => {
  it('refuses everything while tradingEnabled is false', () => {
    const rm = new RiskManager({ ...DEFAULT_RISK_LIMITS, tradingEnabled: false });
    const d = rm.evaluate(1, 'simulation');
    expect(d.allowed).toBe(false);
    expect(d.halt).toBe(true);
    expect(d.haltReason).toBe('trading_disabled');
    expect(d.stake).toBe(0);
  });

  it('refuses REAL trading without explicit acknowledgement, even when trading is enabled', () => {
    const rm = new RiskManager(enabled({ realTradingAcknowledged: false }));
    const real = rm.evaluate(1, 'deriv_real');
    expect(real.allowed).toBe(false);
    expect(real.haltReason).toBe('real_not_acknowledged');
    // ...but simulation and demo are unaffected
    expect(rm.evaluate(1, 'simulation').allowed).toBe(true);
    expect(rm.evaluate(1, 'deriv_demo').allowed).toBe(true);
  });

  it('allows real trading only after acknowledgement', () => {
    const rm = new RiskManager(enabled({ realTradingAcknowledged: true }));
    expect(rm.evaluate(1, 'deriv_real').allowed).toBe(true);
  });
});

describe('stake clamping', () => {
  it('caps the stake at maxStake', () => {
    const rm = new RiskManager(enabled({ maxStake: 5 }));
    const d = rm.evaluate(100, 'simulation');
    expect(d.allowed).toBe(true);
    expect(d.stake).toBe(5);
    expect(d.clamped).toBe(true);
    expect(d.requestedStake).toBe(100);
  });

  it('raises the stake to the broker minimum', () => {
    const rm = new RiskManager(enabled({ minStake: 0.35 }));
    const d = rm.evaluate(0.01, 'simulation');
    expect(d.stake).toBe(0.35);
  });

  it('leaves an in-range stake untouched', () => {
    const rm = new RiskManager(enabled({ minStake: 0.35, maxStake: 10 }));
    const d = rm.evaluate(2.5, 'simulation');
    expect(d.stake).toBe(2.5);
    expect(d.clamped).toBe(false);
  });
});

describe('exposure limits', () => {
  it('reduces the stake to the remaining open exposure', () => {
    const rm = new RiskManager(enabled({ maxOpenExposure: 10, maxStake: 100 }));
    rm.openExposure(8);
    const d = rm.evaluate(50, 'simulation');
    expect(d.allowed).toBe(true);
    expect(d.stake).toBe(2);
  });

  it('refuses when open exposure is exhausted', () => {
    const rm = new RiskManager(enabled({ maxOpenExposure: 10 }));
    rm.openExposure(10);
    const d = rm.evaluate(1, 'simulation');
    expect(d.allowed).toBe(false);
    expect(d.haltReason).toBe('max_open_exposure');
    expect(d.halt).toBe(false); // transient: a settlement frees room
  });

  it('halts when session exposure is exhausted', () => {
    const rm = new RiskManager(enabled({ maxSessionExposure: 10, maxStake: 100 }));
    rm.openExposure(10);
    rm.closeExposure(10, 0); // exposure freed but session total consumed
    const d = rm.evaluate(1, 'simulation');
    expect(d.allowed).toBe(false);
    expect(d.halt).toBe(true);
    expect(d.haltReason).toBe('max_session_exposure');
  });
});

describe('loss, drawdown and trade-count halts', () => {
  it('halts at the session loss limit', () => {
    const rm = new RiskManager(enabled({ maxSessionLoss: 50 }), { ...DEFAULT_RECOVERY }, 1000);
    rm.openExposure(30);
    rm.closeExposure(30, -30, new Date());
    rm.setEquity(970);
    expect(rm.evaluate(1, 'simulation').halt).toBe(false);
    rm.openExposure(30);
    rm.closeExposure(30, -25);
    rm.setEquity(945);
    const d = rm.evaluate(1, 'simulation');
    expect(d.halt).toBe(true);
    expect(d.haltReason).toBe('session_loss');
  });

  it('halts at the daily loss limit but not the session limit', () => {
    const rm = new RiskManager(enabled({ maxSessionLoss: 1000, maxDailyLoss: 20 }), { ...DEFAULT_RECOVERY }, 1000);
    rm.openExposure(25);
    rm.closeExposure(25, -25);
    rm.setEquity(975);
    expect(rm.evaluate(1, 'simulation').haltReason).toBe('daily_loss');
  });

  it('resets the daily counter at UTC midnight', () => {
    const rm = new RiskManager(enabled({ maxDailyLoss: 10, maxSessionLoss: 1e9 }), { ...DEFAULT_RECOVERY }, 1000);
    const day1 = new Date('2026-03-01T23:59:00Z');
    rm.openExposure(20);
    rm.closeExposure(20, -20, day1);
    rm.setEquity(980);
    expect(rm.evaluate(1, 'simulation', day1).halt).toBe(true);
    const day2 = new Date('2026-03-02T00:01:00Z');
    // A new UTC day clears the daily loss counter.
    expect(rm.evaluate(1, 'simulation', day2).halt).toBe(false);
  });

  it('halts at the max drawdown percentage', () => {
    const rm = new RiskManager(enabled({ maxDrawdownPct: 0.1, maxSessionLoss: 1e9, maxDailyLoss: 1e9 }), { ...DEFAULT_RECOVERY }, 1000);
    rm.setEquity(1200); // new peak
    rm.setEquity(1079); // 10.08% below peak
    const d = rm.evaluate(1, 'simulation');
    expect(d.halt).toBe(true);
    expect(d.haltReason).toBe('drawdown');
  });

  it('maxDrawdownPct of 0 disables the drawdown halt', () => {
    const rm = new RiskManager(enabled({ maxDrawdownPct: 0, maxSessionLoss: 1e9, maxDailyLoss: 1e9 }), { ...DEFAULT_RECOVERY }, 1000);
    rm.setEquity(10);
    expect(rm.evaluate(1, 'simulation').haltReason).not.toBe('drawdown');
  });

  it('halts at maxTrades', () => {
    const rm = new RiskManager(enabled({ maxTrades: 2, maxSessionLoss: 1e9, maxDailyLoss: 1e9 }), { ...DEFAULT_RECOVERY }, 1000);
    for (let i = 0; i < 2; i++) {
      rm.openExposure(1);
      rm.closeExposure(1, 1);
    }
    const d = rm.evaluate(1, 'simulation');
    expect(d.halt).toBe(true);
    expect(d.haltReason).toBe('max_trades');
  });
});

describe('recovery mode can never override a risk limit', () => {
  it('escalates the stake after losses, up to stepLimit', () => {
    const rm = new RiskManager(enabled({ maxStake: 1000 }), {
      enabled: true, multiplier: 2, stepLimit: 3, maxStake: 1000, maxDrawdown: 1e9,
    }, 1000);
    expect(rm.suggestRecoveryStake(1)).toBe(1); // no losses yet
    for (let i = 0; i < 3; i++) {
      rm.openExposure(1);
      rm.closeExposure(1, -1);
    }
    expect(rm.suggestRecoveryStake(1)).toBe(8); // 1 * 2^3
    rm.openExposure(8);
    rm.closeExposure(8, -8); // 4th loss
    expect(rm.suggestRecoveryStake(1)).toBe(8); // clamped at stepLimit 3, not 16
  });

  it('caps the escalation at recovery.maxStake', () => {
    const rm = new RiskManager(enabled({ maxStake: 1000 }), {
      enabled: true, multiplier: 3, stepLimit: 5, maxStake: 10, maxDrawdown: 1e9,
    }, 1000);
    for (let i = 0; i < 4; i++) {
      rm.openExposure(1);
      rm.closeExposure(1, -0.5);
    }
    expect(rm.suggestRecoveryStake(1)).toBeLessThanOrEqual(10);
  });

  it('the risk manager overrides an over-large recovery suggestion', () => {
    const rm = new RiskManager(enabled({ maxStake: 4 }), {
      enabled: true, multiplier: 5, stepLimit: 5, maxStake: 999, maxDrawdown: 1e9,
    }, 1000);
    for (let i = 0; i < 3; i++) {
      rm.openExposure(1);
      rm.closeExposure(1, -0.5);
    }
    const suggested = rm.suggestRecoveryStake(1); // 125
    expect(suggested).toBe(4); // clamped by limits.maxStake inside suggestRecoveryStake
    const d = rm.evaluate(suggested, 'simulation');
    expect(d.stake).toBeLessThanOrEqual(4);
  });

  it('halts when recovery maxDrawdown is breached', () => {
    const rm = new RiskManager(enabled({ maxSessionLoss: 1e9, maxDailyLoss: 1e9 }), {
      enabled: true, multiplier: 2, stepLimit: 10, maxStake: 100, maxDrawdown: 30,
    }, 1000);
    rm.openExposure(40);
    rm.closeExposure(40, -40);
    rm.setEquity(960);
    const d = rm.evaluate(1, 'simulation');
    expect(d.halt).toBe(true);
    expect(d.haltReason).toBe('recovery_drawdown');
  });

  it('resets the recovery step after a win', () => {
    const rm = new RiskManager(enabled(), { enabled: true, multiplier: 2, stepLimit: 5, maxStake: 100, maxDrawdown: 1e9 }, 1000);
    for (let i = 0; i < 3; i++) {
      rm.openExposure(1);
      rm.closeExposure(1, -1);
    }
    expect(rm.getSnapshot().recoveryStep).toBe(3);
    rm.openExposure(1);
    rm.closeExposure(1, 2);
    expect(rm.getSnapshot().recoveryStep).toBe(0);
    expect(rm.getSnapshot().consecutiveLosses).toBe(0);
  });
});

describe('session bookkeeping', () => {
  it('tracks consecutive losses', () => {
    const rm = new RiskManager(enabled(), { ...DEFAULT_RECOVERY }, 1000);
    for (const p of [-1, -1, -1, 2, -1]) {
      rm.openExposure(1);
      rm.closeExposure(1, p);
    }
    expect(rm.getSnapshot().consecutiveLosses).toBe(1);
  });

  it('resetSession clears session counters but keeps the daily total', () => {
    const rm = new RiskManager(enabled(), { ...DEFAULT_RECOVERY }, 1000);
    rm.openExposure(5);
    rm.closeExposure(5, -5);
    expect(rm.getSnapshot().sessionPnl).toBe(-5);
    expect(rm.getSnapshot().dailyPnl).toBe(-5);
    rm.resetSession();
    expect(rm.getSnapshot().sessionPnl).toBe(0);
    expect(rm.getSnapshot().tradesThisSession).toBe(0);
    expect(rm.getSnapshot().dailyPnl).toBe(-5);
  });

  it('resetAll clears everything including the equity peak', () => {
    const rm = new RiskManager(enabled(), { ...DEFAULT_RECOVERY }, 1000);
    rm.setEquity(5000);
    rm.openExposure(5);
    rm.closeExposure(5, 50);
    rm.resetAll(2000);
    const s = rm.getSnapshot();
    expect(s.equityPeak).toBe(2000);
    expect(s.dailyPnl).toBe(0);
    expect(s.openExposure).toBe(0);
  });

  it('never lets open exposure go negative', () => {
    const rm = new RiskManager(enabled(), { ...DEFAULT_RECOVERY }, 1000);
    rm.closeExposure(100, 0);
    expect(rm.getSnapshot().openExposure).toBe(0);
  });
});

describe('take-profit halt (maxSessionProfit)', () => {
  const settle = (r: RiskManager, profit: number) => r.closeExposure(1, profit);

  it('is disabled when set to 0', () => {
    const r = new RiskManager(enabled({ maxSessionProfit: 0 }), { ...DEFAULT_RECOVERY }, 1000);
    settle(r, 500);
    expect(r.evaluate(1, 'simulation').allowed).toBe(true);
  });

  it('halts once cumulative session profit reaches the target', () => {
    const r = new RiskManager(enabled({ maxSessionProfit: 20 }), { ...DEFAULT_RECOVERY }, 1000);
    expect(r.evaluate(1, 'simulation').allowed).toBe(true);
    settle(r, 12);
    expect(r.evaluate(1, 'simulation').allowed).toBe(true);
    settle(r, 9);
    const d = r.evaluate(1, 'simulation');
    expect(d.allowed).toBe(false);
    expect(d.halt).toBe(true);
    expect(d.haltReason).toBe('session_target');
    expect(d.reasons.join(' ')).toMatch(/profit target/i);
  });

  it('surfaces the halt in the snapshot so the UI can explain why trading stopped', () => {
    const r = new RiskManager(enabled({ maxSessionProfit: 5 }), { ...DEFAULT_RECOVERY }, 1000);
    settle(r, 6);
    r.evaluate(1, 'simulation');
    const snap = r.getSnapshot();
    expect(snap.halted).toBe(true);
    expect(snap.haltReason).toBe('session_target');
    expect(snap.haltDetail).toMatch(/profit target/i);
  });

  it('clears the halt flag when the session counters are reset', () => {
    const r = new RiskManager(enabled({ maxSessionProfit: 5 }), { ...DEFAULT_RECOVERY }, 1000);
    settle(r, 6);
    r.evaluate(1, 'simulation');
    expect(r.getSnapshot().halted).toBe(true);
    r.resetSession();
    const snap = r.getSnapshot();
    expect(snap.halted).toBe(false);
    expect(snap.haltReason).toBeUndefined();
    expect(r.evaluate(1, 'simulation').allowed).toBe(true);
  });
});
