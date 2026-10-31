'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, ArrowRight, SlidersHorizontal } from 'lucide-react';
import { templates, strategyFromTemplate } from '@/lib/frontend-templates';
import { useApp } from '@/state/store';
import { Button, Notice, PageTitle, Panel, Empty } from '@/components/ui';
import { RunButton } from '@/components/Workspace';

export default function OverlordPage(){
  const router=useRouter();const strategies=useApp((s)=>s.strategies);
  const [filter,setFilter]=useState('All');const [message,setMessage]=useState('');const [pending,setPending]=useState('');
  const load=async(id:string)=>{setPending(id);setMessage('');try{const s=strategyFromTemplate(id);s.market=useApp.getState().activeSymbol;s.currency=useApp.getState().session?.currency??'USD';const result=await useApp.getState().saveStrategy(s);if(!result.ok){setMessage(result.message);return;}useApp.getState().setActiveStrategy(s.id);router.push('/builder');}catch(e){setMessage((e as Error).message);}finally{setPending('');}};
  return <div className="stack"><PageTitle eyebrow="COMMUNITY-INSPIRED AUTOMATION" title="Overlord Pro" description="Start with an understandable template. Inspect every condition and limit before you run."/><Notice tone="warning">These are editable strategy patterns, not profitable signals. No template guarantees an edge. Test on Demo first.</Notice>
    <div className="button-row">{['All','Digits','Indicators'].map((x)=><Button variant={filter===x?'primary':'secondary'} onClick={()=>setFilter(x)} key={x}>{x}</Button>)}</div>{message&&<Notice tone="error">{message}</Notice>}
    <div className="three-col">{templates.filter((t)=>filter==='All'||t.family===filter).map((t)=><article className="strategy-card" key={t.id}><header><span className="template-icon"><Bot size={23}/></span><span className="badge badge-neutral">{t.family}</span></header><div><h3>{t.name}</h3><span className="micro muted">{t.contract} · Flat stake</span></div><p>{t.description}</p><div className="strategy-spec"><span>Explicit confirmation</span><span>Risk limited</span></div><Button variant="secondary" busy={pending===t.id} disabled={Boolean(pending)} onClick={()=>void load(t.id)}><SlidersHorizontal size={14}/>Customize template <ArrowRight size={14}/></Button></article>)}</div>
    <Panel title="Your saved bots" subtitle="Saving never starts an automation">{strategies.length?<div className="stack">{strategies.map((s)=><div className="button-row space-between" key={s.id}><div><strong>{s.name}</strong><p className="micro muted">{s.market} · {s.contractType} · v{s.version}</p></div><div className="button-row"><Button variant="secondary" onClick={()=>{useApp.getState().setActiveStrategy(s.id);router.push('/builder');}}>Edit</Button><RunButton strategyId={s.id}/></div></div>)}</div>:<Empty title="No saved bots">Choose a template or build a strategy from scratch.</Empty>}</Panel>
  </div>;
}
