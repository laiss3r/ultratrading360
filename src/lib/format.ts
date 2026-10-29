/** Display formatting. Centralised so a number never renders inconsistently. */

export function money(n: number, currency = 'USD', digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}${currency} ${Math.abs(n).toFixed(digits)}`;
}

export function signed(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${Math.abs(n).toFixed(digits)}`;
}

export function pct(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function pValue(p: number): string {
  if (!Number.isFinite(p)) return 'n/a';
  if (p < 0.0001) return p.toExponential(2);
  return p.toFixed(4);
}

export function epoch(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString('en-GB', { hour12: false });
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour12: false });
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const MODE_LABEL: Record<string, string> = {
  simulation: 'Simulation',
  deriv_demo: 'Deriv Demo',
  deriv_real: 'Deriv Real',
};

export const SOURCE_LABEL: Record<string, string> = {
  simulation: 'SIMULATED DATA',
  deriv_live: 'DERIV LIVE',
  deriv_history: 'DERIV HISTORY',
  mixed: 'MIXED SOURCES',
  none: 'NO DATA',
};
