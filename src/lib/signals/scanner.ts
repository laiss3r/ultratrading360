import type { MarketProvider } from '../engine/provider';
import type { ContractLeg } from '../engine/rotation';
import type { ActiveSymbol } from '../deriv/types';
import { PatternTracker, SIGNAL_POLICY, type SignalEvidence } from './patterns';
export interface WatchedSignal { symbol:string; name:string; phase:'loading'|'watching'|'error'; evidence?:SignalEvidence; error?:string }
/** Owns every subscription, including ones that finish opening after cancellation. */
export function watchSignals(provider:MarketProvider,markets:ActiveSymbol[],leg:ContractLeg,duration:number,onUpdate:(rows:WatchedSignal[])=>void):()=>void{
  const work=[...new Map(markets.map((s)=>[s.underlying_symbol,s])).values()].slice(0,20);
  const rows:WatchedSignal[]=work.map((m)=>({symbol:m.underlying_symbol,name:m.underlying_symbol_name,phase:'loading'}));
  const trackers=new Map<string,PatternTracker>(),disposers:(()=>void)[]=[];let stopped=false,next=0;
  const emit=()=>{if(!stopped)onUpdate(rows.map((r)=>({...r,evidence:trackers.get(r.symbol)?.snapshot()??r.evidence})));};
  const clock=setInterval(emit,1000);emit();
  async function worker(){while(!stopped&&next<work.length){const index=next++,market=work[index];try{
    const hist=await provider.history(market.underlying_symbol,SIGNAL_POLICY.historySize);if(stopped)return;
    const tracker=new PatternTracker(market.underlying_symbol,leg,duration,hist);trackers.set(market.underlying_symbol,tracker);
    const dispose=await provider.stream(market.underlying_symbol,(q)=>{if(!stopped)tracker.ingest(q);});
    if(stopped){dispose();return;}disposers.push(dispose);rows[index].phase='watching';emit();
  }catch(e){if(stopped)return;rows[index].phase='error';rows[index].error=(e as Error).message;emit();}}}
  void Promise.all(Array.from({length:Math.min(3,work.length)},()=>worker()));
  return ()=>{stopped=true;clearInterval(clock);for(const dispose of disposers)dispose();trackers.clear();};
}
