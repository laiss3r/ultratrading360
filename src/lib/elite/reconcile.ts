import type {ExecutionEvent} from '../engine/execution';
import type {TradeRecord} from '../engine/bot';
import type {OpenContract,AccountMode} from '../deriv/types';
import type {SettledContract} from '../engine/provider';
import {brokerNumber} from '../deriv/numbers';
/** Most recent state per run/lane. Old open events cannot override newer terminal events. */
export function pendingEliteEvents(journal:ExecutionEvent[],trades:TradeRecord[],account:string|undefined,mode:AccountMode){
 if(!account)return [];
 const latest=new Map<string,ExecutionEvent>();
 for(const e of [...journal].sort((a,b)=>b.at-a.at))if(e.tool==='elite'&&e.operationId!=='monitor'&&e.accountLoginid===account&&e.mode===mode){const k=`${e.runId}:${e.operationId}`;if(!latest.has(k))latest.set(k,e);}
 return [...latest.values()].filter(e=>e.phase!=='settled'&&(e.outcomeUnresolved||e.purchaseSubmitted||e.contractId)&&!(e.contractId&&trades.some(t=>!t.error&&t.contractId===e.contractId&&t.accountLoginid===account&&t.mode===mode)));
}
export function terminalBrokerResult(e:ExecutionEvent,c:Partial<OpenContract>):SettledContract|null{
 if(!e.contractId||c.contract_id!==e.contractId)throw Error('Broker contract identity did not match.');
 if(brokerNumber(c.is_sold)!==1&&!['won','lost','cancelled'].includes(c.status??''))return null;
 const stake=brokerNumber(c.buy_price),profit=brokerNumber(c.profit);
 if(stake===undefined||profit===undefined||stake<=0)throw Error('Broker has not reported a complete settled stake/profit.');
 return {contractId:c.contract_id,stake,profit,payout:Math.round(Math.max(0,stake+profit)*100)/100,won:profit>0,source:'deriv_live',openedAt:brokerNumber(c.date_start)===undefined?e.dateStart:brokerNumber(c.date_start)!*1000,closedAt:brokerNumber(c.date_settlement)===undefined?Date.now():brokerNumber(c.date_settlement)!*1000,entryPrice:brokerNumber(c.entry_spot??c.entry_tick),exitPrice:brokerNumber(c.exit_spot??c.exit_tick),potentialPayout:e.potentialPayout,pipSize:e.pipSize,longcode:e.longcode,buyTransactionId:c.transaction_ids?.buy===undefined?e.buyTransactionId:String(c.transaction_ids.buy),sellTransactionId:c.transaction_ids?.sell===undefined?e.sellTransactionId:String(c.transaction_ids.sell),dateExpiry:e.dateExpiry};
}
export function recoveredTrade(e:ExecutionEvent,s:SettledContract):TradeRecord{
 return {id:`reconciled:${e.accountLoginid}:${s.contractId}`,idempotencyKey:`reconciled:${e.accountLoginid}:${s.contractId}`,runId:e.runId,strategyId:e.strategyId??'elite-reconciled',strategyName:e.strategyName??'Elite Prime Pro',strategyVersion:1,accountLoginid:e.accountLoginid,symbol:e.symbol,contractType:e.contractType,barrier:e.barrier===undefined?undefined:String(e.barrier),currency:e.currency,duration:e.duration,durationUnit:e.durationUnit,contractId:s.contractId,stake:s.stake,payout:s.payout,profit:s.profit,won:s.profit>0,openedAt:s.openedAt??e.at,closedAt:s.closedAt??Date.now(),entryPrice:s.entryPrice,exitPrice:s.exitPrice,pipSize:s.pipSize,potentialPayout:s.potentialPayout,longcode:s.longcode,buyTransactionId:s.buyTransactionId,sellTransactionId:s.sellTransactionId,dateExpiry:s.dateExpiry,mode:e.mode,source:'deriv_live',riskReasons:[],gateReasons:['Reconciled read-only from the selected account’s actual terminal broker contract.']};
}
