import type { ContractType } from './deriv/contracts';
import { ContractService } from './deriv/contracts';
import type { ActiveSymbol } from './deriv/types';
import type { MarketProvider, Quote } from './engine/provider';
import { createStrategy, type Strategy } from './engine/strategies';
import { type ContractRotation, validateLeg } from './engine/rotation';
import { wilsonInterval } from './stats/ci';
import type { RiskLimits } from './engine/risk';

export const CONTRACT_LABELS: Record<ContractType,string> = {DIGITEVEN:'Even',DIGITODD:'Odd',DIGITOVER:'Over',DIGITUNDER:'Under',DIGITMATCH:'Matches',DIGITDIFF:'Differs',CALL:'Rise',PUT:'Fall'};
export interface OverlordConfig {
  contractType: ContractType; barrier: number; stake: number; duration: number;
  targetProfit: number; stopLoss: number; maxTrades: number;
  martingale: boolean; multiplier: number; maxSteps: number;
  recoveryEnabled: boolean; recoveryContract: ContractType; recoveryBarrier: number;
  recoveryMode: ContractRotation['mode']; alternateTimes: number;
}
export const DEFAULT_OVERLORD: OverlordConfig = {contractType:'DIGITEVEN',barrier:4,stake:1,duration:1,targetProfit:100,stopLoss:100,maxTrades:50,martingale:false,multiplier:2.1,maxSteps:4,recoveryEnabled:false,recoveryContract:'DIGITOVER',recoveryBarrier:4,recoveryMode:'return-after-recovery',alternateTimes:1};
export function validateOverlord(c:OverlordConfig):string[] {
  const errors=validateLeg(c);
  for(const [name,value] of [['Stake',c.stake],['Target profit',c.targetProfit],['Stop loss',c.stopLoss]] as const) if(!Number.isFinite(value)||value<=0) errors.push(`${name} must be a finite positive amount.`);
  if(!Number.isInteger(c.duration)||c.duration<1||c.duration>10) errors.push('Duration must be 1–10 ticks.');
  if(!Number.isInteger(c.maxTrades)||c.maxTrades<1||c.maxTrades>10000) errors.push('Maximum entries must be 1–10,000.');
  if(c.martingale&&(!Number.isFinite(c.multiplier)||c.multiplier<=1||c.multiplier>10)) errors.push('Martingale multiplier must be greater than 1 and at most 10.');
  if(c.martingale&&(!Number.isInteger(c.maxSteps)||c.maxSteps<1||c.maxSteps>10)) errors.push('Escalation steps must be 1–10.');
  if(c.recoveryEnabled){errors.push(...validateLeg({contractType:c.recoveryContract,barrier:c.recoveryBarrier}));if(!['return-after-recovery','switch-on-loss','alternate'].includes(c.recoveryMode)) errors.push('Invalid recovery mode.');if(!Number.isInteger(c.alternateTimes)||c.alternateTimes<1||c.alternateTimes>5) errors.push('Alternation must be 1–5 settled entries per leg.');}
  return errors;
}
export function overlordStrategy(c:OverlordConfig,market:string,currency:string,limits:RiskLimits):Strategy {
  const errors=validateOverlord(c);if(errors.length)throw new Error(errors.join(' '));
  if(c.stake<limits.minStake||c.stake>limits.maxStake)throw new Error(`Stake must respect your global limits (${limits.minStake}–${limits.maxStake}).`);
  return createStrategy({name:`Overlord · ${CONTRACT_LABELS[c.contractType]}`,market,currency,contractType:c.contractType,barrier:ContractService.requiresBarrier(c.contractType)?c.barrier:undefined,duration:c.duration,durationUnit:'t',stake:c.stake,cooldownSeconds:.5,maxTrades:c.maxTrades,maxExposure:limits.maxSessionExposure,
    entry:{id:'root',op:'AND',children:[{id:'overlord-entry',kind:'always'}]},
    limits:{...limits,tradingEnabled:false,realTradingAcknowledged:false,maxSessionProfit:c.targetProfit,maxSessionLoss:c.stopLoss,maxTrades:c.maxTrades},
    progression:{kind:c.martingale?'martingale':'flat',unit:c.stake,multiplier:c.multiplier,stepLimit:c.maxSteps},
    contractRotation:c.recoveryEnabled?{mode:c.recoveryMode,recovery:{contractType:c.recoveryContract,barrier:ContractService.requiresBarrier(c.recoveryContract)?c.recoveryBarrier:undefined},alternateTimes:c.alternateTimes}:undefined,
    notes:'Continuous sequential entries after settlement/cooldown. Market ranking is descriptive, not a prediction. Recovery changes contracts; martingale changes stakes. Global risk limits always win.'});
}
export interface MarketObservation {symbol:string;name:string;sample:number;hits:number;rate:number;lower:number;upper:number;baseline:number|null;from:number;to:number;scannedAt:number}
export function observeMarket(symbol:string,name:string,quotes:Quote[],contractType:ContractType,barrier:number,duration=1):MarketObservation {
  if(validateLeg({contractType,barrier}).length)throw new Error('Invalid contract or prediction.');
  if(!Number.isInteger(duration)||duration<1||duration>10)throw new Error('Invalid scan duration.');
  if(quotes.length<100||quotes.some((q,i)=>q.symbol!==symbol||!Number.isFinite(q.price)||!Number.isInteger(q.digit)||q.digit<0||q.digit>9||!Number.isFinite(q.epoch)||(i>0&&q.epoch<quotes[i-1].epoch)))throw new Error('At least 100 valid, ordered Deriv ticks are required.');
  let hits=0,sample=0;
  // Non-overlapping duration-sized observations. No overlapping-window precision claims.
  for(let i=duration;i<quotes.length;i+=duration){
    const q=quotes[i],before=quotes[i-duration];let hit=false;
    switch(contractType){case 'DIGITEVEN':hit=q.digit%2===0;break;case 'DIGITODD':hit=q.digit%2===1;break;case 'DIGITOVER':hit=q.digit>barrier;break;case 'DIGITUNDER':hit=q.digit<barrier;break;case 'DIGITMATCH':hit=q.digit===barrier;break;case 'DIGITDIFF':hit=q.digit!==barrier;break;case 'CALL':hit=q.price>before.price;break;case 'PUT':hit=q.price<before.price;break;}
    sample++;if(hit)hits++;
  }
  const interval=wilsonInterval(hits,sample);
  const baseline=contractType==='CALL'||contractType==='PUT'?null:contractType==='DIGITOVER'?(9-barrier)/10:contractType==='DIGITUNDER'?barrier/10:contractType==='DIGITMATCH'?.1:contractType==='DIGITDIFF'?.9:.5;
  return {symbol,name,sample,hits,rate:hits/sample,lower:interval.lower,upper:interval.upper,baseline,from:quotes[0].epoch,to:quotes.at(-1)!.epoch,scannedAt:Date.now()};
}
export function eligibleMarkets(symbols:ActiveSymbol[]):ActiveSymbol[]{return symbols.filter((s)=>/^(R_\d+|1HZ\d+V)$/.test(s.underlying_symbol)&&s.exchange_is_open===1&&s.is_trading_suspended!==1);}
export async function scanMarkets(provider:MarketProvider,markets:ActiveSymbol[],contractType:ContractType,barrier:number,duration:number,signal?:AbortSignal,onProgress?:(done:number,total:number)=>void):Promise<{results:MarketObservation[];failures:string[]}>{
  const work=[...new Map(eligibleMarkets(markets).map((s)=>[s.underlying_symbol,s])).values()].slice(0,20);
  if(!work.length)throw new Error('No open volatility markets were returned by Deriv.');
  const results:MarketObservation[]=[],failures:string[]=[];let next=0,done=0;
  const abort=()=>{if(signal?.aborted)throw new Error('Market scan cancelled.');};
  async function worker(){while(next<work.length){abort();const s=work[next++];try{const history=await provider.history(s.underlying_symbol,300);abort();results.push(observeMarket(s.underlying_symbol,s.underlying_symbol_name,history,contractType,barrier,duration));}catch(e){abort();failures.push(`${s.underlying_symbol_name}: ${(e as Error).message}`);}onProgress?.(++done,work.length);}}
  await Promise.all(Array.from({length:Math.min(3,work.length)},()=>worker()));abort();
  // Reference-style contrarian ordering only. Low past occurrence does NOT make it due next.
  results.sort((a,b)=>a.rate-b.rate||a.symbol.localeCompare(b.symbol));return {results,failures};
}
