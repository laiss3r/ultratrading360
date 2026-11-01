import type {ActiveSymbol,ContractSpec} from '../deriv/types';
import type {Quote} from '../engine/provider';
import {lastDigit,theoreticalDigitProbability} from '../deriv/digits';
import {wilsonInterval} from '../stats/ci';

// One actual API page per market instead of six paged 5,000-tick seed requests.
// This is descriptive discovery, NOT the bot's training/forward-validation policy.
export const DISCOVERY_POLICY={ticks:1000,minTicks:200,cacheMs:60000,concurrency:4,deadlineMs:45000} as const;
export const DIGIT_FAMILIES=['DIGITEVEN','DIGITODD','DIGITOVER','DIGITUNDER'] as const;
export type DigitFamily=typeof DIGIT_FAMILIES[number];
export type DiscoverySpec=ContractSpec&{last_digit_range?:number[]};
export interface Opportunity {contractType:DigitFamily;barrier?:number;hits:number;sample:number;probability:number;baseline:number;lift:number;lower:number;upper:number}
export interface DigitAnalysis {ticks:number;sample:number;from:number;to:number;pipSize:number;digits:number[];counts:number[];opportunities:Opportunity[];best:Opportunity;duration:number}
export interface DiscoveryRow {symbol:string;name:string;phase:'queued'|'loading'|'ready'|'unavailable'|'error';loaded:number;analysis?:DigitAnalysis;fetchedAt?:number;cached?:boolean;error?:string;specs?:DiscoverySpec[]}
export interface DiscoveryProvider {
 connect():Promise<void>;disconnect():void;
 activeSymbols(filter?:string):Promise<ActiveSymbol[]>;
 history(symbol:string,count:number,signal?:AbortSignal,onProgress?:(loaded:number,total:number)=>void):Promise<Quote[]>;
 contractsFor(symbol:string):Promise<DiscoverySpec[]>;
}
/** API names define the family; symbol fallbacks cover legacy and S-suffixed listings.
 * Keep closed/suspended listings visible instead of silently excluding them. No cap. */
export function volatilityMarkets(symbols:ActiveSymbol[]):ActiveSymbol[]{
 return [...new Map(symbols.filter(s=>typeof s.underlying_symbol==='string'&&typeof s.underlying_symbol_name==='string'&&s.underlying_symbol_name.trim()&&(/volatility/i.test(s.underlying_symbol_name)||/^(?:R_\d+S?|1HZ\d+VS?)$/i.test(s.underlying_symbol))).map(s=>[s.underlying_symbol,s])).values()].sort((a,b)=>a.underlying_symbol_name.localeCompare(b.underlying_symbol_name,undefined,{numeric:true}));
}
export const isAvailable=(s:ActiveSymbol)=>s.exchange_is_open===1&&s.is_trading_suspended!==1;
export function rankOpportunities(a:Opportunity,b:Opportunity){return b.probability-a.probability||b.lift-a.lift||a.contractType.localeCompare(b.contractType)||(a.barrier??-1)-(b.barrier??-1);}
function tickDuration(value:string|undefined,fallback:number){if(value===undefined)return fallback;const m=/^(\d+)t$/.exec(value);return m?Number(m[1]):NaN;}
export function analyzeDigits(symbol:string,quotes:Quote[],specs:DiscoverySpec[],duration=1):DigitAnalysis{
 if(!Number.isInteger(duration)||duration<1||duration>10)throw new Error('Discovery duration must be 1–10 ticks.');
 if(quotes.length<DISCOVERY_POLICY.minTicks)throw new Error(`Only ${quotes.length} history ticks returned; at least ${DISCOVERY_POLICY.minTicks} required.`);
 const pipSize=quotes[0].pipSize;
 const digits=quotes.map((q,i)=>{
  if(q.symbol!==symbol||q.source!=='deriv_history'||!Number.isFinite(q.epoch)||q.epoch<=0||(i>0&&q.epoch<quotes[i-1].epoch)||q.pipSize!==pipSize)throw new Error('Invalid, mixed-precision or unordered historical ticks.');
  return lastDigit(q.price,q.pipSize); // Re-derive from the actual quote at API precision.
 });
 const counts=Array<number>(10).fill(0);let sample=0;
 // Non-overlapping duration-sized terminal observations, not overlapping evidence.
 for(let i=duration-1;i<digits.length;i+=duration){counts[digits[i]]++;sample++;}
 const opportunities:Opportunity[]=[];const seen=new Set<string>();
 for(const spec of specs){
  if(!DIGIT_FAMILIES.includes(spec.contract_type as DigitFamily)||duration<tickDuration(spec.min_contract_duration,1)||duration>tickDuration(spec.max_contract_duration,10)||Number.isNaN(tickDuration(spec.min_contract_duration,1))||Number.isNaN(tickDuration(spec.max_contract_duration,10)))continue;
  const contractType=spec.contract_type as DigitFamily;
  const barriers:(number|undefined)[]=contractType==='DIGITOVER'||contractType==='DIGITUNDER'?(spec.last_digit_range??Array.from({length:9},(_,i)=>contractType==='DIGITOVER'?i:i+1)):[undefined];
  for(const barrier of barriers){
   if(barrier!==undefined&&(!Number.isInteger(barrier)||barrier<0||barrier>9||(contractType==='DIGITOVER'&&barrier===9)||(contractType==='DIGITUNDER'&&barrier===0)))continue;
   const key=`${contractType}:${barrier}`;if(seen.has(key))continue;seen.add(key);
   const hits=counts.reduce((n,count,d)=>n+((contractType==='DIGITEVEN'?d%2===0:contractType==='DIGITODD'?d%2===1:contractType==='DIGITOVER'?d>barrier!:d<barrier!)?count:0),0);
   const probability=hits/sample,baseline=theoreticalDigitProbability(contractType,barrier),ci=wilsonInterval(hits,sample);
   opportunities.push({contractType,barrier,hits,sample,probability,baseline,lift:probability-baseline,lower:ci.lower,upper:ci.upper});
  }
 }
 if(!opportunities.length)throw new Error('Deriv lists no supported Even, Odd, Over or Under contracts for this duration.');
 opportunities.sort(rankOpportunities);
 return {ticks:quotes.length,sample,from:quotes[0].epoch,to:quotes.at(-1)!.epoch,pipSize,digits:digits.slice(-16),counts,opportunities,best:opportunities[0],duration};
}
function bounded<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;let cancel=()=>{};
 const stop=new Promise<never>((_,reject)=>{cancel=()=>reject(new Error('Discovery cancelled.'));signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();timer=setTimeout(()=>reject(new Error('Market discovery request timed out.')),DISCOVERY_POLICY.deadlineMs);});
 return Promise.race([promise,stop]).finally(()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);});
}
interface CacheEntry {quotes:Quote[];specs:DiscoverySpec[];fetchedAt:number}
/** Dedicated public, historical-only discovery. Never opens a tick subscription or buys. */
export class HistoricalDiscovery {
 private cache=new Map<string,CacheEntry>();
 constructor(private provider:DiscoveryProvider){}
 async scan(duration:number,options:{signal:AbortSignal;force?:boolean;onMarkets?:(markets:ActiveSymbol[])=>void;onUpdate:(rows:DiscoveryRow[])=>void}):Promise<void>{
  const {signal}=options;const abort=()=>{if(signal.aborted)throw new Error('Discovery cancelled.');};
  abort();await bounded(this.provider.connect(),signal);abort();
  const markets=volatilityMarkets(await bounded(this.provider.activeSymbols('all'),signal));abort();
  if(!markets.length)throw new Error('Deriv returned no Volatility markets. Retry market discovery.');
  options.onMarkets?.(markets);
  const rows:DiscoveryRow[]=markets.map(m=>({symbol:m.underlying_symbol,name:m.underlying_symbol_name,phase:isAvailable(m)?'queued':'unavailable',loaded:0,...(!isAvailable(m)?{error:m.is_trading_suspended===1?'Trading suspended by Deriv.':'Market closed at Deriv.'}:{})}));
  const emit=()=>{if(!signal.aborted)options.onUpdate(rows.map(r=>({...r})));};emit();let next=0;
  const worker=async()=>{while(next<rows.length){abort();const row=rows[next++];if(row.phase==='unavailable')continue;
   const cached=this.cache.get(row.symbol);
   if(!options.force&&cached&&Date.now()-cached.fetchedAt<DISCOVERY_POLICY.cacheMs&&Date.now()-cached.quotes.at(-1)!.epoch*1000<DISCOVERY_POLICY.cacheMs){try{row.analysis=analyzeDigits(row.symbol,cached.quotes,cached.specs,duration);row.loaded=cached.quotes.length;row.specs=cached.specs;row.phase='ready';row.cached=true;row.fetchedAt=cached.fetchedAt;}catch(error){row.phase='error';row.error=(error as Error).message;}emit();continue;}
   row.phase='loading';emit();const controller=new AbortController();const cancel=()=>controller.abort();signal.addEventListener('abort',cancel,{once:true});let timer:ReturnType<typeof setTimeout>|undefined;let rejectAbort=()=>{};
   const deadline=new Promise<never>((_,reject)=>{rejectAbort=()=>reject(new Error(signal.aborted?'Discovery cancelled.':'Market history exceeded its 45-second deadline.'));controller.signal.addEventListener('abort',rejectAbort,{once:true});timer=setTimeout(()=>controller.abort(),DISCOVERY_POLICY.deadlineMs);});
   try{
    // Queue all markets immediately with bounded workers; shared history pacing is preserved.
    const [quotes,specs]=await Promise.race([deadline,Promise.all([this.provider.history(row.symbol,DISCOVERY_POLICY.ticks,controller.signal,(loaded)=>{if(signal.aborted||controller.signal.aborted)return;row.loaded=loaded;emit();}),this.provider.contractsFor(row.symbol)])]);abort();
    if(controller.signal.aborted)throw new Error('Market history cancelled.');
    const now=Date.now(),latest=quotes.at(-1)?.epoch??0;if(latest*1000>now+2000||now-latest*1000>DISCOVERY_POLICY.cacheMs)throw new Error('Broker history is stale or future-dated; retry this market.');
    const analysis=analyzeDigits(row.symbol,quotes,specs,duration);const entry={quotes,specs,fetchedAt:now};this.cache.set(row.symbol,entry);
    row.analysis=analysis;row.specs=specs;row.phase='ready';row.loaded=quotes.length;row.fetchedAt=now;row.cached=false;
   }catch(error){abort();row.phase='error';row.error=(error as Error).message;}
   finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',rejectAbort);}
   emit();
  }};
  await Promise.all(Array.from({length:Math.min(DISCOVERY_POLICY.concurrency,rows.length)},()=>worker()));abort();
 }
 close(){this.provider.disconnect();}
}
