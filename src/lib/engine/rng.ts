/**
 * Deterministic, reproducible synthetic market generator for SIMULATION MODE.
 *
 * This is NOT Deriv data and must never be presented as such. It exists so the platform is
 * fully usable — and every backtest byte-for-byte repeatable — without a Deriv account.
 *
 * Model: a pip-quantised random walk with sub-pip dither.
 *   step  = sigma * price * z          (z ~ N(0,1), Box-Muller)
 *   raw   = price + step + dither      (dither decorrelates the least-significant digit)
 *   quote = round(raw / pip) * pip
 * The dither term matters: without it the last digit of a smooth random walk is strongly
 * autocorrelated and every digit statistic downstream would be an artefact of the generator
 * rather than a property of the strategy.
 */

/** mulberry32 — small, fast, and identical across JS engines, so runs are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 32-bit hash of a string seed, so users can seed by name. */
export function hashSeed(input: string | number): number {
  if (typeof input === 'number') return input >>> 0;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Box-Muller standard normal from a uniform source. */
export function gaussianFactory(rng: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * mul;
    return u * mul;
  };
}

export interface SyntheticMarketConfig {
  symbol: string;
  startPrice: number;
  pipSize: number;
  /** Annualised volatility expressed the way Deriv labels its indices (100 = 100%). */
  volatilityPct: number;
  /** Ticks per year used to scale volatility down to a per-tick sigma. */
  ticksPerYear?: number;
  /** Seconds between ticks. */
  tickIntervalSeconds?: number;
}

export interface SyntheticTick {
  symbol: string;
  quote: number;
  epoch: number;
  pip_size: number;
}

const SECONDS_PER_YEAR = 365 * 24 * 3600;

export class SyntheticMarket {
  private rng: () => number;
  private gauss: () => number;
  private price: number;
  private epoch: number;
  private readonly pipValue: number;
  private readonly sigma: number;

  constructor(
    public readonly config: SyntheticMarketConfig,
    seed: string | number,
    startEpoch = 1_700_000_000,
  ) {
    const s = hashSeed(seed);
    this.rng = mulberry32(s);
    this.gauss = gaussianFactory(this.rng);
    this.price = config.startPrice;
    this.epoch = startEpoch;
    this.pipValue = Math.pow(10, -config.pipSize);
    const interval = config.tickIntervalSeconds ?? 2;
    const tpy = config.ticksPerYear ?? SECONDS_PER_YEAR / interval;
    this.sigma = config.volatilityPct / 100 / Math.sqrt(tpy);
  }

  /** Advance one tick and return it. Purely deterministic for a given (config, seed). */
  next(): SyntheticTick {
    const z = this.gauss();
    const step = this.sigma * this.price * z;
    const dither = (this.rng() - 0.5) * this.pipValue;
    const raw = this.price + step + dither;
    const quote = Math.round(raw / this.pipValue) * this.pipValue;
    this.price = quote > 0 ? quote : this.pipValue;
    this.epoch += this.config.tickIntervalSeconds ?? 2;
    return {
      symbol: this.config.symbol,
      quote: Number(this.price.toFixed(this.config.pipSize)),
      epoch: this.epoch,
      pip_size: this.config.pipSize,
    };
  }

  /** Generate `count` ticks. */
  series(count: number): SyntheticTick[] {
    const out: SyntheticTick[] = [];
    for (let i = 0; i < count; i++) out.push(this.next());
    return out;
  }

  currentPrice(): number {
    return Number(this.price.toFixed(this.config.pipSize));
  }
}

/**
 * Presets mirroring Deriv's synthetic index family. The starting prices and volatilities are
 * representative, not broker data — simulation results are labelled SIMULATED everywhere.
 */
export const SYNTHETIC_PRESETS: Record<string, SyntheticMarketConfig> = {
  R_10: { symbol: 'R_10', startPrice: 6000, pipSize: 3, volatilityPct: 10 },
  R_25: { symbol: 'R_25', startPrice: 300000, pipSize: 3, volatilityPct: 25 },
  R_50: { symbol: 'R_50', startPrice: 250, pipSize: 4, volatilityPct: 50 },
  R_75: { symbol: 'R_75', startPrice: 90000, pipSize: 4, volatilityPct: 75 },
  R_100: { symbol: 'R_100', startPrice: 570, pipSize: 2, volatilityPct: 100 },
  '1HZ10V': { symbol: '1HZ10V', startPrice: 6000, pipSize: 3, volatilityPct: 10, tickIntervalSeconds: 1 },
  '1HZ25V': { symbol: '1HZ25V', startPrice: 300000, pipSize: 3, volatilityPct: 25, tickIntervalSeconds: 1 },
  '1HZ50V': { symbol: '1HZ50V', startPrice: 250, pipSize: 4, volatilityPct: 50, tickIntervalSeconds: 1 },
  '1HZ75V': { symbol: '1HZ75V', startPrice: 90000, pipSize: 4, volatilityPct: 75, tickIntervalSeconds: 1 },
  '1HZ100V': { symbol: '1HZ100V', startPrice: 1170, pipSize: 2, volatilityPct: 100, tickIntervalSeconds: 1 },
};

/** Deriv's own display names for these instruments, so the labels are not invented. */
export const SYNTHETIC_DISPLAY_NAMES: Record<string, string> = {
  R_10: 'Volatility 10 Index',
  R_25: 'Volatility 25 Index',
  R_50: 'Volatility 50 Index',
  R_75: 'Volatility 75 Index',
  R_100: 'Volatility 100 Index',
  '1HZ10V': 'Volatility 10 (1s) Index',
  '1HZ25V': 'Volatility 25 (1s) Index',
  '1HZ50V': 'Volatility 50 (1s) Index',
  '1HZ75V': 'Volatility 75 (1s) Index',
  '1HZ100V': 'Volatility 100 (1s) Index',
};

/**
 * The instruments the simulator can actually produce, with the precision each one
 * uses for digit extraction.
 *
 * The simulator has no market list of its own — Deriv's `active_symbols` needs no
 * credentials, but the offline feed deliberately makes no network calls at all. So
 * when nothing live is connected, the UI offers exactly this catalogue and nothing
 * more: offering a symbol the simulator cannot price would be a lie about what a
 * strategy trades.
 */
export const SIMULATOR_CATALOGUE = Object.keys(SYNTHETIC_PRESETS).map((symbol) => ({
  symbol,
  name: SYNTHETIC_DISPLAY_NAMES[symbol] ?? symbol,
  pipSize: SYNTHETIC_PRESETS[symbol].pipSize,
  cadence: (SYNTHETIC_PRESETS[symbol].tickIntervalSeconds ?? 2) <= 1 ? ('fast' as const) : ('normal' as const),
  open: true,
}));

export function presetFor(symbol: string): SyntheticMarketConfig {
  return (
    SYNTHETIC_PRESETS[symbol] ?? {
      symbol,
      startPrice: 1000,
      pipSize: 2,
      volatilityPct: 50,
    }
  );
}
