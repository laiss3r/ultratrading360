'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, ArrowRight, Search, Square } from 'lucide-react';
import { templates, strategyFromTemplate } from '@/lib/frontend-templates';
import { CONTRACT_LABELS, DEFAULT_OVERLORD, eligibleMarkets, overlordStrategy, scanMarkets, type MarketObservation, type OverlordConfig } from '@/lib/overlord';
import { ContractService, type ContractType } from '@/lib/deriv/contracts';
import { useApp } from '@/state/store';
import { Button, Field, Notice, PageTitle, Panel, Empty, Toggle, Metric } from '@/components/ui';
import { RunButton } from '@/components/Workspace';

export default function OverlordPage() {
  const router = useRouter();
  const symbols = useApp((s) => s.symbols);
  const activeSymbol = useApp((s) => s.activeSymbol);
  const strategies = useApp((s) => s.strategies);
  const botState = useApp((s) => s.botState);
  const bot = useApp((s) => s.bot);
  const botDetail = useApp((s) => s.botDetail);
  const snapshot = useApp((s) => s.riskSnapshot);
  const session = useApp((s) => s.session);
  const limits = useApp((s) => s.settings.limits);
  const [config, setConfig] = useState<OverlordConfig>({ ...DEFAULT_OVERLORD });
  const [selected, setSelected] = useState<string[] | null>(null);
  const [observations, setObservations] = useState<MarketObservation[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [now, setNow] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const draftId = useRef<string | null>(null);
  const markets = eligibleMarkets(symbols).slice(0, 20);
  const running = ['starting','running','paused','stopping'].includes(botState);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10000); return () => { clearInterval(timer); controller.current?.abort(); }; }, []);
  const change = (patch: Partial<OverlordConfig>) => {
    setSavedMessage('');
    setConfig((current) => ({ ...current, ...patch }));
    if ('contractType' in patch || 'barrier' in patch || 'duration' in patch) {
      controller.current?.abort(); setScanning(false); setObservations([]); setFailures([]); setProgress('');
    }
  };
  const find = async () => {
    const provider = useApp.getState().provider;
    if (!provider?.isConnected()) { setMessage('Connect to the Deriv market feed before scanning.'); return; }
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    setScanning(true); setMessage(''); setObservations([]); setFailures([]); setProgress('Requesting actual Deriv history…');
    try {
      const result = await scanMarkets(provider, markets.filter((s) => selected === null || selected.includes(s.underlying_symbol)), config.contractType, config.barrier, config.duration, abort.signal, (done,total) => { if (!abort.signal.aborted) setProgress(`${done} / ${total} markets checked`); });
      if (abort.signal.aborted || useApp.getState().provider !== provider) return;
      setObservations(result.results); setFailures(result.failures); setNow(result.results[0]?.scannedAt ?? 0);
      if (result.results.length && !['starting','running','paused','stopping'].includes(useApp.getState().botState)) {
        // Explicit contrarian sample ordering, not a next-tick prediction.
        void useApp.getState().selectSymbol(result.results[0].symbol);
      } else if (!result.results.length) setMessage('No market returned enough usable history. No result was generated.');
    } catch (e) { if (!abort.signal.aborted) setMessage((e as Error).message); }
    finally { if (controller.current === abort) setScanning(false); }
  };
  const prepare = async () => {
    if (scanning) throw new Error('Finish or cancel the market scan before preparing a bot.');
    const state = useApp.getState();
    if (state.bot?.hasPendingOrder() || ['starting','running','paused','stopping'].includes(state.botState)) throw new Error('Stop the active bot and wait for its contract to settle before preparing another.');
    if (!eligibleMarkets(state.symbols).some((s) => s.underlying_symbol === state.activeSymbol)) throw new Error('Choose an open volatility market returned by Deriv.');
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
  const best = observations[0]; const expired = best ? now - best.scannedAt >= 60000 : false;
  return <div className="stack">
    <PageTitle eyebrow="CONFIGURE · OBSERVE · AUTOMATE" title="Overlord Pro" description="Continuous, sequential trading with an optional recovery contract and capped stake progression."/>
    <Notice tone="warning">No market is guaranteed to win. Find Market describes recent history, not future accuracy. Martingale can increase losses rapidly. Start with Demo.</Notice>
    {message && <Notice tone="error">{message}</Notice>}{savedMessage && <Notice tone="success">{savedMessage}</Notice>}
    {bot?.strategy.name.startsWith('Overlord ·') && <Panel title="Current bot session" subtitle={`${botState} · ${bot.strategy.market} · ${session?.loginid ?? 'Disconnected'}`}>
      <div className="three-col"><Metric label="Session net P/L" value={`${snapshot.sessionPnl>=0?'+':''}${snapshot.sessionPnl.toFixed(2)}`} detail={`${session?.currency ?? ''} · settled broker outcomes`}/><Metric label="Settled entries" value={snapshot.tradesThisSession}/><Metric label="Open exposure" value={snapshot.openExposure.toFixed(2)}/></div>
      {botDetail && <Notice tone={botState==='halted'||botState==='error'?'warning':'info'}>{botDetail}</Notice>}
    </Panel>}
    <Panel title="Trading setup" subtitle="Choose your contract and an actual Deriv volatility market">
      <div className="form-grid">
        <Field label="Contract type"><select value={config.contractType} disabled={running} onChange={(e) => change({contractType:e.target.value as ContractType})}>{contractOptions}</select></Field>
        <Field label="Market"><select value={activeSymbol} disabled={running || scanning} onChange={(e) => void useApp.getState().selectSymbol(e.target.value)}>{!markets.some((s) => s.underlying_symbol === activeSymbol) && <option value={activeSymbol}>{activeSymbol} · awaiting market discovery</option>}{markets.map((s) => <option key={s.underlying_symbol} value={s.underlying_symbol}>{s.underlying_symbol_name}</option>)}</select></Field>
        {ContractService.requiresBarrier(config.contractType) && <Field label="Prediction digit"><input type="number" min="0" max="9" step="1" disabled={running} value={config.barrier} onChange={(e) => change({barrier:Number(e.target.value)})}/></Field>}
        {numberField('Initial stake','stake',limits.minStake,limits.maxStake,'.01')}
        <Field label="Duration"><select value={config.duration} disabled={running} onChange={(e) => change({duration:Number(e.target.value)})}>{Array.from({length:10},(_,i) => <option value={i+1} key={i}>{i+1} {i===0?'tick':'ticks'}</option>)}</select></Field>
        {numberField('Target profit','targetProfit',.01,undefined,'.01')}
        {numberField('Stop loss','stopLoss',.01,undefined,'.01')}
        {numberField('Maximum entries','maxTrades',1,10000)}
      </div>
      <p className="micro muted">Amounts use {session?.currency ?? 'the selected account currency'}. Global Risk settings may impose stricter caps. Open contracts can settle after Stop.</p>
    </Panel>
    <Panel title="Find Market" subtitle="Reference-style contrarian ordering: lowest observed contract occurrence first" action={<Button variant="secondary" busy={scanning} disabled={running || !markets.length} onClick={() => void find()}><Search size={14}/>Find market</Button>}>
      <details><summary className="micro">Choose markets to scan ({selected?.length ?? markets.length})</summary><div className="button-row" style={{marginTop:14}}>{markets.map((s) => <label className="micro" key={s.underlying_symbol}><input type="checkbox" style={{width:'auto',marginRight:6}} checked={selected === null || selected.includes(s.underlying_symbol)} disabled={running || scanning} onChange={(e) => {const ids=selected ?? markets.map((m)=>m.underlying_symbol);setSelected(e.target.checked?[...ids,s.underlying_symbol]:ids.filter((id)=>id!==s.underlying_symbol));setObservations([]);}}/>{s.underlying_symbol_name}</label>)}</div></details>
      {scanning && <div className="button-row" style={{marginTop:15}}><p role="status" className="micro">{progress}</p><Button variant="ghost" onClick={() => {controller.current?.abort();setScanning(false);setProgress('Scan cancelled.');}}>Cancel scan</Button></div>}
      {!best && !scanning && <Empty title="No scan result">Scans request 300 actual historical ticks per selected market. No generated prices or confidence scores.</Empty>}
      {best && <div className="stack" style={{marginTop:18}}><Notice tone={expired?'warning':'info'}>{expired?'Sample expired — scan again for a current comparison.':`Sample comparison complete · ${observations.length} markets checked.`} Lowest observed occurrence: <strong>{best.name}</strong>. A rare past outcome is not “due” next.</Notice>
        <div className="table-scroll"><table><thead><tr><th>Market</th><th>Observed frequency</th><th>95% interval</th><th>Observations</th><th/></tr></thead><tbody>{observations.map((r) => <tr key={r.symbol}><td>{r.name}</td><td>{(r.rate*100).toFixed(1)}%{r.baseline!==null && <small className="muted"> · {(r.baseline*100).toFixed(0)}% uniform-digit baseline</small>}</td><td>{(r.lower*100).toFixed(1)}–{(r.upper*100).toFixed(1)}%</td><td>{r.hits} / {r.sample}</td><td><Button variant="ghost" disabled={running || expired || scanning} onClick={() => void useApp.getState().selectSymbol(r.symbol)}>{activeSymbol===r.symbol?'Selected':'Use market'}</Button></td></tr>)}</tbody></table></div>
        <p className="micro muted">Non-overlapping {config.duration}-tick observations · {new Date(best.from*1000).toLocaleTimeString()}–{new Date(best.to*1000).toLocaleTimeString()}. Wilson intervals assume independent observations, which tick data may not satisfy. Scanning many markets introduces selection bias. No next-trade probability or profitability is claimed.</p>
      </div>}
      {failures.length>0 && <Notice tone="warning">{failures.length} market(s) could not be measured: {failures.join('; ')}</Notice>}
    </Panel>
    <Panel title="Recovery & stake progression" subtitle="Contract switching and stake escalation are independent; neither guarantees recovery">
      <div className="stack"><Toggle label="Recovery mode — use a second contract" checked={config.recoveryEnabled} disabled={running} onChange={(value) => change({recoveryEnabled:value})}/>
        {config.recoveryEnabled && <div className="form-grid"><Field label="Recovery contract"><select disabled={running} value={config.recoveryContract} onChange={(e) => change({recoveryContract:e.target.value as ContractType})}>{contractOptions}</select></Field>{ContractService.requiresBarrier(config.recoveryContract) && <Field label="Recovery prediction digit"><input type="number" min="0" max="9" value={config.recoveryBarrier} disabled={running} onChange={(e) => change({recoveryBarrier:Number(e.target.value)})}/></Field>}<Field label="Recovery setting"><select value={config.recoveryMode} disabled={running} onChange={(e) => change({recoveryMode:e.target.value as OverlordConfig['recoveryMode']})}><option value="return-after-recovery">Return after a recovery win</option><option value="switch-on-loss">Switch contracts on loss</option><option value="alternate">Alternate contracts</option></select></Field>{config.recoveryMode==='alternate' && numberField('Settled entries per leg','alternateTimes',1,5)}</div>}
        <p className="micro muted">Return after a recovery win: primary until a non-win, then recovery until a positive settlement. Switch on loss: change leg only on a non-win. Alternate: change leg after the chosen number of settlements. Zero profit counts as a non-win.</p>
        <Toggle label="Enable martingale" checked={config.martingale} disabled={running} onChange={(value) => change({martingale:value})}/>
        {config.martingale && <><div className="form-grid">{numberField('Multiplier','multiplier',1.01,10,'.01')}{numberField('Maximum escalation steps','maxSteps',1,10)}</div><Notice tone="warning">Next requested stake = initial stake × multiplier raised to consecutive non-wins, up to the step cap; a win resets it. The risk manager caps the final amount at {limits.maxStake} {session?.currency ?? ''} or a stricter strategy/exposure limit. Losses can accumulate even at the cap.</Notice></>}
        <div className="button-row">{running ? <Button variant="danger" onClick={() => useApp.getState().stopBot('Overlord stopped by user')}><Square size={14}/>Stop bot</Button> : <RunButton prepare={prepare}>Run bot</RunButton>}<Button variant="secondary" disabled={running} onClick={() => void prepare().then(() => {setMessage('');setSavedMessage('Setup saved. Saving does not place orders.');}).catch((e:Error) => setMessage(e.message))}>Save setup</Button></div>
        <p className="micro muted">Run opens an account/stake confirmation before execution. Trading permission and Real acknowledgement remain in Risk settings. Keep this browser tab open; reloading does not auto-resume a bot.</p>
      </div>
    </Panel>
    <details className="panel"><summary className="panel-content"><strong>Editable strategy templates</strong><span className="micro muted"> · Existing templates remain available</span></summary><div className="panel-content three-col">{templates.map((t) => <article className="strategy-card" key={t.id}><header><span className="template-icon"><Bot size={23}/></span><span className="badge badge-neutral">{t.family}</span></header><h3>{t.name}</h3><p>{t.description}</p><Button variant="secondary" onClick={() => void loadTemplate(t.id)}>Customize template <ArrowRight size={14}/></Button></article>)}</div></details>
    <Panel title="Your saved bots" subtitle="Saving never starts automation">{strategies.length ? <div className="stack">{strategies.map((s) => <div className="button-row space-between" key={s.id}><div><strong>{s.name}</strong><p className="micro muted">{s.market} · {s.contractType} · v{s.version}</p></div><div className="button-row"><Button variant="secondary" onClick={() => {useApp.getState().setActiveStrategy(s.id);router.push('/builder');}}>Edit</Button><RunButton strategyId={s.id}/></div></div>)}</div> : <Empty title="No saved bots">Save a setup or choose a template.</Empty>}</Panel>
  </div>;
}
