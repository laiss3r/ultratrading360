'use client';
import {useEffect,useMemo,useState} from 'react';
import {useApp} from '@/state/store';
import {BrokerTransactions} from '@/components/ExecutionConsole';
import {ExportTrades,signed} from '@/components/Workspace';
import {Metric,Notice,PageTitle,Panel,Field,Button} from '@/components/ui';
import {listTrades} from '@/lib/persistence/db';
import {filterTradeReport,type TradeFilter} from '@/lib/trade-report';
import {computeMetrics,breakdown} from '@/lib/metrics';
import type {TradeRecord} from '@/lib/engine/bot';

export default function HistoryPage(){
 const trades=useApp(s=>s.trades),mode=useApp(s=>s.settings.mode),session=useApp(s=>s.session);
 const [refresh,setRefresh]=useState(0);
 const [archive,setArchive]=useState<{account?:string;mode?:string;version?:number;rows:TradeRecord[];error:string}>({rows:[],error:''});
 const loading=archive.account!==session?.loginid||archive.mode!==mode||archive.version!==refresh,error=loading?'':archive.error;
 const [period,setPeriod]=useState<TradeFilter['period']>('all'),[outcome,setOutcome]=useState<TradeFilter['outcome']>('all'),[query,setQuery]=useState('');
 useEffect(()=>{let cancelled=false;void listTrades(Number.MAX_SAFE_INTEGER).then(rows=>{if(!cancelled)setArchive({account:session?.loginid,mode,version:refresh,rows,error:''});}).catch(()=>{if(!cancelled)setArchive({account:session?.loginid,mode,version:refresh,rows:[],error:'Full browser history could not be read. Showing currently loaded records only.'});});return ()=>{cancelled=true;};},[session?.loginid,mode,refresh]);
 const selected=useMemo(()=>filterTradeReport([...trades,...(loading?[]:archive.rows)],{account:session?.loginid,mode,currency:session?.currency,period,outcome,query}),[trades,archive.rows,loading,session?.loginid,session?.currency,mode,period,outcome,query]);
 const metrics=useMemo(()=>computeMetrics(selected),[selected]),strategies=useMemo(()=>breakdown(selected).byStrategy,[selected]);
 const legacy=trades.filter(t=>t.mode===mode&&!t.accountLoginid);
 return <div className="stack"><PageTitle eyebrow="YOUR ACTUAL CONTRACT OUTCOMES" title="Trade History" description="Review account-scoped results, payout economics and strategy performance." action={<ExportTrades records={selected} disabled={loading}/>}/>
  <Notice>This browser’s {mode==='deriv_demo'?'Demo':'Real'} ledger for {session?.loginid??'no selected account'} · {session?.currency??'no currency'}. It is not a full Deriv statement and does not synchronize across devices. This report combines the local-ledger snapshot with live app records; refresh it to re-read browser storage. Filters apply to all report totals and the CSV export; only the latest 100 matching contracts are shown in the transaction table.</Notice>
  {loading&&<Notice>Loading the full local ledger…</Notice>}{error&&<Notice tone="error">{error}</Notice>}
  <Panel title="Report filters" subtitle="Account and currency isolation always apply" action={<Button variant="secondary" disabled={loading} onClick={()=>setRefresh(n=>n+1)}>Refresh local history</Button>}><div className="form-grid"><Field label="Report period"><select value={period} onChange={e=>setPeriod(e.target.value as TradeFilter['period'])}><option value="all">All recorded history</option><option value="today">Today (UTC)</option><option value="7d">Last 7 UTC days</option><option value="30d">Last 30 UTC days</option></select></Field><Field label="Report outcome"><select value={outcome} onChange={e=>setOutcome(e.target.value as TradeFilter['outcome'])}><option value="all">All outcomes</option><option value="wins">Profits</option><option value="losses">Losses</option><option value="zero">Zero net</option><option value="errors">Errors / unconfirmed</option></select></Field><Field label="Search ledger"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Market, strategy or contract ID"/></Field></div></Panel>
  <div className="metric-grid"><Metric label="Settled contracts" value={metrics.settledCount} detail={`${metrics.errorCount} errors excluded`}/><Metric label="Net profit / loss" value={signed(metrics.netProfit)} positive={metrics.netProfit>=0} detail={session?.currency??'No account'}/><Metric label="Wins / losses / zero" value={`${metrics.wins} / ${metrics.losses} / ${metrics.zeroNet}`} detail="Zero net is not a loss"/><Metric label="Mean net per contract" value={metrics.settledCount?signed(metrics.expectedValuePerTrade):'—'} detail="Observed expectancy, not a prediction"/><Metric label="Profit factor" value={metrics.profitFactor===null?'—':metrics.profitFactor===Infinity?'No losses':metrics.profitFactor.toFixed(2)} detail="Gross profits ÷ gross losses"/><Metric label="Net / paid stake" value={metrics.totalStaked?`${(metrics.netProfit/metrics.totalStaked*100).toFixed(2)}%`:'—'} detail="Not account-balance return"/></div>
  <Notice tone={metrics.netProfit<0?'warning':'info'}>{metrics.settledCount<100?'Small sample: these are descriptive results, not evidence of a profitable strategy.':'Past contract results do not establish a future edge.'} A high win rate can still lose money when payout is small or recovery stakes escalate.</Notice>
  <Panel title="Strategy review" subtitle="Same filtered, deduplicated terminal ledger"><div className="table-scroll"><table><thead><tr><th>Strategy</th><th>Settled</th><th>Net</th><th>Mean net</th><th>Profit factor</th></tr></thead><tbody>{strategies.map(s=><tr key={s.name}><td>{s.name}</td><td>{s.metrics.settledCount}</td><td>{signed(s.metrics.netProfit)}</td><td>{signed(s.metrics.expectedValuePerTrade)}</td><td>{s.metrics.profitFactor===null?'—':s.metrics.profitFactor===Infinity?'No losses':s.metrics.profitFactor.toFixed(2)}</td></tr>)}</tbody></table></div></Panel>
  <Panel title="Execution ledger" subtitle={`${selected.length} matching records · latest 100 displayed · CSV contains every matching record`}><div data-account-ledger><BrokerTransactions records={selected.slice(0,100)}/></div></Panel>
  {!!session?.loginid&&legacy.length>0&&<details className="panel"><summary className="panel-content">Older unassigned records ({legacy.length}) · excluded from this account’s totals</summary><div className="panel-content"><BrokerTransactions records={legacy}/></div></details>}
 </div>;
}
