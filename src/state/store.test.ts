import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/persistence/db',async(importOriginal)=>({...await importOriginal<typeof import('@/lib/persistence/db')>(),saveSettings:vi.fn(async()=>{})}));
vi.mock('@/lib/deriv/browserLegacyWs',()=>({runClassicDiscovery:vi.fn()}));
import { runClassicDiscovery } from '@/lib/deriv/browserLegacyWs';
import { useApp } from './store';
import { DEFAULT_SETTINGS } from '@/lib/persistence/db';
import { createStrategy } from '@/lib/engine/strategies';
import type { AuthSession } from '@/lib/deriv/types';
import type { MarketProvider } from '@/lib/engine/provider';
const baseline=useApp.getState();
const real:AuthSession={kind:'pat',loginid:'ROT1',currency:'USD',balance:0,isVirtual:false,scopes:['trade'],expiresAt:null};
beforeEach(()=>{vi.clearAllMocks();useApp.setState({...baseline,settings:{...DEFAULT_SETTINGS,limits:{...DEFAULT_SETTINGS.limits}},log:[]},true);});
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
    useApp.setState({session:real,tradingLoginid,strategies:[strategy],provider:{mode:'deriv_real',isConnected:()=>true} as MarketProvider,settings:{...DEFAULT_SETTINGS,mode:'deriv_real',limits:{...DEFAULT_SETTINGS.limits,tradingEnabled:true}}});
    const result=await useApp.getState().runStrategy(strategy.id);
    expect(result.ok).toBe(false);expect(result.message).toContain('No verified trading connection');expect(useApp.getState().bot).toBeNull();
  });
  it('rejects acknowledgement belonging to another Real identity',async()=>{
    const strategy=createStrategy();
    useApp.setState({session:real,tradingLoginid:real.loginid,strategies:[strategy],provider:{mode:'deriv_real',isConnected:()=>true} as MarketProvider,settings:{...DEFAULT_SETTINGS,mode:'deriv_real',realTradingAcknowledged:true,acknowledgedAccountLoginid:'ROT_OTHER',limits:{...DEFAULT_SETTINGS.limits,tradingEnabled:true}}});
    expect((await useApp.getState().runStrategy(strategy.id)).message).toContain('not acknowledged');
  });
});


describe('incomplete account discovery regression',()=>{
  const demo={loginid:'DOT_TEST1',currency:'USD',balance:4171.41,isVirtual:true};
  const classicReal={loginid:'CR_TEST2',currency:'USD',balance:0,isVirtual:false};
  function setup(rows:typeof demo[],cached=false){
    useApp.setState({session:{...real,...demo},accounts:rows,refreshSession:vi.fn(async()=>{})});
    const fetchMock=vi.fn(async(url:string)=>new Response(JSON.stringify(url==='/api/deriv/accounts'?{ok:true,cached,accounts:rows}:{ok:true})));
    vi.stubGlobal('fetch',fetchMock);return fetchMock;
  }
  it('does not stop after a non-empty Demo-only REST listing',async()=>{
    const fetchMock=setup([demo]);vi.mocked(runClassicDiscovery).mockResolvedValue({ok:true,accounts:[classicReal],message:'Discovered'});
    expect((await useApp.getState().syncBalances()).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/deriv/handoff/refresh',expect.anything());expect(runClassicDiscovery).toHaveBeenCalledOnce();
    expect(useApp.getState().accounts).toEqual([demo,classicReal]);expect(useApp.getState().session?.loginid).toBe(demo.loginid);
    expect(useApp.getState().settings.realTradingAcknowledged).toBe(false);
  });
  it('does not expose a token handoff when fresh REST already returns both environments',async()=>{
    const fetchMock=setup([demo,classicReal]);expect((await useApp.getState().syncBalances()).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);expect(runClassicDiscovery).not.toHaveBeenCalled();
  });
  it('retains Demo and surfaces discovery failure rather than fabricating a Real row',async()=>{
    setup([demo]);vi.mocked(runClassicDiscovery).mockResolvedValue({ok:false,accounts:[],message:'Legacy authorization unavailable'});
    const result=await useApp.getState().syncBalances();expect(result.ok).toBe(false);expect(result.message).toContain('Legacy authorization unavailable');expect(useApp.getState().accounts).toEqual([demo]);expect(useApp.getState().busy).toBeNull();
  });
  it('keeps trying additional sources when a cached list contains both types',async()=>{
    setup([demo,classicReal],true);vi.mocked(runClassicDiscovery).mockResolvedValue({ok:true,accounts:[classicReal],message:'Updated'});
    await useApp.getState().syncBalances();expect(runClassicDiscovery).toHaveBeenCalledOnce();
  });
  it('does not overlap account operations',async()=>{
    const fetchMock=setup([demo]);useApp.setState({busy:'switch-account'});expect((await useApp.getState().syncBalances()).ok).toBe(false);expect(fetchMock).not.toHaveBeenCalled();expect(runClassicDiscovery).not.toHaveBeenCalled();
  });
});

describe('session reset and account mode integrity',()=>{
 it('blocks resetting or erasing history while an accepted contract is pending',async()=>{
  useApp.setState({bot:{hasPendingOrder:()=>true} as unknown as import('@/lib/engine/bot').TradingBot,botState:'stopped'});
  expect((await useApp.getState().resetSessionView()).ok).toBe(false);await expect(useApp.getState().clearTrades()).rejects.toThrow(/settlement/);
 });
 it('resets only the session display, never the historical ledger or journal',async()=>{
  const trade={id:'test'} as import('@/lib/engine/bot').TradeRecord;useApp.setState({trades:[trade],bot:null,botState:'halted',executionJournal:[]});expect((await useApp.getState().resetSessionView()).ok).toBe(true);expect(useApp.getState().trades).toEqual([trade]);expect(useApp.getState().botState).toBe('idle');
 });
});
