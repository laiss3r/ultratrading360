'use client';
import {useEffect,useRef} from 'react';
import Link from 'next/link';
import {ChevronDown} from 'lucide-react';
import {useApp} from '@/state/store';
import {ExecutionConsole,SessionDock} from './ExecutionConsole';
import {RunButton} from './Workspace';
import {Button,Toggle} from './ui';
function SessionSettings(){
 const settings=useApp(s=>s.settings),strategies=useApp(s=>s.strategies),active=useApp(s=>s.activeStrategyId),state=useApp(s=>s.botState),bot=useApp(s=>s.bot),session=useApp(s=>s.session),symbol=useApp(s=>s.activeSymbol),symbols=useApp(s=>s.symbols);
 const tradingLoginid=useApp(s=>s.tradingLoginid),connecting=useApp(s=>s.tradingConnecting),message=useApp(s=>s.tradingMessage);
 const locked=['starting','running','paused','stopping'].includes(state)||(bot?.hasPendingOrder()??false);
 return <details className="session-settings"><summary>Strategy & trading permissions</summary><div className="stack"><label>Strategy<select value={active??''} disabled={locked} onChange={e=>useApp.getState().setActiveStrategy(e.target.value)}><option value="">Choose a saved bot</option>{strategies.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><p className="micro muted">{symbols.find(s=>s.underlying_symbol===symbol)?.underlying_symbol_name??symbol} · {session?.loginid??'Not signed in'} · {settings.mode==='deriv_real'?'REAL':'DEMO'}</p><dl className="detail-list"><div><dt>Account trading channel</dt><dd>{session?.loginid&&tradingLoginid===session.loginid?'Verified':connecting?'Connecting…':'Not connected'}</dd></div></dl>{session?.loginid&&tradingLoginid!==session.loginid&&<><p className="micro">{message||'Reconnect this account before placing orders.'}</p><Button variant="secondary" busy={connecting} disabled={locked} onClick={()=>void useApp.getState().attachTradingSocket(session.isVirtual?'deriv_demo':'deriv_real')}>Reconnect trading channel</Button></>}<Toggle checked={settings.limits.tradingEnabled} onChange={v=>void useApp.getState().setSettings({limits:{...settings.limits,tradingEnabled:v}})} label="Allow order execution"/><p className="micro muted">Confirm & run grants execution permission. Real-money acknowledgement is account-specific. Signal, payout and risk checks always apply.</p></div></details>;
}
export function TradingSession(){
 const open=useApp(s=>s.runPanelOpen),active=useApp(s=>s.activeStrategyId),strategies=useApp(s=>s.strategies),bot=useApp(s=>s.bot),panel=useRef<HTMLDivElement>(null),lastFocus=useRef<HTMLElement|null>(null);
 useEffect(()=>{
  if(!open)return;
  lastFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const previous=document.body.style.overflow;document.body.style.overflow='hidden';panel.current?.focus();
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!document.querySelector('.confirm-dialog'))useApp.getState().setRunPanelOpen(false);};
  document.addEventListener('keydown',key);
  return()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',key);if(lastFocus.current?.isConnected)lastFocus.current.focus();};
 },[open]);
 const run=active?<RunButton strategyId={active}>Run bot</RunButton>:<Link className="button button-primary" href="/builder" onClick={()=>useApp.getState().setRunPanelOpen(false)}>Choose a bot</Link>;
 if(!open)return <div className="global-session-dock"><SessionDock runControl={run} onExpand={()=>useApp.getState().setRunPanelOpen(true)}/></div>;
 return <section className="global-session" id="trading-session-panel" aria-label="Trading session" ref={panel} tabIndex={-1}>
 <header className="session-workspace-header"><div><strong>Trading session</strong><small>{bot?.strategy.name??strategies.find(s=>s.id===active)?.name??'Select a bot to begin'}</small></div><button className="session-collapse" aria-label="Collapse trading session" aria-expanded={true} aria-controls="trading-session-panel" onClick={()=>useApp.getState().setRunPanelOpen(false)}><ChevronDown size={21}/><span>Collapse</span></button></header>
 <ExecutionConsole global runControl={run} settingsControl={<SessionSettings/>}/>
 </section>;
}
