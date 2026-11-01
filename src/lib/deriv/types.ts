/** Message types for the CURRENT Deriv API (verified live 2026-10-29). */

export interface ActiveSymbol {
  underlying_symbol: string;
  underlying_symbol_name: string;
  market: string;
  submarket: string;
  subgroup?: string;
  pip_size: number;
  exchange_is_open: 0 | 1;
  is_trading_suspended: 0 | 1;
  trade_count?: number;
  delay_amount?: number;
}

export interface Tick {
  symbol: string;
  quote: number;
  epoch: number;
  pip_size: number;
  ask?: number;
  bid?: number;
  id?: string;
}

export interface TickHistoryResponse {
  history: { prices: number[]; times: number[] };
  pip_size: number;
  echo_req: Record<string, unknown>;
}

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  epoch: number;
}

export interface ContractSpec {
  contract_type: string;
  contract_category: string;
  contract_display: string;
  barriers?: number;
  expiry_type?: string;
  min_contract_duration?: string;
  max_contract_duration?: string;
  default_stake?: number;
  sentiment?: string;
}

export interface Proposal {
  id: string;
  ask_price: number;
  payout: number;
  spot: number;
  spot_value: string;
  date_start: number;
  date_expiry: number;
  longcode: string;
  contract_details?: { barrier?: string };
}

export interface OpenContract {
  entry_spot?:number|string;exit_spot?:number|string;
  tick_count?: number;
  tick_stream?: unknown[];
  bid_price?: number;
  date_settlement?: number;
  contract_id: number;
  buy_price: number;
  payout: number;
  profit: number;
  is_sold: 0 | 1;
  is_expired: 0 | 1;
  is_valid_to_sell: 0 | 1;
  status: 'open' | 'sold' | 'won' | 'lost' | 'cancelled';
  currency: string;
  contract_type: string;
  underlying_symbol?: string;
  date_start: number;
  date_expiry: number;
  entry_tick?: number;
  exit_tick?: number;
  current_spot?: number;
  transaction_ids?: { buy?: string; sell?: string };
}

/** One row of an authorize response's account_list. Deriv echoes `loginid`
 * here (not `account_loginid`, which is the REST accounts listing's field), so
 * the mapper accepts both. */
export interface AuthorizeAccountEntry {
  loginid?: string;
  account_loginid?: string;
  account_type?: string;
  currency?: string;
  balance?: number;
  is_virtual?: 0 | 1;
}

export interface AuthorizeResult {
  account_list?: AuthorizeAccountEntry[];
  account_loginid?: string;
  scope?: string;
  balance?: number;
  currency?: string;
  loginid?: string;
  scopes?: string[];
  is_virtual?: 0 | 1;
  email?: string;
  country?: string;
  fullname?: string;
}

export interface AccountInfo {
  account_loginid: string;
  account_type?: string;
  currency: string;
  balance?: number;
  is_virtual?: 0 | 1;
  loginid?: string;
  token?: string;
}

/** Any inbound frame. */
export interface DerivMessage {
  msg_type: string;
  req_id?: number;
  echo_req?: Record<string, unknown> & { req_id?: number };
  subscription?: { id: string };
  error?: { code: string; message: string; details?: unknown };
  [key: string]: unknown;
}

/**
 * There is no simulation mode. This is a Deriv third-party tool: market data comes from
 * Deriv's public socket without credentials, and trading happens on a connected demo or
 * real account. A fake feed would misrepresent what a strategy actually does.
 */
export type AccountMode = 'deriv_demo' | 'deriv_real';

export interface AuthSession {
  accountDiagnostics?: import('./accountDiagnostics').AccountDiagnostics;
  balanceKnown?: boolean;
  kind: 'oauth' | 'pat';
  loginid: string;
  currency: string;
  balance: number;
  isVirtual: boolean;
  scopes: string[];
  expiresAt: number | null;
  /**
   * True when the credential authenticated but the Deriv profile holds no
   * Options trading account on the new platform yet (classic CR/VRTC loginids
   * are not Options accounts and never appear in the new REST listing). The
   * UI then offers a one-click demo Options account creation; real Options
   * accounts are never created automatically.
   */
  needsOptionsAccount?: boolean;
  /** Account rows the switcher shows (created Options row and/or adopted classic rows). */
  accountRows?: AccountInfo[];
  /** Which Deriv path produced the account rows: new REST listing or legacy socket authorize. */
  accountsSource?: 'options_rest' | 'classic_ws' | 'classic_browser';
}
