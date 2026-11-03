import type {TradeRecord} from './engine/bot';
import type {AccountMode} from './deriv/types';
import {uniqueSessionTrades} from './engine/session-ledger';
export interface TradeFilter {account?:string;mode:AccountMode;currency?:string;period:'all'|'today'|'7d'|'30d';outcome:'all'|'wins'|'losses'|'zero'|'errors';query:string}
export function filterTradeReport(trades:TradeRecord[],filter:TradeFilter,now=Date.now()){
 const start=new Date(now);start.setUTCHours(0,0,0,0);
 const lower=filter.period==='all'?-Infinity:start.getTime()-(filter.period==='7d'?6:filter.period==='30d'?29:0)*86400000;
 const query=filter.query.trim().toLowerCase();
 return uniqueSessionTrades(trades.filter(t=>!!filter.account&&t.accountLoginid===filter.account&&t.mode===filter.mode&&(!filter.currency||t.currency===filter.currency))).filter(t=>
  t.closedAt>=lower&&t.closedAt<=now&&
  (filter.outcome==='all'||(filter.outcome==='errors'?!!t.error:!t.error&&(filter.outcome==='wins'?t.profit>0:filter.outcome==='losses'?t.profit<0:t.profit===0)))&&
  (!query||[t.symbol,t.contractType,t.strategyName,t.id,t.contractId,t.currency].join(' ').toLowerCase().includes(query)));
}
