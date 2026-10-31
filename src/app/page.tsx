'use client';

import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Blocks, Bot, ChartNoAxesCombined, Radio, ShieldCheck, History, Workflow, BookOpen, Code2 } from 'lucide-react';
import { useApp } from '@/state/store';
import { Metric, Panel } from '@/components/ui';
import { MarketPanel, TradeTable, signed } from '@/components/Workspace';

const tools=[
  {href:'/builder',name:'Bot Builder',description:'Build your own trading rules',Icon:Blocks},
  {href:'/overlord',name:'Overlord Pro',description:'Explore strategy templates',Icon:Bot},
  {href:'/signals',name:'Signal Tools',description:'Understand the tick sample',Icon:Radio},
  {href:'/chart',name:'Trading Chart',description:'Watch real Deriv prices',Icon:ChartNoAxesCombined},
  {href:'/history',name:'Trade History',description:'Review settled contracts',Icon:History},
  {href:'/risk',name:'Risk Controls',description:'Set limits before you run',Icon:ShieldCheck},
];
export default function Dashboard(){
  const session=useApp((s)=>s.session);
  const snap=useApp((s)=>s.riskSnapshot);
  const count=useApp((s)=>s.strategies.length);
  return <div className="stack">
    <section className="hero"><div><span className="eyebrow">WELCOME TO YOUR TRADING WORKSPACE</span><h1>Your market.<br/>Your rules. <em>Your control.</em></h1><p>Build a strategy, follow the live market, and automate with clear limits. One Deriv account across every tool.</p><div className="button-row"><Link href="/builder" className="button button-primary">Build a strategy <ArrowRight size={15}/></Link><Link href="/overlord" className="button button-secondary">Explore bots</Link></div><span className="rebuild-badge"><ShieldCheck size={12}/>Real API connections. No simulated trading.</span></div><div className="hero-art"><Workflow/></div></section>
    <div><div className="section-label"><h2>Your trading toolkit</h2><Link href="/connect">Manage account ↗</Link></div><div className="tool-grid">{tools.map(({href,name,description,Icon})=><Link href={href} className="tool-card" key={href}><span className="tool-icon"><Icon size={23}/></span><div><h3>{name}</h3><p>{description}</p></div><ArrowUpRight size={15}/></Link>)}</div></div>
    <div className="metric-grid"><Metric label="Selected account" value={session?(session.isVirtual?'Demo':'Real'):'Not connected'} detail={session?.loginid??'Log in to load your accounts'}/><Metric label="Account balance" value={session?session.balance.toFixed(2):'—'} detail={session?.currency??'No account data yet'}/><Metric label="Session net P/L" value={signed(snap.sessionPnl)} positive={snap.sessionPnl>=0} detail={`${snap.tradesThisSession} settled entries`}/><Metric label="Saved strategies" value={count} detail="Stored in this browser"/></div>
    <MarketPanel/>
    <div className="equal-col"><Panel title="Start with a clear process" subtitle="Build → verify → run → review"><div className="community-list"><Link href="/builder"><div><strong>01 / Define your entry</strong><small>Choose a market, contract and condition.</small></div><ArrowRight size={15}/></Link><Link href="/risk"><div><strong>02 / Set hard limits</strong><small>Cap stake, session loss and trade count.</small></div><ArrowRight size={15}/></Link><Link href="/history"><div><strong>03 / Review actual outcomes</strong><small>Use settled Deriv responses, not assumptions.</small></div><ArrowRight size={15}/></Link></div></Panel>
    <Panel title="Built with the community" subtitle="Documentation and open-source references"><div className="community-list"><a href="https://github.com/deriv-com/trading-bot-template" target="_blank" rel="noreferrer"><Code2 size={20}/><div><strong>Deriv trading-bot template</strong><small>Account-scoped connection architecture</small></div><ArrowUpRight size={15}/></a><a href="https://developers.deriv.com/docs/" target="_blank" rel="noreferrer"><BookOpen size={20}/><div><strong>Deriv API documentation</strong><small>Authentication, contracts and market data</small></div><ArrowUpRight size={15}/></a><a href="https://360tradinghub.co.ke/" target="_blank" rel="noreferrer"><Workflow size={20}/><div><strong>360 Trading Hub</strong><small>Workspace and navigation reference</small></div><ArrowUpRight size={15}/></a></div></Panel></div>
    <Panel title="Recent activity" subtitle="Settled contracts recorded in this browser" action={<Link className="text-link" href="/history">View history →</Link>}><TradeTable limit={5}/></Panel>
  </div>;
}
