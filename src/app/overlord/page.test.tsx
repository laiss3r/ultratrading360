// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_RISK_LIMITS } from '@/lib/engine/risk';
import type { Strategy } from '@/lib/engine/strategies';
const f=vi.hoisted(()=>({state:{} as Record<string,unknown>}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()})}));
vi.mock('@/state/store',()=>({useApp:Object.assign((select:(state:Record<string,unknown>)=>unknown)=>select(f.state),{getState:()=>f.state})}));
import OverlordPage from './page';
beforeEach(()=>{f.state={trades:[],executionJournal:[],sessionResets:{},symbols:[{underlying_symbol:'R_10',underlying_symbol_name:'Fixture Volatility 10',exchange_is_open:1,is_trading_suspended:0}],activeSymbol:'R_10',strategies:[],session:{loginid:'DOT_TEST',currency:'USD',isVirtual:true},botState:'idle',settings:{limits:DEFAULT_RISK_LIMITS},saveStrategy:vi.fn(async(s:Strategy)=>{f.state.strategies=[s];return {ok:true,message:'Saved'};}),setActiveStrategy:vi.fn(),runStrategy:vi.fn(async()=>({ok:false,message:'Trading is disabled.'}))};});
afterEach(cleanup);
describe('Overlord controls within the approved workspace',()=>{
  it('saves the selected parameters and requires explicit confirmation without enabling trading',async()=>{
    render(<OverlordPage/>);fireEvent.change(screen.getByLabelText('Duration'),{target:{value:'3'}});fireEvent.change(screen.getByLabelText('Target profit'),{target:{value:'5'}});fireEvent.click(screen.getByRole('switch',{name:'Enable martingale'}));fireEvent.click(screen.getByRole('switch',{name:'Recovery mode — use a second contract'}));fireEvent.click(screen.getByRole('button',{name:'Run bot'}));
    await screen.findByRole('dialog');const saved=vi.mocked(f.state.saveStrategy as (s:Strategy)=>Promise<unknown>).mock.calls[0][0];expect(saved.duration).toBe(3);expect(saved.limits.maxSessionProfit).toBe(5);expect(saved.limits.tradingEnabled).toBe(false);expect(saved.progression?.kind).toBe('martingale');expect(saved.contractRotation?.recovery.contractType).toBe('DIGITOVER');expect(f.state.runStrategy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Confirm & run'}));await waitFor(()=>expect(f.state.runStrategy).toHaveBeenCalledTimes(1));expect(screen.getByRole('alert').textContent).toContain('Trading is disabled');
  });
  it('rejects an impossible barrier without saving or opening a run dialog',async()=>{
    render(<OverlordPage/>);fireEvent.change(screen.getByLabelText('Contract type'),{target:{value:'DIGITOVER'}});fireEvent.change(screen.getByLabelText('Prediction digit'),{target:{value:'9'}});fireEvent.click(screen.getByRole('button',{name:'Run bot'}));await screen.findByRole('alert');expect(f.state.saveStrategy).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();
  });
});
