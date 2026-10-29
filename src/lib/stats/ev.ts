import { theoreticalDigitProbability } from '../deriv/digits';
import type { DigitContractType } from '../deriv/contracts';

export interface ExpectedValue {
  winProbability: number;
  lossProbability: number;
  stake: number;
  payout: number;
  netOnWin: number;
  netOnLoss: number;
  /** Expected profit per trade in account currency. Negative means the trade loses money. */
  evPerTrade: number;
  /** EV as a fraction of stake. -0.02 == a 2% expected loss per unit risked. */
  evPctOfStake: number;
  /** Break-even win probability at this payout. */
  breakEvenProbability: number;
  /** Edge over break-even, in probability points. Negative = no edge. */
  edge: number;
  houseEdgePct: number;
  verdict: string;
}

/**
 * Payout-aware expected value.
 *
 * The single most important number on this platform, and the one most digit-bot marketing
 * omits. A strategy can win 90% of trades and still lose money if the payout is 1.05x.
 * EV must be computed from the BROKER'S quoted payout, never from an assumed 2x.
 */
export function expectedValue(
  winProbability: number,
  stake: number,
  payout: number,
): ExpectedValue {
  if (stake <= 0) throw new RangeError('stake must be > 0');
  if (payout < 0) throw new RangeError('payout must be >= 0');
  const p = Math.min(1, Math.max(0, winProbability));
  const netOnWin = payout - stake;
  const netOnLoss = -stake;
  const ev = p * netOnWin + (1 - p) * netOnLoss;
  const breakEven = payout > 0 ? stake / payout : 1;
  const edge = p - breakEven;
  const evPct = ev / stake;
  // House edge is the EV a fair-odds player would face, i.e. -evPct when p is theoretical.
  return {
    winProbability: p,
    lossProbability: 1 - p,
    stake,
    payout,
    netOnWin,
    netOnLoss,
    evPerTrade: round4(ev),
    evPctOfStake: round4(evPct),
    breakEvenProbability: round4(breakEven),
    edge: round4(edge),
    houseEdgePct: round4(-evPct * 100),
    verdict: verdictFor(p, breakEven, evPct),
  };
}

function verdictFor(p: number, breakEven: number, evPct: number): string {
  if (evPct > 0.001) {
    return `POSITIVE expected value at these odds (+${(evPct * 100).toFixed(2)}% per trade). Verify the payout is still quoted at this level before scaling — brokers reprice.`;
  }
  if (evPct < -0.001) {
    return `NEGATIVE expected value (${(evPct * 100).toFixed(2)}% per trade). Win rate ${(p * 100).toFixed(1)}% is below the ${(breakEven * 100).toFixed(1)}% needed to break even at this payout. Over many trades this loses money regardless of short-term streaks.`;
  }
  return 'Break-even before costs. Any spread, commission or slippage makes this negative.';
}

/** EV using the fair theoretical probability — the honest baseline, not a fitted one. */
export function theoreticalEv(
  contractType: DigitContractType,
  stake: number,
  payout: number,
  barrier?: number,
): ExpectedValue {
  const p = theoreticalDigitProbability(contractType, barrier);
  return expectedValue(p, stake, payout);
}

/** EV using the win rate actually observed in a sample. */
export function observedEv(wins: number, n: number, stake: number, payout: number): ExpectedValue {
  return expectedValue(n > 0 ? wins / n : 0, stake, payout);
}

/**
 * Kelly criterion for stake sizing. Reported for reference and deliberately NOT used to
 * auto-size stakes: full Kelly on a negative-edge product is a fast route to zero, and the
 * edge estimate itself is uncertain.
 */
export function kellyFraction(winProbability: number, stake: number, payout: number): number {
  const b = payout / stake - 1; // net odds received
  if (b <= 0) return 0;
  const p = winProbability;
  const q = 1 - p;
  const f = (b * p - q) / b;
  return Math.max(0, f);
}

/**
 * Risk of ruin approximation for a sequence of independent bets.
 * Uses the standard closed form for a two-outcome game with a finite bankroll.
 */
export function riskOfRuin(winProbability: number, stake: number, payout: number, bankroll: number): number {
  const p = winProbability;
  const q = 1 - p;
  if (p <= 0) return 1;
  if (q <= 0) return 0;
  const units = Math.floor(bankroll / stake);
  if (units <= 0) return 1;
  const b = payout / stake - 1;
  if (b <= 0) return 1;
  // For an unfair game (p*b < q) ruin tends to 1.
  const ratio = q / (p * b);
  if (ratio >= 1) return 1;
  return Math.min(1, Math.pow(ratio, units));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
