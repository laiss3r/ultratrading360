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
  contract_id: number;
  buy_price: number;
  payout: number;
  profit: number;
  is_sold: 0 | 1;
  is_expired: 0 | 1;
  is_valid_to_sell: 0 | 1;
  status: 'open' | 'sold' | 'won' | 'lost';
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

export interface AuthorizeResult {
  account_list?: AccountInfo[];
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

export type AccountMode = 'simulation' | 'deriv_demo' | 'deriv_real';

export interface AuthSession {
  kind: 'oauth' | 'pat';
  loginid: string;
  currency: string;
  balance: number;
  isVirtual: boolean;
  scopes: string[];
  expiresAt: number | null;
}
