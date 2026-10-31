import type { Quote } from '../engine/provider';
import { validateLeg, type ContractLeg } from '../engine/rotation';

/** Fixed, versioned rules, not a user-entered accuracy claim. */
export const SIGNAL_POLICY = {
  version: 1 as const, historySize: 5000, minHistory: 1200,
  minTraining: 100, minValidation: 80, minForward: 30,
  minLift: .02, minPayoutMargin: .02, maxAgeMs: 5000, maxModelAgeMs: 15*60*1000,
  // 14 binary suffixes x at most 20 markets. Fixed before looking at any data.
  adjustedZ: 3.75,
};
export interface Counts { hits: number; total: number }
interface Pattern { key: string; depth: number; training: Counts; validation: Counts }
export interface SignalEvidence {
  symbol: string; contractType: ContractLeg['contractType']; barrier?: number; duration: number;
  status: 'warming'|'waiting'|'qualified'|'stale'|'error'; reason: string;
  pattern: string; training: Counts; validation: Counts; forward: Counts;
  lower: number; upper: number; baseline: number; revision: number;
  lastTickAt: number; trainedAt: number; tickCount: number;
}
const empty=():Counts=>({hits:0,total:0});
export function interval(c:Counts,z=SIGNAL_POLICY.adjustedZ):[number,number]{
  if(!c.total)return [0,1];const p=c.hits/c.total,zz=z*z,den=1+zz/c.total;
  const centre=(p+zz/(2*c.total))/den,half=z*Math.sqrt(p*(1-p)/c.total+zz/(4*c.total*c.total))/den;
  return [Math.max(0,centre-half),Math.min(1,centre+half)];
}
export function contractOutcome(leg:ContractLeg,anchor:Quote,end:Quote):boolean{
  switch(leg.contractType){
    case 'DIGITEVEN':return end.digit%2===0;case 'DIGITODD':return end.digit%2===1;
    case 'DIGITOVER':return end.digit>leg.barrier!;case 'DIGITUNDER':return end.digit<leg.barrier!;
    case 'DIGITMATCH':return end.digit===leg.barrier;case 'DIGITDIFF':return end.digit!==leg.barrier;
    case 'CALL':return end.price>anchor.price;case 'PUT':return end.price<anchor.price;
  }
}
export function baseline(leg:ContractLeg):number{
  switch(leg.contractType){case 'DIGITOVER':return (9-leg.barrier!)/10;case 'DIGITUNDER':return leg.barrier!/10;case 'DIGITMATCH':return .1;case 'DIGITDIFF':return .9;default:return .5;}
}
function valid(q:Quote,symbol:string){return q.symbol===symbol&&Number.isFinite(q.price)&&Number.isInteger(q.digit)&&q.digit>=0&&q.digit<10&&Number.isFinite(q.epoch)&&Number.isInteger(q.pipSize)&&q.pipSize>=0&&q.pipSize<=10;}
function context(quotes:Quote[],i:number,depth:number,leg:ContractLeg):string{
  let out='';for(let j=i-depth+1;j<=i;j++)out+=contractOutcome(leg,quotes[j-1],quotes[j])?'1':'0';return out;
}
/**
 * Train-only pattern selection; chronological held-out validation; then NEW live
 * labels, matured only after the requested duration. No future tick is a feature.
 * Labels use non-overlapping duration windows; adjacent features can be dependent.
 */
export class PatternTracker {
  private quotes:Quote[]=[];
  private patterns:Pattern[]=[];
  private forward=new Map<string,Counts>();
  private forwardResults=new Map<string,boolean[]>();
  private pending:{remaining:number;anchor:Quote;entry?:Quote;keys:string[]}[]=[];
  private forwardClock=0;
  private trainedAt=0;
  private revision=0;
  private lastLiveAt=0;
  private failure='';
  private get horizon(){return this.duration+(['CALL','PUT'].includes(this.leg.contractType)?1:0);}
  constructor(readonly symbol:string,readonly leg:ContractLeg,readonly duration:number,history:Quote[],now=Date.now()){
    if(validateLeg(leg).length||!Number.isInteger(duration)||duration<1||duration>10)throw new Error('Invalid signal contract, prediction or tick duration.');
    if(history.some((q,i)=>!valid(q,symbol)||(i>0&&q.epoch<history[i-1].epoch)))throw new Error('Signal history must contain valid, ordered ticks for this market.');
    const last=history.at(-1);if(last&&(last.epoch*1000>now+2000||now-last.epoch*1000>SIGNAL_POLICY.maxAgeMs))throw new Error('Historical seed is stale or future-dated; refresh market history.');
    this.quotes=history.slice(-SIGNAL_POLICY.historySize);this.fit(now);
  }
  private fit(now:number){
    this.patterns=[];this.forward.clear();this.forwardResults.clear();this.pending=[];this.forwardClock=0;
    if(this.quotes.length<SIGNAL_POLICY.minHistory)return;
    const cut=Math.floor(this.quotes.length*.6);
    for(let depth=1;depth<=3;depth++)for(let bits=0;bits<2**depth;bits++){
      const key=bits.toString(2).padStart(depth,'0');const training=empty(),validation=empty();
      // Fit and validate on disjoint chronological blocks with a feature/duration gap.
      for(const [start,end,counts] of [[3,cut,training],[cut+3,this.quotes.length,validation]] as const){
        for(let i=start;i+this.horizon<end;i+=this.horizon){
          if(context(this.quotes,i,depth,this.leg)!==key)continue;
          counts.total++;if(contractOutcome(this.leg,this.quotes[i+(this.horizon>this.duration?1:0)],this.quotes[i+this.horizon]))counts.hits++;
        }
      }
      this.patterns.push({key,depth,training,validation});
    }
    this.forwardClock=this.quotes.length-3;
    this.trainedAt=now;
  }
  ingest(q:Quote,now=Date.now()):boolean{
    const last=this.quotes.at(-1);
    if(!valid(q,this.symbol)||q.source!=='deriv_live'||q.epoch*1000>now+2000||now-q.epoch*1000>SIGNAL_POLICY.maxAgeMs){this.failure='Invalid, stale or future-dated live tick; no entry.';return false;}
    if(last&&q.epoch<last.epoch){this.failure='Out-of-order tick; waiting for an ordered live update.';return false;}
    if(last&&q.epoch===last.epoch&&q.price===last.price)return false;
    if(last){
      const gaps=this.quotes.slice(-80).map((x,i,a)=>i?x.epoch-a[i-1].epoch:0).filter((x)=>x>0).sort((a,b)=>a-b);
      const expected=gaps[Math.floor(gaps.length/2)]??1;
      if(q.epoch-last.epoch>expected*1.5){this.quotes=[q];this.patterns=[];this.forward.clear();this.forwardResults.clear();this.pending=[];this.trainedAt=0;this.lastLiveAt=q.epoch*1000;this.revision++;this.failure='Stream gap: restart scan to reseed, or wait for a new contiguous sample.';return false;}
    }
    this.failure='';this.quotes.push(q);if(this.quotes.length>SIGNAL_POLICY.historySize+this.duration+4)this.quotes.shift();
    this.lastLiveAt=q.epoch*1000;this.revision++;
    if(!this.patterns.length||now-this.trainedAt>SIGNAL_POLICY.maxModelAgeMs){this.fit(now);return true;}
    for(const item of this.pending){
      if(!item.entry)item.entry=q;
      item.remaining--;if(item.remaining===0){const hit=contractOutcome(this.leg,this.horizon>this.duration?item.entry:item.anchor,q);for(const key of item.keys){const results=this.forwardResults.get(key)??[];results.push(hit);if(results.length>300)results.shift();this.forwardResults.set(key,results);this.forward.set(key,{total:results.length,hits:results.filter(Boolean).length});}}
    }
    this.pending=this.pending.filter((p)=>p.remaining>0);
    if(this.forwardClock++%this.horizon===0){const i=this.quotes.length-1;this.pending.push({remaining:this.horizon,anchor:q,keys:[1,2,3].map((d)=>context(this.quotes,i,d,this.leg))});}
    return true;
  }
  snapshot(now=Date.now()):SignalEvidence{
    const result:SignalEvidence={symbol:this.symbol,contractType:this.leg.contractType,barrier:this.leg.barrier,duration:this.duration,status:'warming',reason:'Collecting sufficient historical and new live evidence.',pattern:'—',training:empty(),validation:empty(),forward:empty(),lower:0,upper:1,baseline:baseline(this.leg),revision:this.revision,lastTickAt:this.lastLiveAt,trainedAt:this.trainedAt,tickCount:this.quotes.length};
    if(this.failure)return {...result,status:'stale',reason:this.failure};
    if(!this.lastLiveAt||now-this.lastLiveAt>SIGNAL_POLICY.maxAgeMs)return {...result,status:'stale',reason:'Waiting for a fresh live tick (maximum age 5 seconds).'};
    if(!this.patterns.length)return {...result,reason:'Collecting at least 1,200 contiguous ordered ticks; restart scan to reseed sooner.'};
    if(now-this.trainedAt>SIGNAL_POLICY.maxModelAgeMs)return {...result,status:'stale',reason:'Model expired; waiting to refit on the next live tick.'};
    const i=this.quotes.length-1;
    // Select depth using TRAINING ONLY, never by the validation/forward score.
    const candidates=this.patterns.filter((p)=>p.key===context(this.quotes,i,p.depth,this.leg)&&p.training.total>=SIGNAL_POLICY.minTraining).sort((a,b)=>interval(b.training)[0]-interval(a.training)[0]||a.depth-b.depth);
    const p=candidates[0];if(!p)return {...result,reason:'No current suffix has 100 training observations.'};
    const live=this.forward.get(p.key)??empty();
    const lo=Math.min(interval(p.training)[0],interval(p.validation)[0],interval(live)[0]);
    const hi=Math.max(interval(p.validation)[1],interval(live)[1]);
    Object.assign(result,{pattern:p.key,training:{...p.training},validation:{...p.validation},forward:{...live},lower:lo,upper:hi});
    if(p.validation.total<SIGNAL_POLICY.minValidation)return {...result,reason:'Need 80 held-out observations for this pattern.'};
    if(live.total<SIGNAL_POLICY.minForward)return {...result,reason:`Forward validation: ${live.total} / ${SIGNAL_POLICY.minForward} new live outcomes for this pattern.`};
    if(lo<=result.baseline+SIGNAL_POLICY.minLift)return {...result,status:'waiting',reason:'No qualified signal: conservative evidence does not beat the contract baseline by 2 percentage points.'};
    return {...result,status:'qualified',reason:'Pattern qualifies under fixed validation rules. Broker payout and freshness must still pass before buy.'};
  }
}
export function payoutCheck(e:SignalEvidence,ask:number,payout:number):{allowed:boolean;reason:string}{
  if(e.status!=='qualified')return {allowed:false,reason:e.reason};
  if(!Number.isFinite(ask)||ask<=0||!Number.isFinite(payout)||payout<=ask)return {allowed:false,reason:'Invalid or non-profitable broker payout.'};
  const margin=e.lower*payout/ask-1;
  return {allowed:margin>=SIGNAL_POLICY.minPayoutMargin,reason:`Conservative payout margin ${(margin*100).toFixed(1)}%; at least 2% required. This is a model check, not guaranteed return.`};
}
