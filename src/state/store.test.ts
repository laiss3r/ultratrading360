import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/persistence/db',async(importOriginal)=>({...await importOriginal<typeof import('@/lib/persistence/db')>(),saveSettings:vi.fn(async()=>{})}));
import { useApp } from './store';
import { DEFAULT_SETTINGS } from '@/lib/persistence/db';
import { createStrategy } from '@/lib/engine/strategies';
import type { AuthSession } from '@/lib/deriv/types';
import type { MarketProvider } from '@/lib/engine/provider';
const baseline=useApp.getState();
const real:AuthSession={kind:'pat',loginid:'ROT1',currency:'USD',balance:0,isVirtual:false,scopes:['trade'],expiresAt:null};
beforeEach(()=>{useApp.setState({...baseline,settings:{...DEFAULT_SETTINGS,limits:{...DEFAULT_SETTINGS.limits}},log:[]},true);});
afterEach(()=>{useApp.setState(baseline,true);vi.unstubAllGlobals();});
describe('shared identity and execution boundary',()=>{
  it.each([false,true])('PAT uses returned virtual=%s identity and clears prior acknowledgement',async(isVirtual)=>{
    const applyMode=vi.fn(async()=>{});const refreshSession=vi.fn(async()=>{});
    useApp.setState({applyMode,refreshSession,settings:{...DEFAULT_SETTINGS,realTradingAcknowledged:true,acknowledgedAccountLoginid:'ROT1'}});
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({ok:true,session:{...real,isVirtual},accounts:[]}))));
    const result=await useApp.getState().connectWithPat('synthetic-token-only');
    expect(result.ok).toBe(true);expect(applyMode).toHaveBeenCalledWith(isVirtual?'deriv_demo':'deriv_real',false);
    expect(useApp.getState().settings.realTradingAcknowledged).toBe(false);expect(useApp.getState().settings.acknowledgedAccountLoginid).toBeNull();
  });
  it.each([null,'ANOTHER_ACCOUNT'])('never executes from a public or mismatched trading channel (%s)',async(tradingLoginid)=>{
    const strategy=createStrategy();
    useApp.setState({session:real,tradingLoginid,strategies:[strategy],provider:{isConnected:()=>true} as MarketProvider,settings:{...DEFAULT_SETTINGS,limits:{...DEFAULT_SETTINGS.limits,tradingEnabled:true}}});
    const result=await useApp.getState().runStrategy(strategy.id);
    expect(result.ok).toBe(false);expect(result.message).toContain('No verified trading connection');expect(useApp.getState().bot).toBeNull();
  });
  it('rejects acknowledgement belonging to another Real identity',async()=>{
    const strategy=createStrategy();
    useApp.setState({session:real,tradingLoginid:real.loginid,strategies:[strategy],provider:{isConnected:()=>true} as MarketProvider,settings:{...DEFAULT_SETTINGS,mode:'deriv_real',realTradingAcknowledged:true,acknowledgedAccountLoginid:'ROT_OTHER',limits:{...DEFAULT_SETTINGS.limits,tradingEnabled:true}}});
    expect((await useApp.getState().runStrategy(strategy.id)).message).toContain('not acknowledged');
  });
});
