import { get, set, del, keys } from 'idb-keyval';
import type { Strategy } from '../engine/strategies';
import type { TradeRecord } from '../engine/bot';
import type { RiskLimits, RecoveryConfig } from '../engine/risk';
import type { AccountMode } from '../deriv/types';

/**
 * Client-side persistence.
 *
 * HONEST LIMITATION: there is no server database in this deployment. Vercel's serverless
 * platform cannot host PostgreSQL, Redis or a persistent worker, and no other host was
 * provisioned. Trade history and strategies therefore live in IndexedDB, which means they
 * are per-browser and per-device: they survive refresh and restart, but they do NOT sync
 * across devices and they are lost if site data is cleared.
 *
 * The Django service under /backend implements the same schema against PostgreSQL for when
 * a real host is provisioned; the interfaces below are shaped to be swapped over without
 * changing callers.
 *
 * Tokens are NEVER written here. Credentials live only in httpOnly cookies set by the API
 * routes, which JavaScript cannot read.
 */

const PREFIX = {
  strategy: 'strategy:',
  trade: 'trade:',
  session: 'session:',
  settings: 'settings:',
} as const;

export interface AppSettings {
  mode: AccountMode;
  simulationSeed: string;
  simulationStartingBalance: number;
  limits: RiskLimits;
  recovery: RecoveryConfig;
  /** Explicit acknowledgement that real money is at risk. Never defaults to true. */
  realTradingAcknowledged: boolean;
  acknowledgedAccountLoginid: string | null;
  theme: 'dark';
}

export const DEFAULT_SETTINGS: AppSettings = {
  mode: 'simulation',
  simulationSeed: 'ultratrading360-default',
  simulationStartingBalance: 10000,
  limits: {
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
  },
  recovery: { enabled: false, multiplier: 1.5, stepLimit: 4, maxStake: 25, maxDrawdown: 100 },
  realTradingAcknowledged: false,
  acknowledgedAccountLoginid: null,
  theme: 'dark',
};

async function available(): Promise<boolean> {
  return typeof indexedDB !== 'undefined';
}

export async function saveStrategy(s: Strategy): Promise<void> {
  if (!(await available())) return;
  await set(PREFIX.strategy + s.id, s);
}

export async function listStrategies(): Promise<Strategy[]> {
  if (!(await available())) return [];
  const all = (await keys()) as string[];
  const ids = all.filter((k) => typeof k === 'string' && k.startsWith(PREFIX.strategy));
  const out = (await Promise.all(ids.map((k) => get<Strategy>(k)))).filter(Boolean) as Strategy[];
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getStrategy(id: string): Promise<Strategy | undefined> {
  if (!(await available())) return undefined;
  return get<Strategy>(PREFIX.strategy + id);
}

export async function deleteStrategy(id: string): Promise<void> {
  if (!(await available())) return;
  await del(PREFIX.strategy + id);
}

export async function appendTrades(trades: TradeRecord[]): Promise<void> {
  if (!(await available()) || trades.length === 0) return;
  await Promise.all(trades.map((t) => set(PREFIX.trade + t.id, t)));
}

export async function listTrades(limit = 2000): Promise<TradeRecord[]> {
  if (!(await available())) return [];
  const all = (await keys()) as string[];
  const ids = all.filter((k) => typeof k === 'string' && k.startsWith(PREFIX.trade));
  const out = (await Promise.all(ids.map((k) => get<TradeRecord>(k)))).filter(Boolean) as TradeRecord[];
  out.sort((a, b) => b.closedAt - a.closedAt);
  return out.slice(0, limit);
}

export async function clearTrades(): Promise<void> {
  if (!(await available())) return;
  const all = (await keys()) as string[];
  await Promise.all(all.filter((k) => typeof k === 'string' && k.startsWith(PREFIX.trade)).map((k) => del(k)));
}

export async function loadSettings(): Promise<AppSettings> {
  if (!(await available())) return { ...DEFAULT_SETTINGS };
  const stored = await get<Partial<AppSettings>>(PREFIX.settings + 'app');
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function saveSettings(s: AppSettings): Promise<void> {
  if (!(await available())) return;
  await set(PREFIX.settings + 'app', s);
}
