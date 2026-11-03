'use client';

import { useRef, useState } from 'react';
import { Download, Play } from 'lucide-react';
import { useApp } from '@/state/store';
import type {TradeRecord} from '@/lib/engine/bot';
import type { Quote } from '@/lib/engine/provider';
import { BrokerTransactions } from './ExecutionConsole';
import { Button, Empty, Notice, Panel, Toggle } from './ui';

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

/** The Run click is the explicit execution instruction; never a modal or an automatic login effect. */
export function RunButton({strategyId,prepare,disabled=false,beforeRun,children='Run strategy'}:{strategyId?:string;prepare?:()=>Promise<string>;disabled?:boolean;beforeRun?:()=>void;children?:string}){
 const hydrated=useApp(s=>s.hydrated),session=useApp(s=>s.session);
 const acknowledged=useApp(s=>s.settings.realTradingAcknowledged&&s.settings.acknowledgedAccountLoginid===s.session?.loginid);
 const [consent,setConsent]=useState({account:'',checked:false}),[pending,setPending]=useState(false),[message,setMessage]=useState('');
 const inFlight=useRef(false),needsConsent=!!session?.loginid&&!session.isVirtual&&!acknowledged;
 const checked=consent.account===session?.loginid&&consent.checked;
 const run=async()=>{
  if(disabled||hydrated===false||inFlight.current)return;
  inFlight.current=true;setPending(true);setMessage('');
  const account=useApp.getState().session?.loginid??'';
  try{
   if(needsConsent&&!checked){setMessage('Acknowledge real-money risk for this account before Run.');return;}
   const id=prepare?await prepare():strategyId;
   beforeRun?.();
   const permission=await useApp.getState().authorizeConfirmedRun(account,checked);
   if(!permission.ok){setMessage(permission.message);return;}
   beforeRun?.();
   const result=await useApp.getState().runStrategy(id??'');if(!result.ok)setMessage(result.message);
  }catch(error){setMessage((error as Error).message);}finally{inFlight.current=false;setPending(false);}
 };
 return <>{needsConsent&&<div className="inline-real-permission"><Toggle label="I acknowledge real-money risk for this selected account" checked={checked} onChange={value=>setConsent({account:session?.loginid??'',checked:value})}/><small>{session?.loginid} · permission applies only to this account</small></div>}<Button busy={pending} disabled={disabled||hydrated===false} onClick={()=>void run()}><Play size={14}/>{children}</Button>{message&&<Notice tone="error">{message}</Notice>}</>;
}

export function TradeTable({ limit = 100 }: { limit?: number }) {
  const trades = useApp((s)=>s.trades);
  const mode = useApp((s)=>s.settings.mode);
  const account=useApp((s)=>s.session?.loginid);
  const filtered = trades.filter((t)=>t.mode===mode&&(!!account&&t.accountLoginid===account)).slice(0,limit);
  return <BrokerTransactions records={filtered}/>;
}

export function ExportTrades({records,disabled=false}:{records?:TradeRecord[];disabled?:boolean}={}) {
  const exportCsv=()=>{
    const mode=useApp.getState().settings.mode;
    const clean=(v:unknown)=>{const raw=String(v??''),safe=typeof v==='string'&&/^\s*[=+@-]/.test(raw)?"'"+raw:raw;return `"${safe.replaceAll('"','""')}"`;};
    const account=useApp.getState().session?.loginid;
    const rows=(records??useApp.getState().trades).filter((t)=>t.mode===mode&&(!!account&&t.accountLoginid===account)).map((t)=>[new Date(t.closedAt).toISOString(),t.id,t.strategyName,t.symbol,t.contractType,t.stake,t.profit,t.won,t.mode,t.source,t.accountLoginid??'Unattributed',t.contractId??'',t.entryPrice??'',t.exitPrice??'',t.duration??'',t.currency??'',t.payout,t.error??'',t.timing?.proposalMs??'',t.timing?.buyAckMs??'',t.timing?.quoteToReceiptMs??'']);
    const csv=[['closed_at','id','strategy','symbol','contract','stake','profit','won','mode','source','account','contract_id','entry_spot','exit_spot','duration','currency','gross_payout','error','pricing_ms','buy_ack_ms','quote_to_receipt_ms'],...rows].map((r)=>r.map(clean).join(',')).join('\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download=`ultratrading-${account??'no-account'}-${mode}-trades.csv`;a.click();URL.revokeObjectURL(url);
  };
  return <Button variant="secondary" disabled={disabled} title={records?"Export all matching report records":"Export loaded account records; use History for the full filtered browser ledger"} onClick={exportCsv}><Download size={15}/>Export CSV</Button>;
}
