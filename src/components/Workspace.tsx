'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Play, Square, Pause, ChevronRight } from 'lucide-react';
import { useApp } from '@/state/store';
import { effectiveStrategyLimits } from '@/lib/engine/strategies';
import type { Quote } from '@/lib/engine/provider';
import { ExecutionConsole, BrokerTransactions } from './ExecutionConsole';
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

export function RunButton({ strategyId, prepare, children = 'Run strategy' }: { strategyId?: string; prepare?: () => Promise<string>; children?: string }) {
  const [preparedId, setPreparedId] = useState<string | null>(null);
  const currentId = preparedId ?? strategyId;
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const session = useApp((s)=>s.session);
  const strategy = useApp((s)=>s.strategies.find((x)=>x.id===currentId));
  const globalLimits = useApp((s)=>s.settings.limits);
  const limits = strategy ? effectiveStrategyLimits(globalLimits, strategy) : null;
  const open = async () => {
    setMessage('');
    try { if (prepare) { setPending(true); setPreparedId(await prepare()); } setConfirm(true); }
    catch (e) { setMessage((e as Error).message); } finally { setPending(false); }
  };
  const run = async () => {
    setPending(true); setMessage('');
    try { const result = await useApp.getState().runStrategy(currentId ?? ''); if(result.ok) setConfirm(false); else setMessage(result.message); }
    catch(e) { setMessage((e as Error).message); } finally { setPending(false); }
  };
  return <><Button busy={pending} onClick={()=>void open()}><Play size={14}/>{children}</Button>{message&&!confirm&&<Notice tone="error">{message}</Notice>}{confirm && createPortal(<div className="modal-backdrop" onClick={()=>!pending&&setConfirm(false)}><div role="dialog" aria-modal="true" aria-labelledby={`confirm-${currentId}`} className="confirm-dialog" onClick={(e)=>e.stopPropagation()}><span className="eyebrow">CONFIRM BEFORE TRADING</span><h2 id={`confirm-${currentId}`}>{strategy?.name ?? 'Run strategy'}</h2><p>This starts genuine Deriv orders on <strong>{session ? `${session.loginid} (${session.isVirtual?'Demo':'REAL MONEY'})` : 'no connected account'}</strong>. Open contracts may still settle after stopping.</p><dl className="detail-list"><div><dt>Base stake</dt><dd>{strategy?money(strategy.stake,strategy.currency):'—'}</dd></div><div><dt>Contract</dt><dd>{strategy?.contractType}{strategy?.barrier!==undefined?` · ${strategy.barrier}`:''}</dd></div><div><dt>Duration</dt><dd>{strategy?.duration} {strategy?.durationUnit==='t'?'ticks':strategy?.durationUnit}</dd></div><div><dt>Maximum entries</dt><dd>{limits?.maxTrades}</dd></div><div><dt>Profit target / stop loss</dt><dd>{limits?.maxSessionProfit || 'Off'} / {limits?.maxSessionLoss}</dd></div><div><dt>Stake plan / maximum stake</dt><dd>{strategy?.progression?.kind ?? 'Fixed'} / {limits?.maxStake}</dd></div>{strategy?.contractRotation&&<div><dt>Recovery contract</dt><dd>{strategy.contractRotation.recovery.contractType} · {strategy.contractRotation.mode}</dd></div>}</dl>{(strategy?.signalGate||strategy?.name.startsWith('Overlord ·'))&&<Notice>Signal-gated on both Demo and Real: waits for held-out and new live evidence, then checks the actual payout. No signal means no buy.</Notice>}{message&&<Notice tone="error">{message}</Notice>}<div className="button-row"><Button busy={pending} onClick={()=>void run()}>Confirm & run</Button><Button variant="secondary" disabled={pending} onClick={()=>setConfirm(false)}>Cancel</Button></div><Link className="text-link" href="/risk" onClick={()=>setConfirm(false)}>Review trading permissions →</Link></div></div>, document.body)}</>;
}

export function SessionRail() {
  const state = useApp((s)=>s.botState);
  const detail = useApp((s)=>s.botDetail);
  const strategies = useApp((s)=>s.strategies);
  const activeId = useApp((s)=>s.activeStrategyId);
  const session = useApp((s)=>s.session);
  const enabled = useApp((s)=>s.settings.limits.tradingEnabled);
  const tradingLoginid = useApp((s)=>s.tradingLoginid);
  const tradingMessage = useApp((s)=>s.tradingMessage);
  const tradingConnecting = useApp((s)=>s.tradingConnecting);
  const accounts = useApp((s)=>s.accounts);
  const realAccount = accounts.find((a)=>!a.isVirtual);
  const [connectionNotice,setConnectionNotice] = useState('');
  const active = strategies.find((s)=>s.id===activeId)??strategies[0];
  const running = ['starting','running','paused','stopping'].includes(state);
  return <><div className="session-head"><span className="eyebrow">YOUR WORKSPACE</span><h2>Session monitor</h2><span className={`badge ${state==='running'?'badge-green':'badge-neutral'}`}>{state==='idle'?'Not running':state}</span></div>
    <div className="session-controls"><label className="field"><span>Active strategy</span><select aria-label="Active strategy" value={active?.id??''} disabled={running} onChange={(e)=>useApp.getState().setActiveStrategy(e.target.value)}>{!strategies.length&&<option value="">Create a strategy first</option>}{strategies.map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <div className="button-row">{running ? <><Button variant="danger" onClick={()=>useApp.getState().stopBot('user stopped')}><Square size={14}/>Stop</Button>{state==='paused'?<Button variant="secondary" onClick={()=>useApp.getState().resumeBot()}>Resume</Button>:<Button variant="secondary" onClick={()=>useApp.getState().pauseBot()}><Pause size={14}/>Pause</Button>}</> : active ? <RunButton strategyId={active.id}/> : <Link className="button button-primary" href="/builder">Build a bot <ChevronRight size={14}/></Link>}</div>
    <p className="micro muted">{detail||'Your bot runs in this browser. Keep this tab open.'}</p></div>
    <div className="session-controls"><dl className="detail-list"><div><dt>Account trading channel</dt><dd>{session&&tradingLoginid===session.loginid?'Verified':tradingConnecting?'Connecting…':'Not connected'}</dd></div><div><dt>Trading permission</dt><dd>{enabled?'Enabled':'Disabled'}</dd></div></dl></div>
    {session&&tradingLoginid!==session.loginid&&<div className="session-controls"><Notice>{tradingMessage||'Trading permission and an authenticated account channel are separate. No orders can be sent until this account is verified.'}</Notice><div className="button-row"><Button variant="secondary" busy={tradingConnecting} disabled={running||Boolean(useApp.getState().bot?.hasPendingOrder())} onClick={()=>void useApp.getState().attachTradingSocket(session.isVirtual?'deriv_demo':'deriv_real')}>Reconnect trading channel</Button><Link className="text-link" href="/risk">Review permissions</Link></div></div>}
    {session?.isVirtual&&<div className="session-controls"><p className="micro muted">{realAccount?'You are viewing Demo. Switch to your returned Real account below; this does not enable orders.':'Deriv has not returned a Real account in this session. Refresh account discovery to check; no Real account or balance will be invented.'}</p><Button variant="secondary" disabled={running||tradingConnecting} onClick={()=>void (realAccount?useApp.getState().selectAccount(realAccount.loginid):useApp.getState().syncBalances()).then((r)=>setConnectionNotice(r.message))}>{realAccount?'Switch to Real account':'Check for Real account'}</Button>{connectionNotice&&<p role="status" className="micro">{connectionNotice}</p>}</div>}
    <div style={{padding:'16px'}}><ExecutionConsole compact/></div>
  </>;
}

export function TradeTable({ limit = 100 }: { limit?: number }) {
  const trades = useApp((s)=>s.trades);
  const mode = useApp((s)=>s.settings.mode);
  const account=useApp((s)=>s.session?.loginid);
  const filtered = trades.filter((t)=>t.mode===mode&&(!account||t.accountLoginid===account)).slice(0,limit);
  return <BrokerTransactions records={filtered}/>;
}

export function ExportTrades() {
  const exportCsv=()=>{
    const mode=useApp.getState().settings.mode;
    const clean=(v:unknown)=>`"${String(v??'').replace(/^[=+@-]/,"'").replaceAll('"','""')}"`;
    const account=useApp.getState().session?.loginid;
    const rows=useApp.getState().trades.filter((t)=>t.mode===mode&&(!account||t.accountLoginid===account)).map((t)=>[new Date(t.closedAt).toISOString(),t.id,t.strategyName,t.symbol,t.contractType,t.stake,t.profit,t.won,t.mode,t.source,t.accountLoginid??'Unattributed',t.contractId??'',t.entryPrice??'',t.exitPrice??'',t.duration??'']);
    const csv=[['closed_at','id','strategy','symbol','contract','stake','profit','won','mode','source','account','contract_id','entry_spot','exit_spot','duration'],...rows].map((r)=>r.map(clean).join(',')).join('\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='ultratrading-trades.csv';a.click();URL.revokeObjectURL(url);
  };
  return <Button variant="secondary" onClick={exportCsv}><Download size={15}/>Export CSV</Button>;
}
