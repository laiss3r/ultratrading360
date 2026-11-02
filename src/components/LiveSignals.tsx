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
 const [watching,setWatching]=useState(false),[selected,setSelected]=useState<string[]|null>(null),[revision,setRevision]=useState(0),[viewClock,setViewClock]=useState(0);
 const markets=useMemo(()=>eligibleMarkets(symbols).slice(0,20),[symbols]);
 const config=useMemo(()=>({provider,contractType,barrier,duration,markets,selected,revision}),[provider,contractType,barrier,duration,markets,selected,revision]);
 const [scan,setScan]=useState<{config:typeof config;rows:WatchedSignal[];now:number;receivedAt:number}|null>(null);
 useEffect(()=>{
  if(!watching||!provider)return;
  return watchSignals(provider,markets.filter(m=>selected===null||selected.includes(m.underlying_symbol)),{contractType,barrier},duration,rows=>setScan({config,rows,now:Date.now(),receivedAt:performance.now()}));
 },[watching,config,provider,markets,selected,contractType,barrier,duration]);
 // Config identity excludes EVERY stale-provider/contract/duration/market response,
 // including rows whose history has not produced evidence yet.
 const current=watching&&scan?.config===config?scan.rows:[];
 const complete=current.some(r=>r.complete);
 useEffect(()=>{if(!complete)return;const timer=setInterval(()=>setViewClock(performance.now()),250);return ()=>clearInterval(timer);},[complete]);
 const now=(current[0]?.asOf??scan?.now??0)+(complete?Math.max(0,viewClock-(scan?.receivedAt??viewClock)):0);
 const remaining=Math.ceil((current[0]?.remainingMs??60000)/1000);
 const incomplete=current.filter(r=>r.result==='incomplete').length;
 const ranked=[...current].sort((a,b)=>Number(b.evidence?.status==='qualified')-Number(a.evidence?.status==='qualified')||(b.evidence?.lower??0)-(a.evidence?.lower??0));
 const ready=ranked.filter(r=>r.phase==='watching'&&r.evidence?.status==='qualified'&&now-r.evidence.lastTickAt<=SIGNAL_POLICY.maxAgeMs);
 const loaded=current.filter(r=>r.phase==='watching').length;
 const historyLoaded=current.reduce((n,r)=>n+r.historyLoaded,0),historyTarget=current.reduce((n,r)=>n+r.historyTarget,0);
 const clockSkew=current.find(r=>Math.abs(r.clockSkewMs??0)>5000)?.clockSkewMs;
 const count=markets.filter(m=>selected===null||selected.includes(m.underlying_symbol)).length;
 const live=current.filter(r=>r.lastQuote&&now-r.lastQuote.epoch*1000<=SIGNAL_POLICY.maxAgeMs);
 const seeding=current.filter(r=>r.phase==='loading');
 const retrying=current.filter(r=>r.phase==='retrying').length;
 const label=(r:WatchedSignal)=>r.complete?(r.result==='qualified'?(now-(r.evidence?.lastTickAt??0)<=SIGNAL_POLICY.maxAgeMs?'Qualified · scan complete':'Qualified snapshot expired · scan again'):r.result==='no_setup'?'No qualified setup · scan complete':'Incomplete · data deadline reached'):r.phase==='retrying'?'Retrying':r.phase==='loading'?`History ${r.historyLoaded.toLocaleString()} / ${r.historyTarget.toLocaleString()}`:r.phase==='queued'?'Queued for history':r.phase==='connecting'?'Connecting live stream':r.evidence?.status==='qualified'?'Pattern qualified':r.evidence?.status==='stale'?(r.evidence.lastTickAt===0?'History ready · waiting for next live tick':'Stale · entry blocked'):r.evidence?.status==='warming'?'Validating new ticks':'Watching · no signal';
 return <Panel title="Live market signals" subtitle={`${CONTRACT_LABELS[contractType]}${['DIGITOVER','DIGITUNDER','DIGITMATCH','DIGITDIFF'].includes(contractType)?` ${barrier}`:''} · ${duration} tick${duration===1?'':'s'} · read-only scanner; no automatic purchase`} action={<Button variant={watching?'secondary':'primary'} disabled={!provider||!count} onClick={()=>complete?setRevision(n=>n+1):setWatching(!watching)}>{complete?<><Search size={14}/>Scan again</>:watching?<><Square size={14}/>Stop scan</>:<><Search size={14}/>Find market</>}</Button>}>
  <details><summary className="micro">Choose markets to watch ({count})</summary><div className="button-row" style={{marginTop:14}}>{markets.map(m=><label className="micro" key={m.underlying_symbol}><input type="checkbox" style={{width:'auto',marginRight:6}} checked={selected===null||selected.includes(m.underlying_symbol)} disabled={watching&&!complete} onChange={e=>{const ids=selected??markets.map(x=>x.underlying_symbol);setSelected(e.target.checked?[...ids,m.underlying_symbol]:ids.filter(x=>x!==m.underlying_symbol));}}/>{m.underlying_symbol_name}</label>)}</div></details>
  {!watching?<Empty title="Live scan is stopped">Find market opens live tick streams, loads up to 5,000 genuine history ticks per market, then validates against new outcomes. Returns a result within 60 seconds. Stop discards this scan; the deadline retains a timestamped result.</Empty>:<div className="stack" style={{marginTop:16}}>
   <div className="scan-activity" role="status"><strong>{complete?`Scan complete · ${incomplete} markets incomplete`:`Result within ${remaining}s · 60-second maximum`}</strong><span className="eyebrow">{complete?'SCAN RESULTS':seeding.length?'ANALYSING HISTORY':'LIVE MARKET WATCH'}</span><strong>{!complete&&seeding.length?seeding.map(r=>r.name).join(' · '):`${live.length} / ${count} markets receiving fresh ticks`}</strong><span className="micro">{loaded} / {count} markets analysed · {historyLoaded.toLocaleString()} / {historyTarget.toLocaleString()} history ticks loaded · {live.length} / {count} receiving live ticks · {ready.length} pattern-qualified{retrying?` · ${retrying} retrying`:''}</span><progress aria-label="Market analysis progress" max={Math.max(1,historyTarget)} value={historyLoaded}/><small>Progress shows genuine history ticks loaded—not predicted accuracy. The scan stops after 60 seconds, including retries. Unfinished markets are reported as incomplete, never as signals.</small></div>
   {clockSkew!==undefined&&<Notice tone="info">Your device clock differs from broker time by about {Math.round(Math.abs(clockSkew)/1000)} seconds. This read-only scan uses verified broker time. Set your device date and time to automatic; trading safety checks remain active.</Notice>}
   <div className="scan-market-grid">{current.map(r=>{const fresh=!!r.lastQuote&&now-r.lastQuote.epoch*1000<=SIGNAL_POLICY.maxAgeMs;const qualified=r.phase==='watching'&&r.evidence?.status==='qualified'&&now-r.evidence.lastTickAt<=SIGNAL_POLICY.maxAgeMs;return <article key={r.symbol} className={`scan-market-card ${qualified?'qualified':''}`} data-scan-phase={r.phase}>
    <header><strong>{r.name}</strong><span className={fresh?'live-dot':'stale-dot'} title={fresh?'Fresh broker tick':'Waiting for a fresh tick'}/></header>
    <p className="micro">{label(r)}</p><div className="scan-digits" aria-label={`${r.name} observed last digits`}>{r.digits.length?r.digits.join(' '):'Waiting for ticks…'}</div>
    <small>{r.liveTicks} live ticks observed · {r.lastQuote?`${Math.max(0,(now-r.lastQuote.epoch*1000)/1000).toFixed(1)}s tick age`:'No live tick yet'}</small>
    {r.lastQuote&&<small>Quote {r.lastQuote.price.toFixed(r.lastQuote.pipSize)} · {new Date(r.lastQuote.epoch*1000).toLocaleTimeString()}</small>}
    {r.error&&<p className="micro muted">{r.error}{r.retryAt?` Retry in ${Math.max(0,Math.ceil((r.retryAt-now)/1000))}s.`:''}</p>}
    {r.evidence&&<><small>Forward sample: {r.evidence.forward.total} / {SIGNAL_POLICY.minForward} minimum observations · {r.evidence.forward.hits} matched</small><p className="micro">{r.evidence.reason}</p></>}
    {r.complete&&!r.evidence&&<p className="micro">History or clock verification did not finish within the scan budget. Scan fewer markets or try again.</p>}
    <Button variant="ghost" disabled={disabled||!provider?.isConnected()} onClick={()=>void useApp.getState().selectSymbol(r.symbol)}>{active===r.symbol?'Selected':'Use market'}</Button><small>Selecting a market does not place an order or certify a signal.</small>
   </article>;})}</div>
   <Notice tone={ready.length?'success':'info'}>{ready.length?`Pattern-qualified: ${ready[0].name}. Broker payout, live freshness and risk checks still decide whether an entry is allowed.`:complete?'Scan finished. No currently fresh qualified signal. Review the reasons above or scan again; selecting a market is still available.':'Collecting evidence for up to 60 seconds. A minimum sample alone is not a qualified signal. You can select a market without placing an order.'}</Notice>
   <details><summary className="micro">Evidence details · training, held-out and new live outcomes</summary><div className="table-scroll"><table><thead><tr><th>Market / status</th><th>Current pattern</th><th>Held-out results</th><th>New live outcomes</th><th>Evidence bound</th></tr></thead><tbody>{ranked.map(r=>{const e=r.evidence;return <tr key={r.symbol}><td><strong>{r.name}</strong><small>{r.error??e?.reason??label(r)}</small></td><td>{e?.pattern??'—'}<small>1 = selected condition true; 0 = false</small></td><td>{e?.validation.total?`${e.validation.hits} / ${e.validation.total}`:'—'}</td><td>{e?.forward.total?`${e.forward.hits} / ${e.forward.total}`:'0'}<small>At least {SIGNAL_POLICY.minForward} per pattern</small></td><td>{e?.training.total?`${(e.lower*100).toFixed(1)}%`:'—'}<small>Not next-trade accuracy</small></td></tr>;})}</tbody></table></div></details>
  </div>}
  <p className="micro muted">Updates are driven by Deriv ticks and batched for display every 250ms. History requests are paced, not instant. Gaps trigger fresh seeding and discard old forward evidence. Fixed training-only selection of 1–3 tick suffixes; held-out validation; at least 30 new live outcomes per pattern. The bound must beat the contract baseline by 2 points; a broker payout must pass a 2% conservative margin check before buy. Five-second tick freshness limit. No guaranteed edge. Stopping this scanner does not stop an already-running bot.</p>
 </Panel>;
}
