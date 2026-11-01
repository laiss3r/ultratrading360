import type {ExecutionEvent} from '../engine/execution';
import type {TradeRecord} from '../engine/bot';
const KEY='ut_elite_receipt_checkpoint_v1';
interface Checkpoint {events:ExecutionEvent[];trades:TradeRecord[]}
/** A small synchronous receipt WAL bridges the interval before IndexedDB commits. Never contains credentials. */
export function loadEliteCheckpoint():Checkpoint{
 if(typeof localStorage==='undefined')return {events:[],trades:[]};
 try{const parsed=JSON.parse(localStorage.getItem(KEY)??'{}');return {events:Array.isArray(parsed.events)?parsed.events.filter((e:ExecutionEvent)=>e.tool==='elite'&&typeof e.runId==='string'&&typeof e.at==='number'):[],trades:Array.isArray(parsed.trades)?parsed.trades.filter((t:TradeRecord)=>t.source==='deriv_live'&&typeof t.runId==='string'&&t.runId.startsWith('elite_')&&Number.isFinite(t.profit)):[]};}catch{return {events:[],trades:[]};}
}
export function checkpointEliteEvent(event:ExecutionEvent){
 if(typeof localStorage==='undefined')return;
 const data=loadEliteCheckpoint(),same=(e:ExecutionEvent)=>e.runId===event.runId&&e.operationId===event.operationId&&e.accountLoginid===event.accountLoginid&&e.mode===event.mode;
 data.events=[event,...data.events.filter(e=>!same(e))];
 const pending=data.events.filter(e=>e.phase!=='settled'&&(e.contractId||e.purchaseSubmitted||e.outcomeUnresolved)),closed=data.events.filter(e=>!pending.includes(e)).slice(0,500);
 data.events=[...pending,...closed];localStorage.setItem(KEY,JSON.stringify(data));
}
export function checkpointEliteTrade(trade:TradeRecord){if(typeof localStorage==='undefined')return;const data=loadEliteCheckpoint();data.trades=[trade,...data.trades.filter(t=>t.id!==trade.id)].slice(0,100);localStorage.setItem(KEY,JSON.stringify(data));}
export function clearEliteCheckpoint(){if(typeof localStorage==='undefined')return;const data=loadEliteCheckpoint();const events=data.events.filter(e=>e.phase!=='settled'&&(e.contractId||e.purchaseSubmitted||e.outcomeUnresolved));if(events.length)localStorage.setItem(KEY,JSON.stringify({events,trades:[]}));else localStorage.removeItem(KEY);}
export function mergeEliteTrades(a:TradeRecord[],b:TradeRecord[]){const map=new Map<string,TradeRecord>();for(const t of [...a,...b]){const key=t.contractId?`${t.mode}:${t.accountLoginid}:${t.contractId}`:t.id;if(!map.has(key))map.set(key,t);}return [...map.values()].sort((a,b)=>b.closedAt-a.closedAt).slice(0,5000);}
