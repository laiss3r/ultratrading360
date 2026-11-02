import type {TradeRecord} from './bot';
import type {ExecutionEvent} from './execution';
const identity=(t:TradeRecord)=>t.contractId!==undefined?`${t.accountLoginid}:${t.mode}:${t.contractId}`:t.id;
/** One broker contract contributes once, even when IndexedDB/checkpoint/reconciliation overlap. */
export function uniqueSessionTrades(trades:TradeRecord[]):TradeRecord[]{
 const byContract=new Map<string,TradeRecord>();
 for(const t of trades){const key=identity(t),previous=byContract.get(key);if(!previous||(previous.error&&!t.error))byContract.set(key,t);}
 return [...byContract.values()].sort((a,b)=>b.closedAt-a.closedAt||b.id.localeCompare(a.id));
}
/** Financial journal rows come from the same actual terminal ledger as totals/transactions.
 * Lifecycle logs may be capped, delayed or absent after refresh; they are not a second P/L ledger. */
export function sessionSettlementEvents(trades:TradeRecord[],activity:ExecutionEvent[]):ExecutionEvent[]{
 return uniqueSessionTrades(trades).filter(t=>!t.error).map(t=>{
  const event=activity.find(e=>e.phase==='settled'&&e.contractId===t.contractId&&e.runId===t.runId&&e.accountLoginid===t.accountLoginid&&e.mode===t.mode);
  return {...event,id:`ledger:${t.id}`,runId:t.runId??event?.runId??'',at:t.closedAt,phase:'settled',detail:event?.detail??`Broker contract ${t.contractId??t.id} settled: ${t.profit>0?'profit':t.profit<0?'loss':'zero net'} ${t.profit.toFixed(2)} ${t.currency??''}.`,accountLoginid:t.accountLoginid,mode:t.mode,currency:t.currency??event?.currency??'',symbol:t.symbol,contractType:t.contractType as ExecutionEvent['contractType'],duration:t.duration??event?.duration??0,durationUnit:t.durationUnit??event?.durationUnit??'',contractId:t.contractId,strategyId:t.strategyId,strategyName:t.strategyName,stake:t.stake,potentialPayout:t.potentialPayout,profit:t.profit,contractValue:t.payout,entryPrice:t.entryPrice,exitPrice:t.exitPrice,...(t.timing?{timing:t.timing}:{})};
 });
}
export function sessionJournal(trades:TradeRecord[],activity:ExecutionEvent[]){
 const results=sessionSettlementEvents(trades,activity);
 const other=activity.filter(e=>e.phase!=='settled'||(e.profit===undefined&&!results.some(r=>r.contractId!==undefined&&r.contractId===e.contractId&&r.runId===e.runId&&r.accountLoginid===e.accountLoginid&&r.mode===e.mode)));
 return {results,events:[...results,...other].sort((a,b)=>b.at-a.at)};
}
