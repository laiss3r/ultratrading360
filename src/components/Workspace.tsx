'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight, Download, Play, Square, Pause, ChevronRight, ShieldCheck } from 'lucide-react';
import { useApp } from '@/state/store';
import type { Quote } from '@/lib/engine/provider';
import { Button, Empty, Notice, Panel } from './ui';

export const money = (value: number, currency = 'USD') => `${value.toFixed(2)} ${currency}`;
export const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
export function MarketSelect() {
  const symbol = useApp((s) => s.activeSymbol);
  const symbols = useApp((s) => s.symbols);
  return <label className="market-select"><span>Market</span><select aria-label="Select market" value={symbol} onChange={(e) => void useApp.getState().selectSymbol(e.target.value)}>{!symbols.some((s) => s.underlying_symbol === symbol) && <option value={symbol}>{symbol} · selected market</option>}{symbols.map((s) => <option value={s.underlying_symbol} key={s.underlying_symbol}>{s.underlying_symbol_name}</option>)}</select></label>;
}

export function TickChart({ quotes, large = false }: { quotes: Quote[]; large?: boolean }) {
  const data = quotes.slice(-180);
  if (data.length < 2) return <div className={`chart-empty ${large ? 'large' : ''}`}><Empty title="Waiting for Deriv ticks">The chart appears when live or historical quotes arrive. No generated prices.</Empty></div>;
  const prices = data.map((q) => q.price);
  const min = Math.min(...prices), max = Math.max(...prices), range = max - min || 1;
  const w = 760, h = large ? 340 : 210;
  const y = (price: number) => h - 25 - (price - min) / range * (h - 50);
  const points = data.map((q, i) => `${(i / (data.length - 1) * (w - 22) + 10).toFixed(2)},${y(q.price).toFixed(2)}`).join(' ');
  const last = data[data.length - 1];
  return <div className="tick-chart"><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Deriv tick prices: ${min.toFixed(last.pipSize)} to ${max.toFixed(last.pipSize)}`} preserveAspectRatio="none">
    {[0.2, 0.4, 0.6, 0.8].map((ratio) => <line key={ratio} x1="0" x2={w} y1={h * ratio} y2={h * ratio} className="grid-line" />)}
    <polygon points={`10,${h} ${points} ${w-12},${h}`} className="chart-area" /><polyline points={points} className="chart-line" /><circle cx={w-12} cy={y(last.price)} r="4" className="chart-point" />
  </svg><div className="chart-labels"><span>{new Date(data[0].epoch * 1000).toLocaleTimeString()}</span><span>{data.length} observed ticks</span><span>{new Date(last.epoch * 1000).toLocaleTimeString()}</span></div></div>;
}

export function MarketPanel({ large = false }: { large?: boolean }) {
  const quotes = useApp((s) => s.quotes);
  const symbol = useApp((s) => s.activeSymbol);
  const error = useApp((s) => s.marketError);
  const loading = useApp((s) => s.marketLoading);
  const last = quotes.at(-1), previous = quotes.at(-2);
  const change = last && previous ? last.price - previous.price : null;
  return <Panel title="Market overview" subtitle="Observed Deriv tick prices" action={<span className="badge badge-blue">{symbol}</span>}>
    <div className="market-toolbar"><MarketSelect /><div className="last-quote"><span>Latest quote</span><strong>{last ? last.price.toFixed(last.pipSize) : '—'}</strong>{change !== null && <small className={change >= 0 ? 'positive' : 'negative'}>{change >= 0 ? '+' : ''}{change.toFixed(last?.pipSize ?? 2)} last tick</small>}</div></div>
    {error && <Notice tone="warning">Market data unavailable: {error}</Notice>}{loading && <p className="micro muted" role="status">Loading history…</p>}
    <TickChart quotes={quotes} large={large} />
  </Panel>;
}

export function DigitDistribution() {
  const digits = useApp((s) => s.digits);
  const sample = digits.slice(-1000);
  const counts = Array.from({length:10}, (_,d) => sample.filter((x)=>x===d).length);
  const max = Math.max(...counts,1);
  return <div><div className="digit-bars" aria-label="Observed last-digit frequency">{counts.map((count,d) => <div className="digit-column" key={d}><span>{sample.length ? `${(count/sample.length*100).toFixed(1)}%` : '—'}</span><div className="digit-track"><i style={{height:`${count/max*100}%`}} /></div><b>{d}</b></div>)}</div><p className="micro muted">{sample.length} observed digits · Past frequencies do not predict the next tick.</p></div>;
}

export function RunButton({ strategyId, children = 'Run strategy' }: { strategyId: string; children?: string }) {
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const session = useApp((s)=>s.session);
  const strategy = useApp((s)=>s.strategies.find((x)=>x.id===strategyId));
  const run = async () => {
    setPending(true); setMessage('');
    try { const result = await useApp.getState().runStrategy(strategyId); if(result.ok) setConfirm(false); else setMessage(result.message); }
    catch(e) { setMessage((e as Error).message); } finally { setPending(false); }
  };
  return <><Button onClick={()=>setConfirm(true)}><Play size={14}/>{children}</Button>{confirm && <div className="modal-backdrop" onClick={()=>!pending&&setConfirm(false)}><div role="dialog" aria-modal="true" aria-labelledby={`confirm-${strategyId}`} className="confirm-dialog" onClick={(e)=>e.stopPropagation()}><span className="eyebrow">CONFIRM BEFORE TRADING</span><h2 id={`confirm-${strategyId}`}>{strategy?.name ?? 'Run strategy'}</h2><p>This starts genuine Deriv orders on <strong>{session ? `${session.loginid} (${session.isVirtual?'Demo':'REAL MONEY'})` : 'no connected account'}</strong>. Open contracts may still settle after stopping.</p><dl className="detail-list"><div><dt>Base stake</dt><dd>{strategy?money(strategy.stake,strategy.currency):'—'}</dd></div><div><dt>Contract</dt><dd>{strategy?.contractType}</dd></div><div><dt>Maximum entries</dt><dd>{strategy?.maxTrades}</dd></div></dl>{message&&<Notice tone="error">{message}</Notice>}<div className="button-row"><Button busy={pending} onClick={()=>void run()}>Confirm & run</Button><Button variant="secondary" disabled={pending} onClick={()=>setConfirm(false)}>Cancel</Button></div><Link className="text-link" href="/risk" onClick={()=>setConfirm(false)}>Review trading permissions →</Link></div></div>}</>;
}

export function SessionRail() {
  const state = useApp((s)=>s.botState);
  const detail = useApp((s)=>s.botDetail);
  const strategies = useApp((s)=>s.strategies);
  const activeId = useApp((s)=>s.activeStrategyId);
  const snap = useApp((s)=>s.riskSnapshot);
  const log = useApp((s)=>s.log);
  const session = useApp((s)=>s.session);
  const enabled = useApp((s)=>s.settings.limits.tradingEnabled);
  const tradingLoginid = useApp((s)=>s.tradingLoginid);
  const [tab,setTab]=useState<'summary'|'journal'>('summary');
  const active = strategies.find((s)=>s.id===activeId)??strategies[0];
  const running = ['starting','running','paused','stopping'].includes(state);
  return <><div className="session-head"><span className="eyebrow">YOUR WORKSPACE</span><h2>Session monitor</h2><span className={`badge ${state==='running'?'badge-green':'badge-neutral'}`}>{state==='idle'?'Not running':state}</span></div>
    <div className="session-controls"><label className="field"><span>Active strategy</span><select aria-label="Active strategy" value={active?.id??''} disabled={running} onChange={(e)=>useApp.getState().setActiveStrategy(e.target.value)}>{!strategies.length&&<option value="">Create a strategy first</option>}{strategies.map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <div className="button-row">{running ? <><Button variant="danger" onClick={()=>useApp.getState().stopBot('user stopped')}><Square size={14}/>Stop</Button>{state==='paused'?<Button variant="secondary" onClick={()=>useApp.getState().resumeBot()}>Resume</Button>:<Button variant="secondary" onClick={()=>useApp.getState().pauseBot()}><Pause size={14}/>Pause</Button>}</> : active ? <RunButton strategyId={active.id}/> : <Link className="button button-primary" href="/builder">Build a bot <ChevronRight size={14}/></Link>}</div>
    <p className="micro muted">{detail||'Your bot runs in this browser. Keep this tab open.'}</p></div>
    <div className="rail-tabs"><button aria-pressed={tab==='summary'} onClick={()=>setTab('summary')}>Summary</button><button aria-pressed={tab==='journal'} onClick={()=>setTab('journal')}>Journal <small>{log.length}</small></button></div>
    {tab==='summary'?<div className="rail-summary"><div className="session-profit"><span>Session profit / loss</span><strong className={snap.sessionPnl>=0?'positive':'negative'}>{signed(snap.sessionPnl)}</strong><small>{session?.currency??'Account currency'} · {snap.tradesThisSession} settled entries</small></div><dl className="detail-list"><div><dt>Open exposure</dt><dd>{snap.openExposure.toFixed(2)}</dd></div><div><dt>Total session stake</dt><dd>{snap.sessionExposure.toFixed(2)}</dd></div><div><dt>Consecutive losses</dt><dd>{snap.consecutiveLosses}</dd></div><div><dt>Account trading channel</dt><dd>{session&&tradingLoginid===session.loginid?'Verified':'Not connected'}</dd></div><div><dt>Trading permission</dt><dd className={enabled?'positive':''}>{enabled?'Enabled':'Disabled'}</dd></div></dl>{snap.halted&&<Notice tone="error">{snap.haltDetail??snap.haltReason??'Risk limit reached.'}</Notice>}<Link href="/risk" className="rail-link"><ShieldCheck size={17}/>Risk controls<ArrowUpRight size={15}/></Link><p className="rail-disclaimer">Every trade can lose its stake. Progressions increase exposure; they do not create an edge.</p></div>:<div className="journal">{log.length?log.slice(-40).reverse().map((x,i)=><div key={`${x.at}-${i}`} className={`journal-entry ${x.level}`}><time>{new Date(x.at).toLocaleTimeString()}</time><p>{x.text}</p></div>):<Empty title="No events yet">Connection and strategy events appear here.</Empty>}</div>}
  </>;
}

export function TradeTable({ limit = 100 }: { limit?: number }) {
  const trades = useApp((s)=>s.trades);
  const mode = useApp((s)=>s.settings.mode);
  const filtered = trades.filter((t)=>t.mode===mode).slice(0,limit);
  if(!filtered.length) return <Empty title="No settled trades yet">Only genuine Deriv contract results recorded in this browser appear here. {mode==='deriv_demo'?'Demo':'Real'} history is shown separately.</Empty>;
  return <div className="table-scroll"><table><thead><tr><th>Time</th><th>Strategy / contract</th><th>Market</th><th>Stake</th><th>Net P/L</th><th>Result</th></tr></thead><tbody>{filtered.map((t)=><tr key={t.id}><td>{new Date(t.closedAt).toLocaleTimeString()}</td><td><strong>{t.strategyName}</strong><small>{t.contractType}</small></td><td>{t.symbol}</td><td>{t.stake.toFixed(2)}</td><td className={t.profit>=0?'positive':'negative'}>{signed(t.profit)}</td><td><span className={`badge ${t.error?'badge-neutral':t.won?'badge-green':'badge-red'}`}>{t.error?'Error':t.won?'Won':'Lost'}</span></td></tr>)}</tbody></table></div>;
}

export function ExportTrades() {
  const exportCsv=()=>{
    const mode=useApp.getState().settings.mode;
    const clean=(v:unknown)=>`"${String(v??'').replace(/^[=+@-]/,"'").replaceAll('"','""')}"`;
    const rows=useApp.getState().trades.filter((t)=>t.mode===mode).map((t)=>[new Date(t.closedAt).toISOString(),t.id,t.strategyName,t.symbol,t.contractType,t.stake,t.profit,t.won,t.mode,t.source]);
    const csv=[['closed_at','id','strategy','symbol','contract','stake','profit','won','mode','source'],...rows].map((r)=>r.map(clean).join(',')).join('\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='ultratrading-trades.csv';a.click();URL.revokeObjectURL(url);
  };
  return <Button variant="secondary" onClick={exportCsv}><Download size={15}/>Export CSV</Button>;
}
