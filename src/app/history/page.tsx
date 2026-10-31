'use client';

import { useApp } from '@/state/store';
import { ExportTrades, signed, TradeTable } from '@/components/Workspace';
import { Metric, Notice, PageTitle, Panel } from '@/components/ui';

export default function HistoryPage(){
  const trades=useApp((s)=>s.trades);const mode=useApp((s)=>s.settings.mode);const selected=trades.filter((t)=>t.mode===mode);const settled=selected.filter((t)=>!t.error);const net=settled.reduce((sum,t)=>sum+t.profit,0);
  return <div className="stack"><PageTitle eyebrow="YOUR ACTUAL CONTRACT OUTCOMES" title="Trade History" description="Inspect results returned by Deriv and recorded by this browser." action={<ExportTrades/>}/><Notice>Showing this browser’s {mode==='deriv_demo'?'Demo':'Real'} execution ledger. It is not a full Deriv statement and does not synchronize across devices. Real and Demo results are never combined.</Notice><div className="metric-grid"><Metric label="Settled contracts" value={settled.length} detail="Errors excluded"/><Metric label="Net profit / loss" value={signed(net)} positive={net>=0} detail="Observed contract results"/><Metric label="Wins / losses" value={`${settled.filter((t)=>t.won).length} / ${settled.filter((t)=>!t.won).length}`} detail="No estimated outcomes"/><Metric label="Total stake" value={settled.reduce((sum,t)=>sum+t.stake,0).toFixed(2)} detail="Current Demo/Real ledger"/></div><Panel title="Execution ledger" subtitle="Latest 100 records · CSV export includes all stored records for this environment"><TradeTable/></Panel></div>;
}
