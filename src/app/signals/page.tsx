'use client';

import { useMemo } from 'react';
import { useApp } from '@/state/store';
import { chiSquareUniformity, digitFrequency, runsTest, ljungBox } from '@/lib/stats/tests';
import { DigitDistribution, MarketSelect } from '@/components/Workspace';
import { Empty, Metric, Notice, PageTitle, Panel } from '@/components/ui';

export default function SignalsPage(){
  const digits=useApp((s)=>s.digits);const symbol=useApp((s)=>s.activeSymbol);
  const sample=digits.slice(-1000);
  const results=useMemo(()=>sample.length>=50?[chiSquareUniformity(sample),runsTest(sample.map((d)=>d%2===0)),ljungBox(sample,5)]:[],[sample]);
  const frequencies=digitFrequency(sample);
  const highest=sample.length?frequencies.reduce((a,b)=>a.count>=b.count?a:b):null;
  const even=sample.filter((d)=>d%2===0).length;
  return <div className="stack"><PageTitle eyebrow="OBSERVE. MEASURE. QUESTION." title="Signal Tools" description="Statistics from the actual Deriv tick sample—not promises about the next outcome." action={<MarketSelect/>}/>
    <div className="metric-grid"><Metric label="Market" value={symbol} detail="Current shared market"/><Metric label="Observed digits" value={sample.length} detail="Most recent 1,000 at most"/><Metric label="Even / Odd" value={sample.length?`${(even/sample.length*100).toFixed(0)} / ${(100-even/sample.length*100).toFixed(0)}%`:'—'} detail="Observed sample distribution"/><Metric label="Most frequent digit" value={highest?highest.digit:'—'} detail={highest?`${highest.count} observations`:'Waiting for Deriv ticks'}/></div>
    <Panel title="Last-digit distribution" subtitle="Each bar is a measured frequency"><DigitDistribution/></Panel>
    <div className="equal-col"><Panel title="Latest tick digits" subtitle="Oldest → newest"><div className="latest-ticks">{sample.length?sample.slice(-24).map((digit,i)=><span key={i} className="tick-digit">{digit}</span>):<Empty title="No observed digits yet"/>}</div><p className="micro muted">A streak is an observation. It does not make the opposite outcome due.</p></Panel>
    <Panel title="Statistical checks" subtitle="Exploratory results; no multiplicity-adjusted trading claim">{results.length?results.map((r)=><div className="test-result" key={r.name}><header><strong className="micro">{r.name}</strong><span className="badge badge-neutral">p = {Number.isFinite(r.pValue)?r.pValue.toFixed(4):'—'}</span></header><p>{r.interpretation}</p></div>):<Empty title="Collecting a larger sample">These checks need at least 50 observations. More data is preferable.</Empty>}</Panel></div>
    <Notice tone="warning">An unusual distribution is not proof of predictive power. Testing several patterns also increases false positives. Prices, payouts, fees and out-of-sample results matter.</Notice>
  </div>;
}
