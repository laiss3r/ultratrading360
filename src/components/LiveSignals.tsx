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
 const provider=useApp((s)=>s.provider),symbols=useApp((s)=>s.symbols),active=useApp((s)=>s.activeSymbol);
 const [watching,setWatching]=useState(false),[rows,setRows]=useState<WatchedSignal[]>([]),[selected,setSelected]=useState<string[]|null>(null);
 const markets=useMemo(()=>eligibleMarkets(symbols).slice(0,20),[symbols]);
 const key=`${contractType}:${barrier}:${duration}`;
 useEffect(()=>{
  if(!watching||!provider)return;
  return watchSignals(provider,markets.filter((m)=>selected===null||selected.includes(m.underlying_symbol)),{contractType,barrier},duration,setRows);
 },[watching,provider,markets,selected,contractType,barrier,duration]);
 // Results are tagged by the actual contract; old evidence can never be applied to a changed selector.
 const current=rows.filter((r)=>!r.evidence||(r.evidence.contractType===contractType&&r.evidence.duration===duration&&r.evidence.barrier===barrier));
 const ranked=[...current].sort((a,b)=>(b.evidence?.status==='qualified'?1:0)-(a.evidence?.status==='qualified'?1:0)||(b.evidence?.lower??0)-(a.evidence?.lower??0));
 const ready=ranked.filter((r)=>r.evidence?.status==='qualified'&&watching);
 const loaded=current.filter((r)=>r.phase!=='loading').length;
 const count=selected?.length??markets.length;
 return <Panel title="Live market signals" subtitle={`${CONTRACT_LABELS[contractType]}${['DIGITOVER','DIGITUNDER','DIGITMATCH','DIGITDIFF'].includes(contractType)?` ${barrier}`:''} · ${duration} tick${duration===1?'':'s'} · no automatic purchase from this scanner`} action={<Button variant={watching?'secondary':'primary'} disabled={!provider||!count} onClick={()=>{setRows([]);setWatching(!watching);}}>{watching?<><Square size={14}/>Stop scan</>:<><Search size={14}/>Find market</>}</Button>}>
  <details><summary className="micro">Choose markets to watch ({count})</summary><div className="button-row" style={{marginTop:14}}>{markets.map((m)=><label className="micro" key={m.underlying_symbol}><input type="checkbox" style={{width:'auto',marginRight:6}} checked={selected===null||selected.includes(m.underlying_symbol)} disabled={watching} onChange={(e)=>{const ids=selected??markets.map((x)=>x.underlying_symbol);setSelected(e.target.checked?[...ids,m.underlying_symbol]:ids.filter((x)=>x!==m.underlying_symbol));setRows([]);}}/>{m.underlying_symbol_name}</label>)}</div></details>
  {!watching?<Empty title="Live scan is stopped">Start a scan to load up to 5,000 real ticks per market and validate patterns against new incoming ticks. Stopping invalidates all results.</Empty>:<div className="stack" style={{marginTop:16}}>
   <p className="micro" role="status">{loaded} / {count} markets analysed · {ready.length} pattern-qualified · live updates every second</p>
   <progress aria-label="Market analysis progress" max={Math.max(1,count)} value={loaded} style={{width:'100%'}}/>
   <div className="button-row">{current.map((r)=><span key={r.symbol} className={`badge ${r.phase==='error'?'badge-red':r.phase==='watching'?'badge-green':'badge-neutral'}`}>{r.phase==='watching'?'✓ ':r.phase==='error'?'! ':'… '}{r.name}</span>)}</div>
   <Notice tone={ready.length?'success':'info'}>{ready.length?`Pattern-qualified: ${ready[0].name}. Broker payout, live freshness and risk checks still decide whether an entry is allowed.`:'No qualified signal yet. The bot must wait; it will not buy just because a market is rare or a streak appeared.'}</Notice>
   <div className="table-scroll"><table key={key}><thead><tr><th>Market / status</th><th>Current pattern</th><th>Held-out results</th><th>New live outcomes</th><th>Evidence bound</th><th/></tr></thead><tbody>{ranked.map((r)=>{const e=r.evidence;return <tr key={r.symbol}><td><strong>{r.name}</strong><small>{r.phase==='error'?r.error:e?.reason??'Loading real history…'}</small>{e?.lastTickAt?<small>Tick: {new Date(e.lastTickAt).toLocaleTimeString()}</small>:null}</td><td>{e?.pattern??'—'}<small>1 = selected condition true; 0 = false</small></td><td>{e?.validation.total?`${e.validation.hits} / ${e.validation.total}`:'—'}</td><td>{e?.forward.total?`${e.forward.hits} / ${e.forward.total}`:'0'}<small>At least {SIGNAL_POLICY.minForward} required per pattern</small></td><td>{e?.training.total?`${(e.lower*100).toFixed(1)}%`:'—'}<small>Not next-trade accuracy</small></td><td><Button variant="ghost" disabled={disabled||e?.status!=='qualified'} onClick={()=>void useApp.getState().selectSymbol(r.symbol)}>{active===r.symbol?'Selected':'Use market'}</Button></td></tr>;})}</tbody></table></div>
  </div>}
  <p className="micro muted">Fixed rules: training-only selection of 1–3 tick suffixes, chronological held-out validation, then at least 30 new live outcomes. Historical interval adjustment covers 14 patterns × 20 markets. Evidence must beat the contract baseline by 2 points; an actual broker payout must also pass a 2% conservative margin check before buy. Five-second freshness limit. No guaranteed edge; repeated monitoring and dependent ticks limit statistical certainty.</p>
 </Panel>;
}
