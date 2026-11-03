import type {TradeRecord} from './bot';
import type {AccountMode} from '../deriv/types';
/** Separate from removable display history. No credentials; idempotent by broker contract. */
export type DailyRiskBook=Record<string,Record<string,number>>;
export const dailyRiskKey=(account:string,mode:AccountMode,currency:string,date=new Date().toISOString().slice(0,10))=>JSON.stringify([account,mode,currency,date]);
export function mergeDailyRisk(book:DailyRiskBook,trades:TradeRecord[]):DailyRiskBook{
 const out={...book},copied=new Set<string>();
 for(const t of trades){
  if(t.error||t.source!=='deriv_live'||!t.accountLoginid||!t.currency||!Number.isFinite(t.closedAt)||!Number.isFinite(t.profit))continue;
  const date=new Date(t.closedAt);if(!Number.isFinite(date.getTime()))continue;
  const key=dailyRiskKey(t.accountLoginid,t.mode,t.currency,date.toISOString().slice(0,10));
  if(!copied.has(key)){out[key]={...(book[key]??{})};copied.add(key);}
  const id=t.contractId!==undefined?`contract:${t.contractId}`:`record:${t.id}`;out[key][id]=t.profit;
 }
 return out;
}
export function dailyRiskPnl(book:DailyRiskBook,account:string|undefined,mode:AccountMode,currency:string|undefined,date=new Date().toISOString().slice(0,10)){
 if(!account||!currency)return 0;
 return Object.values(book[dailyRiskKey(account,mode,currency,date)]??{}).reduce((sum,p)=>sum+p,0);
}
export function validateDailyRiskBook(value:unknown):DailyRiskBook{
 if(value===undefined||value===null)return {};
 if(typeof value!=='object'||Array.isArray(value))throw Error('Daily risk ledger is invalid.');
 for(const [key,entries] of Object.entries(value)){
  let parts:unknown;try{parts=JSON.parse(key);}catch{throw Error('Daily risk ledger identity is invalid.');}
  if(!Array.isArray(parts)||parts.length!==4||!parts.every(x=>typeof x==='string')||!/^\d{4}-\d{2}-\d{2}$/.test(parts[3]))throw Error('Daily risk ledger identity is invalid.');
  if(!entries||typeof entries!=='object'||Array.isArray(entries)||Object.values(entries).some(p=>typeof p!=='number'||!Number.isFinite(p)))throw Error('Daily risk ledger results are invalid.');
 }
 return value as DailyRiskBook;
}
