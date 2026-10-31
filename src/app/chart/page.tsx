'use client';

import { useApp } from '@/state/store';
import { MarketPanel, DigitDistribution } from '@/components/Workspace';
import { Metric, PageTitle, Panel } from '@/components/ui';

export default function ChartPage(){
  const quotes=useApp((s)=>s.quotes);const symbol=useApp((s)=>s.activeSymbol);const prices=quotes.map((q)=>q.price);const pip=quotes.at(-1)?.pipSize??2;
  return <div className="stack chart-large"><PageTitle eyebrow="LIVE MARKET WORKSPACE" title="Trading Chart" description="One shared Deriv feed across your chart, analysis and automation. This is a tick chart, not synthetic candles."/><MarketPanel large/>
    <div className="metric-grid"><Metric label="Market" value={symbol} detail="Shared across all tools"/><Metric label="Sample high" value={prices.length?Math.max(...prices).toFixed(pip):'—'} detail="Buffered tick sample"/><Metric label="Sample low" value={prices.length?Math.min(...prices).toFixed(pip):'—'} detail="Buffered tick sample"/><Metric label="Quotes buffered" value={quotes.length} detail="Up to 1,200 observed quotes"/></div>
    <Panel title="Digit context" subtitle="Frequency of the most recent observed digits"><DigitDistribution/></Panel>
    <Panel title="Recent quotes" subtitle="Price and timestamps returned by Deriv"><div className="table-scroll"><table><thead><tr><th>Time</th><th>Symbol</th><th>Quote</th><th>Last digit</th><th>Source</th></tr></thead><tbody>{quotes.slice(-12).reverse().map((q,i)=><tr key={`${q.epoch}-${i}`}><td>{new Date(q.epoch*1000).toLocaleTimeString()}</td><td>{q.symbol}</td><td>{q.price.toFixed(q.pipSize)}</td><td>{q.digit}</td><td>{q.source==='deriv_live'?'Live tick':'Deriv history'}</td></tr>)}</tbody></table>{!quotes.length&&<p className="micro muted" style={{padding:18}}>No quotes received yet.</p>}</div></Panel>
  </div>;
}
