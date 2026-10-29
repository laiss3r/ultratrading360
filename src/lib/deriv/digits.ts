/**
 * Last-digit extraction using the CORRECT instrument precision.
 *
 * Deriv returns a `pip_size` per instrument. R_100 / 1HZ100V report pip_size 2, so the
 * meaningful last digit is the hundredths place of the quote — NOT the last character of
 * whatever float formatting the runtime happens to produce.
 *
 * Getting this wrong silently corrupts every digit statistic downstream, which is the single
 * most common bug in Deriv digit bots.
 */

/** Number of decimal places an instrument's quotes are expressed in. */
export type PipSize = number;

/**
 * Extract the final significant digit of a quote at the instrument's precision.
 *
 * Mirrors Deriv's own DBot behaviour: format to exactly `pipSize` decimals, take the last
 * character. `toFixed` avoids binary float artefacts (e.g. 571.94 * 100 === 57194.00000000001).
 */
export function lastDigit(quote: number, pipSize: PipSize): number {
  if (!Number.isFinite(quote)) throw new RangeError(`quote is not finite: ${quote}`);
  if (!Number.isInteger(pipSize) || pipSize < 0 || pipSize > 10) {
    throw new RangeError(`pipSize must be an integer 0..10, got ${pipSize}`);
  }
  const text = quote.toFixed(pipSize);
  const ch = text.charAt(text.length - 1);
  const d = Number(ch);
  if (!Number.isInteger(d) || d < 0 || d > 9) {
    throw new RangeError(`could not derive a digit from ${text}`);
  }
  return d;
}

/** Same result via scaled rounding — kept as an independent cross-check used by the tests. */
export function lastDigitByScaling(quote: number, pipSize: PipSize): number {
  const scaled = Math.round(quote * Math.pow(10, pipSize));
  const d = Math.abs(scaled) % 10;
  return d;
}

/** Extract the digit series from a ticks_history `prices` array. */
export function digitSeries(prices: number[], pipSize: PipSize): number[] {
  return prices.map((p) => lastDigit(p, pipSize));
}

/** Parity of a digit. */
export function isOdd(digit: number): boolean {
  return digit % 2 === 1;
}

/** Over/under relative to a barrier digit (0..9), using Deriv's strict inequalities. */
export function isOver(digit: number, barrier: number): boolean {
  return digit > barrier;
}
export function isUnder(digit: number, barrier: number): boolean {
  return digit < barrier;
}

/**
 * Theoretical win probability of a digit contract on a uniform, independent digit stream.
 * Used for payout-aware expected value — the honest benchmark, not a prediction.
 */
export function theoreticalDigitProbability(
  contractType: 'DIGITODD' | 'DIGITEVEN' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF',
  barrier?: number,
): number {
  switch (contractType) {
    case 'DIGITODD':
    case 'DIGITEVEN':
      return 0.5;
    case 'DIGITMATCH':
    case 'DIGITDIFF':
      return contractType === 'DIGITMATCH' ? 0.1 : 0.9;
    case 'DIGITOVER': {
      const b = barrier ?? 0;
      return Math.max(0, 9 - b) / 10; // digits strictly greater than b
    }
    case 'DIGITUNDER': {
      const b = barrier ?? 9;
      return Math.max(0, b) / 10; // digits strictly less than b
    }
  }
}
