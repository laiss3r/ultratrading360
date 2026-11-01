import type { MarketProvider, Quote } from '../engine/provider';
import type { ContractLeg } from '../engine/rotation';
import type { ActiveSymbol } from '../deriv/types';
import { PatternTracker, SIGNAL_POLICY, type SignalEvidence } from './patterns';
export interface WatchedSignal {
  symbol:string; name:string; phase:'queued'|'connecting'|'loading'|'watching'|'retrying';
  evidence?:SignalEvidence; error?:string; historyLoaded:number; historyTarget:number;
  liveTicks:number; digits:number[]; lastQuote?:Quote; retryAt?:number;
}
interface Runtime {
  row:WatchedSignal; tracker?:PatternTracker; buffer:Quote[]; dispose?:()=>void;
  timer?:ReturnType<typeof setTimeout>; abort?:AbortController;
  opening:boolean; seeding:boolean; queued:boolean; attempts:number;
}
/** Read-only scanner. Streams open BEFORE paged history; Stop owns every late resource. */
export function watchSignals(provider:MarketProvider,markets:ActiveSymbol[],leg:ContractLeg,duration:number,onUpdate:(rows:WatchedSignal[])=>void):()=>void {
  const work=[...new Map(markets.map(m=>[m.underlying_symbol,m])).values()].slice(0,20);
  const states:Runtime[]=work.map(m=>({row:{symbol:m.underlying_symbol,name:m.underlying_symbol_name,phase:'queued',historyLoaded:0,historyTarget:SIGNAL_POLICY.historySize,liveTicks:0,digits:[]},buffer:[],opening:false,seeding:false,queued:false,attempts:0}));
  let stopped=false,opening=0,seeding=0;
  const openQueue=[...states],seedQueue:Runtime[]=[];
  const emit=()=>{
    if(stopped)return;
    const now=Date.now(),connected=provider.isConnected();
    onUpdate(states.map(s=>{
      let evidence=s.tracker?.snapshot(now);
      if(evidence&&!connected)evidence={...evidence,status:'stale',reason:'Market feed disconnected; waiting for fresh ticks and reseeding if needed.'};
      return {...s.row,digits:[...s.row.digits],evidence};
    }));
  };
  // UI batching is independent of tick ingestion. No random progress or confidence.
  const clock=setInterval(emit,250);
  const retry=(s:Runtime,error:unknown,reopen=false)=>{
    if(stopped)return;
    s.tracker=undefined;s.row.phase='retrying';s.row.error=(error as Error).message||'Market data unavailable';
    s.row.retryAt=Date.now()+Math.min(30000,2000*2**Math.min(s.attempts++,4));
    if(s.timer)clearTimeout(s.timer);
    s.timer=setTimeout(()=>{s.timer=undefined;if(stopped)return;if(reopen){openQueue.push(s);pumpOpen();}else enqueueSeed(s);},s.row.retryAt-Date.now());
    emit();
  };
  const enqueueSeed=(s:Runtime)=>{
    if(stopped||s.seeding||s.queued)return;
    s.tracker=undefined;s.queued=true;s.row.phase='queued';s.row.retryAt=undefined;
    seedQueue.push(s);pumpSeed();
  };
  const receive=(s:Runtime,q:Quote)=>{
    if(stopped)return;
    const previous=s.row.lastQuote,now=Date.now();
    if(q.symbol!==s.row.symbol||q.source!=='deriv_live'||!Number.isFinite(q.price)||!Number.isFinite(q.epoch)||q.epoch*1000>now+2000||now-q.epoch*1000>SIGNAL_POLICY.maxAgeMs||!Number.isInteger(q.digit)||q.digit<0||q.digit>9||!Number.isInteger(q.pipSize)||q.pipSize<0||q.pipSize>10)return;
    if(previous&&(q.epoch<previous.epoch||(q.epoch===previous.epoch&&q.price===previous.price)))return;
    s.row.lastQuote=q;s.row.liveTicks++;s.row.digits=[...s.row.digits,q.digit].slice(-8);
    if(!s.tracker){s.buffer.push(q);if(s.buffer.length>SIGNAL_POLICY.historySize)s.buffer.shift();return;}
    const accepted=s.tracker.ingest(q,now);
    if(!accepted&&s.tracker.snapshot(now).reason.startsWith('Stream gap:')){
      s.buffer=[q];s.row.error='Live gap detected; rebuilding history and forward evidence.';enqueueSeed(s);
    }
  };
  async function openStream(s:Runtime){
    s.opening=true;s.row.phase='connecting';emit();
    try{
      const dispose=await provider.stream(s.row.symbol,q=>receive(s,q));
      if(stopped){dispose();return;}
      s.dispose=dispose;enqueueSeed(s);
    }catch(error){retry(s,error,true);}
    finally{s.opening=false;opening--;pumpOpen();}
  }
  function pumpOpen(){while(!stopped&&opening<3&&openQueue.length){const s=openQueue.shift()!;if(s.opening||s.dispose)continue;opening++;void openStream(s);}}
  async function seed(s:Runtime){
    s.queued=false;s.seeding=true;s.row.phase='loading';s.row.historyLoaded=0;const controller=new AbortController();s.abort=controller;emit();
    let deadline:ReturnType<typeof setTimeout>|undefined;
    let onAbort=()=>{};
    const timeout=new Promise<never>((_,reject)=>{onAbort=()=>{clearTimeout(deadline);reject(new Error('Historical seed cancelled or exceeded its 45-second deadline.'));};controller.signal.addEventListener('abort',onAbort,{once:true});deadline=setTimeout(()=>controller.abort(),45000);});
    try{
      const history=await Promise.race([timeout,provider.history(s.row.symbol,SIGNAL_POLICY.historySize,controller.signal,(loaded,total)=>{
        if(stopped||controller.signal.aborted||s.abort!==controller)return;s.row.historyLoaded=loaded;s.row.historyTarget=total;emit();
      })]);
      if(stopped||controller.signal.aborted)throw new Error('Historical seed cancelled or exceeded its 45-second deadline.');
      // Buffered ticks observed BEFORE training belong to the seed, never to
      // forward validation. Drop historical overlap; never invent missing ticks.
      const last=history.at(-1)?.epoch??-Infinity;
      const buffered=s.buffer.filter(q=>q.epoch>last);
      const merged=[...history,...buffered];
      const gaps=history.slice(-80).map((q,i,a)=>i?q.epoch-a[i-1].epoch:0).filter(n=>n>0).sort((a,b)=>a-b);
      const cadence=gaps[Math.floor(gaps.length/2)]??1;
      const boundary=[...(history.at(-1)?[history.at(-1)!]:[]),...buffered];
      if(boundary.some((q,i)=>i>0&&q.epoch-boundary[i-1].epoch>cadence*1.5))throw new Error('Stream gap during history loading; retrying a contiguous seed.');
      s.tracker=new PatternTracker(s.row.symbol,leg,duration,merged);
      s.buffer=[];s.row.historyLoaded=Math.min(SIGNAL_POLICY.historySize,merged.length);
      s.row.phase='watching';s.row.error=undefined;s.row.retryAt=undefined;s.attempts=0;emit();
    }catch(error){retry(s,error);}
    finally{clearTimeout(deadline);controller.signal.removeEventListener('abort',onAbort);s.abort=undefined;s.seeding=false;seeding--;pumpSeed();}
  }
  function pumpSeed(){while(!stopped&&seeding<3&&seedQueue.length){const s=seedQueue.shift()!;seeding++;void seed(s);}}
  emit();pumpOpen();
  return ()=>{
    stopped=true;clearInterval(clock);openQueue.length=0;seedQueue.length=0;
    for(const s of states){if(s.timer)clearTimeout(s.timer);s.abort?.abort();s.dispose?.();s.tracker=undefined;s.buffer=[];}
  };
}
