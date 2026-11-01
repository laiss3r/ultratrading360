'use client';
import {useEffect,useMemo,useState} from 'react';
import {Search,Square} from 'lucide-react';
import {useApp} from '@/state/store';
import {eligibleMarkets,CONTRACT_LABELS} from '@/lib/overlord';
import type {ContractType} from '@/lib/deriv/contracts';
import {watchSignals,type WatchedSignal} from '@/lib/signals/scanner';
import {SIGNAL_POLICY} from '@/lib/signals/patterns';
import {Button,Empty,Notice,Panel} from './ui';

export function LiveSignals({contractType,barrier,duration,disabled=false}:{contractType:ContractType;barrier:number;duration:number;disabled?:boolean}){
 const provider=useApp(s=>s.provider),symbols=useApp(s=>s.symbols),active=useApp(s=>s.activeSymbol);
 const [watching,setWatching]=useState(false),[selected,setSelected]=useState<string[]|null>(null);
 const markets=useMemo(()=>eligibleMarkets(symbols).slice(0,20),[symbols]);
 const config=useMemo(()=>({provider,contractType,barrier,duration,markets,selected}),[provider,contractType,barrier,duration,markets,selected]);
 const [scan,setScan]=useState<{config:typeof config;rows:WatchedSignal[];now:number}|null>(null);
 useEffect(()=>{
  if(!watching||!provider)return;
  return watchSignals(provider,markets.filter(m=>selected===null||selected.includes(m.underlying_symbol)),{contractType,barrier},duration,rows=>setScan({config,rows,now:Date.now()}));
 },[watching,config,provider,markets,selected,contractType,barrier,duration]);
 // Config identity excludes EVERY stale-provider/contract/duration/market response,
 // including rows whose history has not produced evidence yet.
 const current=watching&&scan?.config===config?scan.rows:[];
 const now=scan?.now??0;
 const ranked=[...current].sort((a,b)=>Number(b.evidence?.status==='qualified')-Number(a.evidence?.status==='qualified')||(b.evidence?.lower??0)-(a.evidence?.lower??0));
 const ready=ranked.filter(r=>r.phase==='watching'&&r.evidence?.status==='qualified');
 const loaded=current.filter(r=>r.phase==='watching').length;
 const count=markets.filter(m=>selected===null||selected.includes(m.underlying_symbol)).length;
 const live=current.filter(r=>r.lastQuote&&now-r.lastQuote.epoch*1000<=SIGNAL_POLICY.maxAgeMs);
 const seeding=current.filter(r=>r.phase==='loading');
 const retrying=current.filter(r=>r.phase==='retrying').length;
 const label=(r:WatchedSignal)=>r.phase==='retrying'?'Retrying':r.phase==='loading'?`History ${r.historyLoaded.toLocaleString()} / ${r.historyTarget.toLocaleString()}`:r.phase==='queued'?'Queued for history':r.phase==='connecting'?'Connecting live stream':r.evidence?.status==='qualified'?'Pattern qualified':r.evidence?.status==='stale'?'Stale · entry blocked':r.evidence?.status==='warming'?'Validating new ticks':'Watching · no signal';
 return <Panel title="Live market signals" subtitle={`${CONTRACT_LABELS[contractType]}${['DIGITOVER','DIGITUNDER','DIGITMATCH','DIGITDIFF'].includes(contractType)?` ${barrier}`:''} · ${duration} tick${duration===1?'':'s'} · read-only scanner; no automatic purchase`} action={<Button variant={watching?'secondary':'primary'} disabled={!provider||!count} onClick={()=>setWatching(!watching)}>{watching?<><Square size={14}/>Stop scan</>:<><Search size={14}/>Find market</>}</Button>}>
  <details><summary className="micro">Choose markets to watch ({count})</summary><div className="button-row" style={{marginTop:14}}>{markets.map(m=><label className="micro" key={m.underlying_symbol}><input type="checkbox" style={{width:'auto',marginRight:6}} checked={selected===null||selected.includes(m.underlying_symbol)} disabled={watching} onChange={e=>{const ids=selected??markets.map(x=>x.underlying_symbol);setSelected(e.target.checked?[...ids,m.underlying_symbol]:ids.filter(x=>x!==m.underlying_symbol));}}/>{m.underlying_symbol_name}</label>)}</div></details>
  {!watching?<Empty title="Live scan is stopped">Find market opens live tick streams, loads up to 5,000 genuine history ticks per market, then validates against new outcomes. Stop discards every signal from this scan.</Empty>:<div className="stack" style={{marginTop:16}}>
   <div className="scan-activity" role="status"><span className="eyebrow">{seeding.length?'ANALYSING HISTORY':'LIVE MARKET WATCH'}</span><strong>{seeding.length?seeding.map(r=>r.name).join(' · '):`${live.length} / ${count} markets receiving fresh ticks`}</strong><span className="micro">{loaded} / {count} markets analysed · {ready.length} pattern-qualified{retrying?` · ${retrying} retrying`:''}</span><progress aria-label="Market analysis progress" max={Math.max(1,count)} value={loaded}/><small>Progress counts completed historical seeds—not predicted accuracy. Live ticks are observed while history loads.</small></div>
   <div className="scan-market-grid">{current.map(r=>{const fresh=!!r.lastQuote&&now-r.lastQuote.epoch*1000<=SIGNAL_POLICY.maxAgeMs;const qualified=r.phase==='watching'&&r.evidence?.status==='qualified';return <article key={r.symbol} className={`scan-market-card ${qualified?'qualified':''}`} data-scan-phase={r.phase}>
    <header><strong>{r.name}</strong><span className={fresh?'live-dot':'stale-dot'} title={fresh?'Fresh broker tick':'Waiting for a fresh tick'}/></header>
    <p className="micro">{label(r)}</p><div className="scan-digits" aria-label={`${r.name} observed last digits`}>{r.digits.length?r.digits.join(' '):'Waiting for ticks…'}</div>
    <small>{r.liveTicks} live ticks observed · {r.lastQuote?`${Math.max(0,(now-r.lastQuote.epoch*1000)/1000).toFixed(1)}s tick age`:'No live tick yet'}</small>
    {r.lastQuote&&<small>Quote {r.lastQuote.price.toFixed(r.lastQuote.pipSize)} · {new Date(r.lastQuote.epoch*1000).toLocaleTimeString()}</small>}
    {r.error&&<p className="micro muted">{r.error}{r.retryAt?` Retry in ${Math.max(0,Math.ceil((r.retryAt-now)/1000))}s.`:''}</p>}
    {r.evidence&&<small>New outcomes for current pattern: {r.evidence.forward.hits} / {r.evidence.forward.total} · {SIGNAL_POLICY.minForward} required</small>}
    <Button variant="ghost" disabled={disabled||!qualified} onClick={()=>void useApp.getState().selectSymbol(r.symbol)}>{active===r.symbol?'Selected':'Use market'}</Button>
   </article>;})}</div>
   <Notice tone={ready.length?'success':'info'}>{ready.length?`Pattern-qualified: ${ready[0].name}. Broker payout, live freshness and risk checks still decide whether an entry is allowed.`:'No qualified signal yet. Streams are monitored continuously; a connected market or a streak is not permission to buy.'}</Notice>
   <details><summary className="micro">Evidence details · training, held-out and new live outcomes</summary><div className="table-scroll"><table><thead><tr><th>Market / status</th><th>Current pattern</th><th>Held-out results</th><th>New live outcomes</th><th>Evidence bound</th></tr></thead><tbody>{ranked.map(r=>{const e=r.evidence;return <tr key={r.symbol}><td><strong>{r.name}</strong><small>{r.error??e?.reason??label(r)}</small></td><td>{e?.pattern??'—'}<small>1 = selected condition true; 0 = false</small></td><td>{e?.validation.total?`${e.validation.hits} / ${e.validation.total}`:'—'}</td><td>{e?.forward.total?`${e.forward.hits} / ${e.forward.total}`:'0'}<small>At least {SIGNAL_POLICY.minForward} per pattern</small></td><td>{e?.training.total?`${(e.lower*100).toFixed(1)}%`:'—'}<small>Not next-trade accuracy</small></td></tr>;})}</tbody></table></div></details>
  </div>}
  <p className="micro muted">Updates are driven by Deriv ticks and batched for display every 250ms. History requests are paced, not instant. Gaps trigger fresh seeding and discard old forward evidence. Fixed training-only selection of 1–3 tick suffixes; held-out validation; at least 30 new live outcomes per pattern. The bound must beat the contract baseline by 2 points; a broker payout must pass a 2% conservative margin check before buy. Five-second tick freshness limit. No guaranteed edge. Stopping this scanner does not stop an already-running bot.</p>
 </Panel>;
}
