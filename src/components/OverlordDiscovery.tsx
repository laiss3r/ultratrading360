'use client';
import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {Search,Square,RefreshCw} from 'lucide-react';
import {DerivProvider} from '@/lib/engine/provider';
import type {ActiveSymbol} from '@/lib/deriv/types';
import {DISCOVERY_POLICY,DIGIT_FAMILIES,HistoricalDiscovery,rankOpportunities,type DiscoveryRow,type Opportunity} from '@/lib/overlord/discovery';
import {CONTRACT_LABELS} from '@/lib/overlord';
import {Button,Empty,Notice,Panel} from './ui';
const percent=(n:number)=>`${(n*100).toFixed(1)}%`;
const label=(o:Opportunity)=>`${CONTRACT_LABELS[o.contractType]}${o.barrier===undefined?'':` ${o.barrier}`}`;
export function OverlordDiscovery({duration,disabled,onMarkets,onSelect,renderRun}:{duration:number;disabled:boolean;onMarkets:(markets:ActiveSymbol[])=>void;onSelect:(symbol:string,opportunity:Opportunity)=>void;renderRun?:(row:DiscoveryRow,expired:boolean)=>ReactNode}){
 const service=useRef<HistoricalDiscovery|null>(null),abort=useRef<AbortController|null>(null),busy=useRef(false);
 const [active,setActive]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [snapshot,setSnapshot]=useState<{duration:number;rows:DiscoveryRow[]}>({duration,rows:[]}),[now,setNow]=useState(0),[sort,setSort]=useState('probability');
 const start=useCallback(async(force=false)=>{
  abort.current?.abort();const controller=new AbortController();abort.current=controller;busy.current=true;
  if(!service.current)service.current=new HistoricalDiscovery(new DerivProvider('deriv_demo'));
  setLoading(true);setError('');
  try{await service.current.scan(duration,{signal:controller.signal,force,onMarkets:markets=>{if(!controller.signal.aborted)onMarkets(markets);},onUpdate:rows=>{if(!controller.signal.aborted){setSnapshot({duration,rows});setNow(Date.now());}}});}
  catch(e){if(!controller.signal.aborted){service.current?.close();service.current=null;setSnapshot({duration,rows:[]});setError((e as Error).message);}}
  finally{if(abort.current===controller){busy.current=false;setLoading(false);}}
 },[duration,onMarkets]);
 useEffect(()=>{
  if(!active)return;
  const begin=setTimeout(()=>void start(),0),clock=setInterval(()=>setNow(Date.now()),1000),refresh=setInterval(()=>{if(!busy.current)void start(true);},DISCOVERY_POLICY.cacheMs);
  return()=>{clearTimeout(begin);clearInterval(clock);clearInterval(refresh);abort.current?.abort();};
 },[active,start]);
 useEffect(()=>()=>{abort.current?.abort();service.current?.close();},[]);
 const rows=active&&snapshot.duration===duration?snapshot.rows:[];
 const complete=rows.filter(r=>['ready','error','unavailable'].includes(r.phase)).length;
 const ready=rows.filter(r=>r.phase==='ready'&&r.analysis);
 const candidates=ready.flatMap(r=>r.analysis!.opportunities.map(o=>({row:r,opportunity:o}))).sort((a,b)=>rankOpportunities(a.opportunity,b.opportunity)||a.row.name.localeCompare(b.row.name));
 const best=candidates[0];
 const lift=[...candidates].sort((a,b)=>b.opportunity.lift-a.opportunity.lift||rankOpportunities(a.opportunity,b.opportunity))[0];
 const ordered=[...rows].sort((a,b)=>Number(b.phase==='ready')-Number(a.phase==='ready')||(a.analysis&&b.analysis?(sort==='lift'?b.analysis.opportunities.reduce((v,o)=>Math.max(v,o.lift),-Infinity)-a.analysis.opportunities.reduce((v,o)=>Math.max(v,o.lift),-Infinity):rankOpportunities(a.analysis.best,b.analysis.best)):0)||a.name.localeCompare(b.name,undefined,{numeric:true}));
 const failures=rows.filter(r=>r.phase==='error').length,unavailable=rows.filter(r=>r.phase==='unavailable').length;
 const stale=(r:DiscoveryRow)=>!r.analysis||now-r.analysis.to*1000>DISCOVERY_POLICY.cacheMs;
 return <Panel title="Volatility market discovery" subtitle={`History-first · automatic ${DISCOVERY_POLICY.ticks.toLocaleString()}-tick sample · Even, Odd, Over and Under`} action={active?<div className="button-row"><Button variant="secondary" disabled={loading} onClick={()=>void start(true)}><RefreshCw size={14}/>Refresh history</Button><Button variant="secondary" onClick={()=>{abort.current?.abort();service.current?.close();service.current=null;setActive(false);}}><Square size={14}/>Stop scan</Button></div>:<Button onClick={()=>setActive(true)}><Search size={14}/>Find market</Button>}>
  <p className="micro muted">Scans every API-listed Volatility market, including 1-second and S variations when returned by Deriv. No market checklist or tick-count setup. A dedicated public history connection avoids the bot/chart history queue. No live tick is required to display analysis.</p>
  {error&&<Notice tone="error">{error} <Button variant="secondary" disabled={loading} onClick={()=>void start(true)}>Retry discovery</Button></Notice>}
  {!active?<Empty title="Find the strongest historical results">Find market fetches all market histories in a bounded, rate-paced batch. Results appear as soon as each history arrives; there is no live-validation countdown.</Empty>:<div className="stack" style={{marginTop:16,gap:16}}>
   <div className="scan-activity" role="status"><span className="eyebrow">{error?'DISCOVERY INTERRUPTED':loading?'FETCHING HISTORICAL TICKS':'HISTORICAL ANALYSIS COMPLETE'}</span><strong>{rows.length?`${complete} / ${rows.length} Volatility markets processed`:(error?'Retry to reload the API market list.':'Discovering all Volatility markets from Deriv…')}</strong><progress aria-label="Historical discovery progress" max={Math.max(1,rows.length)} value={complete}/><small>{ready.length} analysed · {failures} failed · {unavailable} closed/suspended · {candidates.length} contract/barrier estimates. Refreshes every 60 seconds while active. API history reads are paced to avoid rate limits.</small></div>
   {best&&<div className="overlord-best"><span className="eyebrow">HIGHEST HISTORICAL PROBABILITY{loading?' · SO FAR':failures?' · SUCCESSFUL MARKETS ONLY':''}</span><h3>{best.row.name} · {label(best.opportunity)}</h3><strong className="overlord-probability">{percent(best.opportunity.probability)}</strong><p className="micro">Observed {best.opportunity.hits} / {best.opportunity.sample} outcomes · uniform-digit baseline {percent(best.opportunity.baseline)} · lift {(best.opportunity.lift*100).toFixed(1)} percentage points.</p><p className="micro muted">A high raw probability often comes from an easier Over/Under barrier, not an advantage. Broker payouts vary. This is a historical estimate—not next-trade accuracy or permission to buy.</p><Button variant="secondary" disabled={disabled||stale(best.row)} onClick={()=>onSelect(best.row.symbol,best.opportunity)}>Apply highest-probability setup</Button>{renderRun?.(best.row,stale(best.row))}</div>}
   {lift&&<p className="micro muted">Largest observed lift over its own baseline: <strong>{lift.row.name} · {label(lift.opportunity)}</strong> ({(lift.opportunity.lift*100).toFixed(1)} percentage points). Exploratory ranking across many comparisons; not a proven edge.</p>}
   {!!rows.length&&<label className="field"><span>Compare markets</span><select value={sort} onChange={e=>setSort(e.target.value)}><option value="probability">Highest observed probability first</option><option value="lift">Largest observed baseline lift first</option></select></label>}
   <div className="scan-market-grid">{ordered.map(row=><article key={row.symbol} className="scan-market-card overlord-history-card" data-discovery-phase={row.phase} data-market-symbol={row.symbol}>
    <header><strong>{row.name}</strong><span className="badge badge-neutral">{row.phase==='ready'?(stale(row)?'Expired':'Analysed'):row.phase==='loading'?'Fetching history':row.phase==='queued'?'History queued':row.phase==='error'?'Retry needed':'Unavailable'}</span>{row.phase==='ready'&&row.analysis&&renderRun?.(row,stale(row))}</header>
    {row.error&&<Notice tone={row.phase==='error'?'error':'info'}>{row.error}</Notice>}
    {row.phase==='loading'&&<small>{row.loaded.toLocaleString()} / {DISCOVERY_POLICY.ticks.toLocaleString()} history ticks loaded</small>}
    {row.analysis&&<><small>{row.analysis.ticks.toLocaleString()} genuine ticks · {row.analysis.sample.toLocaleString()} non-overlapping {duration}-tick outcomes{row.cached?' · cached':''}</small><small>History through {new Date(row.analysis.to*1000).toLocaleTimeString()} · {Math.max(0,Math.floor((now-row.analysis.to*1000)/1000))}s old</small><div className="scan-digits" aria-label={`${row.name} historical last digits`}>{row.analysis.digits.join(' ')}</div>
     <div className="overlord-contract-grid">{DIGIT_FAMILIES.map(family=>{const o=row.analysis!.opportunities.find(o=>o.contractType===family);return <div key={family} data-contract-family={family}>{o?<><span>{label(o)}</span><strong data-probability={o.probability} data-hits={o.hits} data-sample={o.sample}>{percent(o.probability)}</strong><small>{o.hits} / {o.sample} · baseline {percent(o.baseline)}</small></>:<small>{CONTRACT_LABELS[family]} · not listed for this duration</small>}</div>;})}</div>
     <details><summary className="micro">All {row.analysis.opportunities.length} supported contract/barrier estimates</summary><p className="micro muted">Strict rules: Over excludes the barrier; Under excludes the barrier. Approximate 95% Wilson intervals assume independent outcomes; they do not correct for selecting the best of many markets.</p><div className="overlord-estimates">{row.analysis.opportunities.map(o=><div key={`${o.contractType}:${o.barrier}`}><span><strong>{label(o)} · {percent(o.probability)}</strong><small>{o.hits}/{o.sample} · interval {percent(o.lower)}–{percent(o.upper)}</small></span><Button variant="ghost" disabled={disabled||stale(row)} onClick={()=>onSelect(row.symbol,o)}>Apply</Button></div>)}</div></details>
     <Button variant="secondary" disabled={disabled||stale(row)} onClick={()=>onSelect(row.symbol,row.analysis!.best)}>Apply top result</Button>
     {stale(row)&&<small>History estimate expired. Refresh before applying this setup.</small>}
    </>}
   </article>)}</div>
  </div>}
  <Notice>History percentages are measured frequencies: matching terminal digits ÷ sampled outcomes. The default 1,000 ticks gives a useful, fast descriptive sample—not guaranteed predictive accuracy. Applying a result only changes your setup; the bot still requires fresh live evidence, a valid payout, account permission and risk checks before purchasing.</Notice>
 </Panel>;
}
