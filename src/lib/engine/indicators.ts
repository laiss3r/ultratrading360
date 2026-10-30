/**
 * Technical indicators over a price series.
 *
 * Deriv Bot's "Indicators" subtab — and practically every community strategy —
 * is built from these four: SMA, EMA, RSI and Bollinger Bands. They are
 * implemented here as pure functions of a number[] so the condition evaluator,
 * the builder's live gate banner and the tests all agree on one definition.
 *
 * Conventions, chosen to match how Deriv Bot's blocks behave:
 *   - the period is a count of past ticks (Deriv's Period block is ticks-based);
 *   - a window shorter than the period yields null rather than a guess, so a
 *     condition reports "not enough data" instead of trading on a partial mean;
 *   - RSI uses Wilder's smoothing, the standard the indicator is defined by;
 *   - Bollinger's band uses the population standard deviation of the window.
 *
 * Nothing here forecasts anything. An indicator condition is a filter the user
 * chose; whether it selects profitable entries is exactly what the backtest tab
 * measures out-of-sample.
 */

/** Simple moving average of the last `period` values, or null if the window is short. */
export function sma(values: number[], period: number): number | null {
  if (!Number.isFinite(period) || period < 1) return null;
  const p = Math.floor(period);
  if (values.length < p) return null;
  const tail = values.slice(-p);
  return tail.reduce((a, v) => a + v, 0) / p;
}

/**
 * Exponential moving average, seeded with the SMA of the first `period` values
 * and smoothed with k = 2 / (period + 1). Returns the value at the last input.
 */
export function ema(values: number[], period: number): number | null {
  if (!Number.isFinite(period) || period < 1) return null;
  const p = Math.floor(period);
  if (values.length < p) return null;
  const k = 2 / (p + 1);
  let prev = values.slice(0, p).reduce((a, v) => a + v, 0) / p;
  for (let i = p; i < values.length; i++) prev = values[i] * k + prev * (1 - k);
  return prev;
}

/**
 * Relative Strength Index (0-100) with Wilder's smoothing. Needs period + 1
 * values, because the first change is not observable. All-gain windows return
 * 100 and all-loss windows 0, which is the indicator's defined behaviour at the
 * extremes rather than a division artefact.
 */
export function rsi(values: number[], period = 14): number | null {
  if (!Number.isFinite(period) || period < 1) return null;
  const p = Math.floor(period);
  if (values.length < p + 1) return null;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= p; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / p;
  let avgLoss = loss / p;
  for (let i = p + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (p - 1) + Math.max(d, 0)) / p;
    avgLoss = (avgLoss * (p - 1) + Math.max(-d, 0)) / p;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
}

/** Bollinger Bands: SMA middle line plus/minus `mult` population standard deviations. */
export function bollinger(values: number[], period: number, mult = 2): BollingerBands | null {
  const middle = sma(values, period);
  if (middle == null) return null;
  const p = Math.floor(period);
  const tail = values.slice(-p);
  const variance = tail.reduce((a, v) => a + (v - middle) * (v - middle), 0) / p;
  const sd = Math.sqrt(variance);
  return { upper: middle + mult * sd, middle, lower: middle - mult * sd };
}
