// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {DEFAULT_SETTINGS} from '@/lib/persistence/db';
import {DEFAULT_OVERLORD} from '@/lib/overlord';
import {analyzeDigits,type DiscoveryRow} from '@/lib/overlord/discovery';
import type {Strategy} from '@/lib/engine/strategies';
const f=vi.hoisted(()=>({state:{} as Record<string,any>}));
vi.mock('@/state/store',()=>({useApp:Object.assign((selector:(s:any)=>unknown)=>selector(f.state),{getState:()=>f.state})}));
import {ScannedMarketRun} from './ScannedMarketRun';
const market={underlying_symbol:'R_10',underlying_symbol_name:'Volatility 10 Index',exchange_is_open:1 as const,is_trading_suspended:0 as const,market:'synthetic_index',submarket:'random_index',pip_size:2};
function row():DiscoveryRow{
 const analysis=analyzeDigits('R_10',Array.from({length:1000},(_,i)=>({symbol:'R_10',price:100+i%10/100,pipSize:2,digit:i%10,epoch:Math.floor(Date.now()/1000)-999+i,source:'deriv_history' as const})),[{contract_type:'DIGITUNDER',contract_category:'digits',contract_display:'Under',min_contract_duration:'1t',max_contract_duration:'10t',last_digit_range:[9]}],2);
 return {symbol:'R_10',name:market.underlying_symbol_name,phase:'ready',loaded:1000,analysis};
}
const config={...DEFAULT_OVERLORD,contractType:'DIGITEVEN' as const,barrier:4,duration:2,stake:3,targetProfit:17,stopLoss:11,maxTrades:7};
beforeEach(()=>{f.state={settings:DEFAULT_SETTINGS,session:{loginid:'DOT_SCANNED',currency:'EUR',isVirtual:true},activeSymbol:'R_25',strategies:[],botState:'idle',bot:null,selectSymbol:vi.fn(async(symbol:string)=>{f.state.activeSymbol=symbol;}),saveStrategy:vi.fn(async(s:Strategy)=>{f.state.strategies.push(s);return {ok:true};}),setActiveStrategy:vi.fn((id:string)=>{f.state.activeStrategyId=id;}),authorizeConfirmedRun:vi.fn(async()=>({ok:true})),runStrategy:vi.fn(async()=>{f.state.botState='starting';f.state.runPanelOpen=true;return {ok:true};})};});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function show(r=row(),disabled=false,expired=false){render(<ScannedMarketRun row={r} config={config} markets={[market]} disabled={disabled} expired={expired}/>);}
it('runs the clicked market best setup, not the selected market or contract, after confirmation',async()=>{
 show();fireEvent.click(screen.getByRole('button',{name:'Run market'}));await screen.findByRole('dialog');
 expect(f.state.selectSymbol).toHaveBeenCalledWith('R_10');const saved=f.state.saveStrategy.mock.calls[0][0];expect(saved).toMatchObject({market:'R_10',contractType:'DIGITUNDER',barrier:9,duration:2,stake:3,currency:'EUR',maxTrades:7});expect(saved.signalGate).toBeTruthy();expect(screen.getByRole('dialog').textContent).toContain('R_10');expect(screen.getByRole('dialog').textContent).toContain('DIGITUNDER');expect(f.state.runStrategy).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Confirm & run'}));await waitFor(()=>expect(f.state.runStrategy).toHaveBeenCalledWith(saved.id));expect(f.state.runPanelOpen).toBe(true);
});
it('rechecks stale results at click time even before the discovery clock rerenders',async()=>{const r=row();show(r);vi.spyOn(Date,'now').mockReturnValue((r.analysis!.to+61)*1000);fireEvent.click(screen.getByRole('button',{name:'Run market'}));await screen.findByText(/result has expired/);expect(f.state.saveStrategy).not.toHaveBeenCalled();});
it('blocks a result that expires while its confirmation is open',async()=>{const r=row();show(r);fireEvent.click(screen.getByRole('button',{name:'Run market'}));await screen.findByRole('dialog');vi.spyOn(Date,'now').mockReturnValue((r.analysis!.to+61)*1000);fireEvent.click(screen.getByRole('button',{name:'Confirm & run'}));await screen.findByText(/result has expired/);expect(f.state.authorizeConfirmedRun).not.toHaveBeenCalled();expect(f.state.runStrategy).not.toHaveBeenCalled();});
it.each(['running','paused','stopping','starting'])('cannot prepare another market while %s',async(state)=>{f.state.botState=state;show();fireEvent.click(screen.getByRole('button',{name:'Run market'}));await screen.findByText(/Stop the active bot/);expect(f.state.selectSymbol).not.toHaveBeenCalled();});
it('blocks an unresolved accepted contract even after the bot stops',async()=>{f.state.bot={hasPendingOrder:()=>true};show();fireEvent.click(screen.getByRole('button',{name:'Run market'}));await screen.findByText(/wait for settlement/);expect(f.state.saveStrategy).not.toHaveBeenCalled();});
it.each([[true,false],[false,true]])('disables Run for active trading or expired results (%s/%s)',(disabled,expired)=>{show(row(),disabled,expired);expect((screen.getByRole('button',{name:'Run market'}) as HTMLButtonElement).disabled).toBe(true);});
it('rejects duration mismatches rather than substituting unscanned settings',async()=>{const r=row();r.analysis!.duration=1;show(r);fireEvent.click(screen.getByRole('button',{name:'Run market'}));await screen.findByText(/Duration changed/);expect(f.state.saveStrategy).not.toHaveBeenCalled();});
it('does not run a different symbol if selection changes while confirmation is open',async()=>{show();fireEvent.click(screen.getByRole('button',{name:'Run market'}));await screen.findByRole('dialog');f.state.activeSymbol='R_25';fireEvent.click(screen.getByRole('button',{name:'Confirm & run'}));await screen.findByText(/Market selection changed/);expect(f.state.runStrategy).not.toHaveBeenCalled();});
