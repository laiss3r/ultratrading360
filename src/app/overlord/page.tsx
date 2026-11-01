'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, ArrowRight, Square } from 'lucide-react';
import { templates, strategyFromTemplate } from '@/lib/frontend-templates';
import { CONTRACT_LABELS, DEFAULT_OVERLORD, overlordStrategy, type OverlordConfig } from '@/lib/overlord';
import { ContractService, type ContractType } from '@/lib/deriv/contracts';
import { useApp } from '@/state/store';
import { Button, Field, Notice, PageTitle, Panel, Empty, Toggle } from '@/components/ui';
import {ScannedMarketRun} from '@/components/ScannedMarketRun';
import { OverlordDiscovery } from '@/components/OverlordDiscovery';
import {volatilityMarkets,isAvailable} from '@/lib/overlord/discovery';
import type {ActiveSymbol} from '@/lib/deriv/types';
import { RunButton } from '@/components/Workspace';

export default function OverlordPage() {
  const router = useRouter();
  const symbols = useApp((s) => s.symbols);
  const activeSymbol = useApp((s) => s.activeSymbol);
  const strategies = useApp((s) => s.strategies);
  const botState = useApp((s) => s.botState);
  const session = useApp((s) => s.session);
  const limits = useApp((s) => s.settings.limits);
  const [config, setConfig] = useState<OverlordConfig>({ ...DEFAULT_OVERLORD });
  const [message, setMessage] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const draftId = useRef<string | null>(null);
  const [discoveredMarkets,setDiscoveredMarkets]=useState<ActiveSymbol[]|null>(null);
  const markets = volatilityMarkets(discoveredMarkets??symbols).filter(isAvailable);
  const running = ['starting','running','paused','stopping'].includes(botState);
  const change = (patch: Partial<OverlordConfig>) => {
    setSavedMessage('');setConfig((current)=>({...current,...patch}));
  };
  const prepare = async () => {
    const state = useApp.getState();
    if (state.bot?.hasPendingOrder() || ['starting','running','paused','stopping'].includes(state.botState)) throw new Error('Stop the active bot and wait for its contract to settle before preparing another.');
    if (!markets.some((s) => s.underlying_symbol === state.activeSymbol)) throw new Error('Choose an open volatility market returned by Deriv.');
    const strategy = overlordStrategy(config, state.activeSymbol, state.session?.currency ?? 'USD', state.settings.limits);
    if (draftId.current) strategy.id = draftId.current;
    const saved = await state.saveStrategy(strategy);
    if (!saved.ok) throw new Error(saved.message);
    draftId.current = strategy.id; useApp.getState().setActiveStrategy(strategy.id);
    return strategy.id;
  };
  const loadTemplate = async (id: string) => {
    try {
      const strategy = strategyFromTemplate(id); strategy.market = useApp.getState().activeSymbol; strategy.currency = session?.currency ?? 'USD';
      const saved = await useApp.getState().saveStrategy(strategy); if (!saved.ok) throw new Error(saved.message);
      useApp.getState().setActiveStrategy(strategy.id); router.push('/builder');
    } catch (e) { setMessage((e as Error).message); }
  };
  const contractOptions = Object.entries(CONTRACT_LABELS).map(([id,label]) => <option key={id} value={id}>{label}</option>);
  const numberField = (label: string, key: 'stake'|'targetProfit'|'stopLoss'|'maxTrades'|'multiplier'|'maxSteps'|'alternateTimes', min: number, max?: number, step = '1') => <Field label={label}><input type="number" min={min} max={max} step={step} value={config[key]} disabled={running} onChange={(e) => change({ [key]: Number(e.target.value) })}/></Field>;
  return <div className="stack">
    <PageTitle eyebrow="CONFIGURE · OBSERVE · AUTOMATE" title="Overlord Pro" description="Signal-gated trading with live pattern validation, an optional recovery contract and capped stake progression."/>
    <Notice tone="warning">Entries wait for qualified live evidence and broker payout checks on the selected Demo or Real account. No signal guarantees a win. Martingale can increase losses rapidly; Real trades risk actual money.</Notice>
    {message && <Notice tone="error">{message}</Notice>}{savedMessage && <Notice tone="success">{savedMessage}</Notice>}
    <Panel title="Bot session" subtitle="The shared Summary, Transactions and Journal workspace expands automatically after Confirm & run."><div className="button-row"><RunButton prepare={prepare}>Run bot</RunButton><Button variant="secondary" onClick={()=>useApp.getState().setRunPanelOpen(true)}>Open trading session</Button></div><p className="micro muted">Collapsing the workspace never stops trading or clears history. Use Stop to block future buys.</p></Panel>
    <Panel title="Trading setup" subtitle="Choose your contract and an actual Deriv volatility market">
      <div className="form-grid">
        <Field label="Contract type"><select value={config.contractType} disabled={running} onChange={(e) => change({contractType:e.target.value as ContractType})}>{contractOptions}</select></Field>
        <Field label="Market"><select value={activeSymbol} disabled={running} onChange={(e) => void useApp.getState().selectSymbol(e.target.value)}>{!markets.some((s) => s.underlying_symbol === activeSymbol) && <option value={activeSymbol}>Awaiting Volatility market discovery</option>}{markets.map((s) => <option key={s.underlying_symbol} value={s.underlying_symbol}>{s.underlying_symbol_name}</option>)}</select></Field>
        {ContractService.requiresBarrier(config.contractType) && <Field label="Prediction digit"><input type="number" min="0" max="9" step="1" disabled={running} value={config.barrier} onChange={(e) => change({barrier:Number(e.target.value)})}/></Field>}
        {numberField('Initial stake','stake',limits.minStake,limits.maxStake,'.01')}
        <Field label="Duration"><select value={config.duration} disabled={running} onChange={(e) => change({duration:Number(e.target.value)})}>{Array.from({length:10},(_,i) => <option value={i+1} key={i}>{i+1} {i===0?'tick':'ticks'}</option>)}</select></Field>
        {numberField('Target profit','targetProfit',.01,undefined,'.01')}
        {numberField('Stop loss','stopLoss',.01,undefined,'.01')}
        {numberField('Maximum entries','maxTrades',1,10000)}
      </div>
      <p className="micro muted">Amounts use {session?.currency ?? 'the selected account currency'}. Global Risk settings may impose stricter caps. Open contracts can settle after Stop.</p>
    </Panel>
    <OverlordDiscovery duration={config.duration} disabled={running} renderRun={(row,expired)=><ScannedMarketRun expired={expired} row={row} config={config} markets={markets} disabled={running} onPrepared={next=>{change(next);setSavedMessage('Scanned market’s best setup prepared. Confirm & run starts the session with live entry checks.');}}/>} onMarkets={setDiscoveredMarkets} onSelect={(symbol,opportunity)=>{change({contractType:opportunity.contractType,...(opportunity.barrier!==undefined?{barrier:opportunity.barrier}:{})});void useApp.getState().selectSymbol(symbol);setSavedMessage('Historical result applied to setup. No order was placed; Run still requires live entry checks.');}}/>
    <Panel title="Recovery & stake progression" subtitle="Contract switching and stake escalation are independent; neither guarantees recovery">
      <div className="stack"><Toggle label="Recovery mode — use a second contract" checked={config.recoveryEnabled} disabled={running} onChange={(value) => change({recoveryEnabled:value})}/>
        {config.recoveryEnabled && <div className="form-grid"><Field label="Recovery contract"><select disabled={running} value={config.recoveryContract} onChange={(e) => change({recoveryContract:e.target.value as ContractType})}>{contractOptions}</select></Field>{ContractService.requiresBarrier(config.recoveryContract) && <Field label="Recovery prediction digit"><input type="number" min="0" max="9" value={config.recoveryBarrier} disabled={running} onChange={(e) => change({recoveryBarrier:Number(e.target.value)})}/></Field>}<Field label="Recovery setting"><select value={config.recoveryMode} disabled={running} onChange={(e) => change({recoveryMode:e.target.value as OverlordConfig['recoveryMode']})}><option value="return-after-recovery">Return after a recovery win</option><option value="switch-on-loss">Switch contracts on loss</option><option value="alternate">Alternate contracts</option></select></Field>{config.recoveryMode==='alternate' && numberField('Settled entries per leg','alternateTimes',1,5)}</div>}
        <p className="micro muted">Return after a recovery win: primary until a non-win, then recovery until a positive settlement. Switch on loss: change leg only on a non-win. Alternate: change leg after the chosen number of settlements. Zero profit counts as a non-win.</p>
        <Toggle label="Enable martingale" checked={config.martingale} disabled={running} onChange={(value) => change({martingale:value})}/>
        {config.martingale && <><div className="form-grid">{numberField('Multiplier','multiplier',1.01,10,'.01')}{numberField('Maximum escalation steps','maxSteps',1,10)}</div><Notice tone="warning">Next requested stake = initial stake × multiplier raised to consecutive non-wins, up to the step cap; a win resets it. The risk manager caps the final amount at {limits.maxStake} {session?.currency ?? ''} or a stricter strategy/exposure limit. Losses can accumulate even at the cap.</Notice></>}
        <div className="button-row">{running ? <Button variant="danger" onClick={() => useApp.getState().stopBot('Overlord stopped by user')}><Square size={14}/>Stop bot</Button> : null}<Button variant="secondary" disabled={running} onClick={() => void prepare().then(() => {setMessage('');setSavedMessage('Setup saved. Saving does not place orders.');}).catch((e:Error) => setMessage(e.message))}>Save setup</Button></div>
        <p className="micro muted">Run opens an account/stake confirmation before execution. Trading permission and Real acknowledgement remain in Risk settings. Keep this browser tab open; reloading does not auto-resume a bot.</p>
      </div>
    </Panel>
    <details className="panel"><summary className="panel-content"><strong>Editable strategy templates</strong><span className="micro muted"> · Existing templates remain available</span></summary><div className="panel-content three-col">{templates.map((t) => <article className="strategy-card" key={t.id}><header><span className="template-icon"><Bot size={23}/></span><span className="badge badge-neutral">{t.family}</span></header><h3>{t.name}</h3><p>{t.description}</p><Button variant="secondary" onClick={() => void loadTemplate(t.id)}>Customize template <ArrowRight size={14}/></Button></article>)}</div></details>
    <Panel title="Your saved bots" subtitle="Saving never starts automation">{strategies.length ? <div className="stack">{strategies.map((s) => <div className="button-row space-between" key={s.id}><div><strong>{s.name}</strong><p className="micro muted">{s.market} · {s.contractType} · v{s.version}</p></div><div className="button-row"><Button variant="secondary" onClick={() => {useApp.getState().setActiveStrategy(s.id);router.push('/builder');}}>Edit</Button><RunButton strategyId={s.id}/></div></div>)}</div> : <Empty title="No saved bots">Save a setup or choose a template.</Empty>}</Panel>
  </div>;
}
