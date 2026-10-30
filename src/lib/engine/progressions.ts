/**
 * Stake progressions — the named strategies Deriv's Quick Strategy wizard offers.
 *
 * Deriv Bot ships Martingale, D'Alembert, Reverse Martingale, Reverse D'Alembert,
 * Oscar's Grind and 1-3-2-6 as first-class choices, so this platform uses the same
 * vocabulary instead of inventing its own "recovery mode".
 *
 * Every function here is PURE over the outcome history. That is deliberate:
 *   - it is reproducible, so the simulation can be replayed from a seed and produce
 *     identical stakes trade-for-trade;
 *   - it cannot drift from hidden mutable state after a pause/resume or a reload;
 *   - it is trivially testable against hand-computed sequences.
 *
 * THE HONEST PART, stated once and enforced in the UI: a progression changes the
 * SHAPE of your stake sequence, never the expected value of the underlying contract.
 * On a contract priced at 1.95x for a 50% event (EV -2.5% per trade), Martingale does
 * not turn that positive — it converts many small losses into rare large ones. Nothing
 * in this file should be described as a way to beat the market.
 */

/** Deriv's own stake bounds, shown in the bot builder as "(min: 0.35 - max: 50000)". */
export const DERIV_STAKE_MIN = 0.35;
export const DERIV_STAKE_MAX = 50000;

export type ProgressionKind =
  | 'flat'
  | 'martingale'
  | 'reverse_martingale'
  | 'dalembert'
  | 'reverse_dalembert'
  | 'oscars_grind'
  | 'one_three_two_six';

export interface ProgressionConfig {
  kind: ProgressionKind;
  /** Base stake, in account currency. One "unit" in the classic descriptions. */
  unit: number;
  /** Multiplier for the Martingale family. Deriv's default is 2. */
  multiplier?: number;
}

/** A settled trade's outcome. `profit` is net, so it already reflects the real payout. */
export interface TradeOutcome {
  won: boolean;
  profit: number;
}

function clampRound(n: number): number {
  if (!Number.isFinite(n)) return DERIV_STAKE_MIN;
  const clamped = Math.min(Math.max(n, DERIV_STAKE_MIN), DERIV_STAKE_MAX);
  return Math.round(clamped * 100) / 100;
}

function trailingRun(history: TradeOutcome[], won: boolean): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].won === won) n++;
    else break;
  }
  return n;
}

/**
 * Stake to use for the NEXT trade, given everything that has already settled.
 *
 * Returns a value already clamped to Deriv's bounds and rounded to 2 decimals,
 * because a stake that violates either would be rejected by the API anyway.
 */
export function progressionStake(cfg: ProgressionConfig, history: TradeOutcome[]): number {
  const unit = cfg.unit > 0 ? cfg.unit : DERIV_STAKE_MIN;
  const m = cfg.multiplier && cfg.multiplier > 1 ? cfg.multiplier : 2;

  switch (cfg.kind) {
    case 'flat':
      return clampRound(unit);

    case 'martingale': {
      // Double up after each loss; a single win resets the sequence.
      const losses = trailingRun(history, false);
      return clampRound(unit * Math.pow(m, losses));
    }

    case 'reverse_martingale': {
      // The mirror image: press the stake after wins, reset after a loss.
      const wins = trailingRun(history, true);
      return clampRound(unit * Math.pow(m, wins));
    }

    case 'dalembert': {
      // One unit up after a loss, one unit down after a win, never below one unit.
      let level = 1;
      for (const t of history) level = t.won ? Math.max(1, level - 1) : level + 1;
      return clampRound(unit * level);
    }

    case 'reverse_dalembert': {
      let level = 1;
      for (const t of history) level = t.won ? level + 1 : Math.max(1, level - 1);
      return clampRound(unit * level);
    }

    case 'oscars_grind': {
      // Grind out exactly one unit of profit per cycle. A loss leaves the stake alone;
      // a win raises it by one unit UNLESS the cycle goal is already met, in which
      // case the cycle closes and the stake returns to one unit.
      let level = 1;
      let cycleProfit = 0;
      for (const t of history) {
        cycleProfit += t.profit;
        if (cycleProfit >= unit) {
          level = 1;
          cycleProfit = 0;
        } else if (t.won) {
          level += 1;
        }
      }
      return clampRound(unit * level);
    }

    case 'one_three_two_six': {
      // Walk 1 → 3 → 2 → 6 on wins, back to 1 on any loss. Four wins close the cycle.
      const seq = [1, 3, 2, 6];
      let idx = 0;
      for (const t of history) idx = t.won ? (idx + 1) % seq.length : 0;
      return clampRound(unit * seq[idx]);
    }

    default:
      return clampRound(unit);
  }
}

export interface ProgressionInfo {
  kind: ProgressionKind;
  name: string;
  /** One-line rule, as shown on the block/field itself. */
  rule: string;
  /** What the "Learn more" tab explains. */
  detail: string;
  /** The honest downside. Every progression has one and none is hidden. */
  risk: string;
  /** How fast the stake can escalate, for the UI's warning badge. */
  escalation: 'none' | 'gradual' | 'steep';
}

export const PROGRESSIONS: Record<ProgressionKind, ProgressionInfo> = {
  flat: {
    kind: 'flat',
    name: 'Fixed stake',
    rule: 'Stake stays at one unit every trade.',
    detail:
      'The stake never changes. Profit and loss therefore scale linearly with the number of trades, and the result of a session is decided entirely by the contract\u2019s own expected value.',
    risk: 'None beyond the contract itself. This is the baseline every other progression should be compared against.',
    escalation: 'none',
  },
  martingale: {
    kind: 'martingale',
    name: 'Martingale',
    rule: 'Multiply the stake after every loss; reset after a win.',
    detail:
      'A single win recovers all the losses in the current run plus one unit of profit, which is why the pattern feels reliable. It works until a losing run is long enough that the required stake exceeds your cap or your balance.',
    risk: 'Stake grows geometrically. Ten consecutive losses at a 2x multiplier and a 0.35 unit base needs 358.40 — a thousand times the starting stake — to win back 0.35.',
    escalation: 'steep',
  },
  reverse_martingale: {
    kind: 'reverse_martingale',
    name: 'Reverse Martingale',
    rule: 'Multiply the stake after every win; reset after a loss.',
    detail:
      'Presses a winning streak and gives the profit back on the first loss. On an independent-event contract such as Digit Odd/Even, streaks carry no predictive weight, so this changes variance rather than expectation.',
    risk: 'A long winning run builds a large stake that one loss removes. It cannot convert a negative-EV contract into a positive one.',
    escalation: 'steep',
  },
  dalembert: {
    kind: 'dalembert',
    name: "D'Alembert",
    rule: 'Add one unit after a loss, remove one after a win, never below one unit.',
    detail:
      'A linear progression, far gentler than Martingale. Recovery depends on wins and losses roughly balancing out over the cycle rather than on a single win clearing the run.',
    risk: 'Escalates slowly but without a natural ceiling; a sustained losing run still pushes the stake up one unit at a time.',
    escalation: 'gradual',
  },
  reverse_dalembert: {
    kind: 'reverse_dalembert',
    name: "Reverse D'Alembert",
    rule: 'Add one unit after a win, remove one after a loss, never below one unit.',
    detail: 'The mirror of D\u2019Alembert: it leans into winning runs with a linear rather than geometric increase.',
    risk: 'Gives back accumulated stake on the first loss of a run, with the same linear escalation on long streaks.',
    escalation: 'gradual',
  },
  oscars_grind: {
    kind: 'oscars_grind',
    name: "Oscar's Grind",
    rule: 'Target one unit of profit per cycle; raise the stake by one unit after a win until the target is met.',
    detail:
      'Each cycle aims for exactly one unit of profit and then restarts. Losses leave the stake unchanged, which keeps drawdown flatter than Martingale while still increasing exposure during a cycle.',
    risk: 'Cycles can run long when losses and wins alternate, holding an elevated stake for many trades before the one-unit target is reached.',
    escalation: 'gradual',
  },
  one_three_two_six: {
    kind: 'one_three_two_six',
    name: '1-3-2-6',
    rule: 'Stake 1, 3, 2 then 6 units across four consecutive wins; any loss returns to 1.',
    detail:
      'A fixed four-step cycle that banks profit part-way through: after the second win the stake drops, so two wins already lock a net gain for the cycle.',
    risk: 'The full 6-unit step is only reached on the fourth consecutive win, and a loss at step three or four gives back most of the cycle\u2019s gains.',
    escalation: 'gradual',
  },
};

export const PROGRESSION_ORDER: ProgressionKind[] = [
  'flat',
  'martingale',
  'dalembert',
  'oscars_grind',
  'one_three_two_six',
  'reverse_martingale',
  'reverse_dalembert',
];

/**
 * Worst-case stake after `n` consecutive losses, for the pre-trade warning.
 * Reported so the UI can show the user the number they are actually agreeing to
 * rather than letting a multiplier imply safety.
 */
export function worstCaseStake(cfg: ProgressionConfig, consecutiveLosses: number): number {
  const fake: TradeOutcome[] = Array.from({ length: consecutiveLosses }, () => ({ won: false, profit: -cfg.unit }));
  return progressionStake(cfg, fake);
}
