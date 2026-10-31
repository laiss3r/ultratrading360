'use client';

import { useMemo, useState } from 'react';
import { useApp } from '@/state/store';
import { chiSquareUniformity, digitFrequency, runsTest, ljungBox } from '@/lib/stats/tests';
import { DigitDistribution, MarketSelect } from '@/components/Workspace';
import { LiveSignals } from '@/components/LiveSignals';
import { CONTRACT_LABELS } from '@/lib/overlord';
import { ContractService, type ContractType } from '@/lib/deriv/contracts';
import { Field, Empty, Metric, Notice, PageTitle, Panel } from '@/components/ui';

export default function SignalsPage(){
  const [contract,setContract]=useState<ContractType>('DIGITEVEN'),[barrier,setBarrier]=useState(4),[duration,setDuration]=useState(1);
  const digits=useApp((s)=>s.digits);const symbol=useApp((s)=>s.activeSymbol);
  const sample=digits.slice(-1000);
  const results=useMemo(()=>sample.length>=50?[chiSquareUniformity(sample),runsTest(sample.map((d)=>d%2===0)),ljungBox(sample,5)]:[],[sample]);
  const frequencies=digitFrequency(sample);
  const highest=sample.length?frequencies.reduce((a,b)=>a.count>=b.count?a:b):null;
  const even=sample.filter((d)=>d%2===0).length;
  return <div className="stack"><PageTitle eyebrow="OBSERVE. MEASURE. QUESTION." title="Signal Tools" description="Statistics from the actual Deriv tick sample—not promises about the next outcome." action={<MarketSelect/>}/>
    <Panel title="Contract-specific live scanner" subtitle="The same qualification rules used by Overlord entries"><div className="form-grid"><Field label="Signal contract"><select value={contract} onChange={(e)=>setContract(e.target.value as ContractType)}>{Object.entries(CONTRACT_LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field>{ContractService.requiresBarrier(contract)&&<Field label="Signal prediction"><input type="number" min="0" max="9" value={barrier} onChange={(e)=>setBarrier(Number(e.target.value))}/></Field>}<Field label="Signal duration"><select value={duration} onChange={(e)=>setDuration(Number(e.target.value))}>{Array.from({length:10},(_,i)=><option key={i} value={i+1}>{i+1} ticks</option>)}</select></Field></div></Panel>
    <LiveSignals contractType={contract} barrier={barrier} duration={duration}/>
    <div className="metric-grid"><Metric label="Market" value={symbol} detail="Current shared market"/><Metric label="Observed digits" value={sample.length} detail="Most recent 1,000 at most"/><Metric label="Even / Odd" value={sample.length?`${(even/sample.length*100).toFixed(0)} / ${(100-even/sample.length*100).toFixed(0)}%`:'—'} detail="Observed sample distribution"/><Metric label="Most frequent digit" value={highest?highest.digit:'—'} detail={highest?`${highest.count} observations`:'Waiting for Deriv ticks'}/></div>
    <Panel title="Last-digit distribution" subtitle="Each bar is a measured frequency"><DigitDistribution/></Panel>
    <div className="equal-col"><Panel title="Latest tick digits" subtitle="Oldest → newest"><div className="latest-ticks">{sample.length?sample.slice(-24).map((digit,i)=><span key={i} className="tick-digit">{digit}</span>):<Empty title="No observed digits yet"/>}</div><p className="micro muted">A streak is an observation. It does not make the opposite outcome due.</p></Panel>
    <Panel title="Statistical checks" subtitle="Exploratory results; no multiplicity-adjusted trading claim">{results.length?results.map((r)=><div className="test-result" key={r.name}><header><strong className="micro">{r.name}</strong><span className="badge badge-neutral">p = {Number.isFinite(r.pValue)?r.pValue.toFixed(4):'—'}</span></header><p>{r.interpretation}</p></div>):<Empty title="Collecting a larger sample">These checks need at least 50 observations. More data is preferable.</Empty>}</Panel></div>
    <Notice tone="warning">An unusual distribution is not proof of predictive power. Testing several patterns also increases false positives. Prices, payouts, fees and out-of-sample results matter.</Notice>
  </div>;
}
