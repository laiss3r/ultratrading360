import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/persistence/db',async(importOriginal)=>({...await importOriginal<typeof import('@/lib/persistence/db')>(),saveSettings:vi.fn(async()=>{})}));
vi.mock('@/lib/deriv/browserLegacyWs',()=>({runClassicDiscovery:vi.fn()}));
import { runClassicDiscovery } from '@/lib/deriv/browserLegacyWs';
import { useApp } from './store';
import { DEFAULT_SETTINGS } from '@/lib/persistence/db';
import * as persistence from '@/lib/persistence/db';
import {TradingBot} from '@/lib/engine/bot';
import { createStrategy } from '@/lib/engine/strategies';
import type { AuthSession } from '@/lib/deriv/types';
import { DerivProvider, type MarketProvider } from '@/lib/engine/provider';
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
    expect(result.ok).toBe(!isVirtual);expect(applyMode).toHaveBeenCalledWith(isVirtual?'deriv_demo':'deriv_real',false);
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
  it('finishes a valid Demo-only listing without an unrelated legacy token handoff',async()=>{
    const fetchMock=setup([demo]);
    expect((await useApp.getState().syncBalances()).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);expect(runClassicDiscovery).not.toHaveBeenCalled();
    expect(useApp.getState().accounts).toEqual([demo]);expect(useApp.getState().session?.loginid).toBe(demo.loginid);
    expect(useApp.getState().settings.realTradingAcknowledged).toBe(false);
  });
  it('does not expose a token handoff when fresh REST already returns both environments',async()=>{
    const fetchMock=setup([demo,classicReal]);expect((await useApp.getState().syncBalances()).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);expect(runClassicDiscovery).not.toHaveBeenCalled();
  });
  it('retains rows and surfaces a real REST failure instead of fabricating a Real row',async()=>{
    setup([demo]);vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({ok:false,message:'Deriv temporarily unavailable'}),{status:502})));
    const result=await useApp.getState().syncBalances();expect(result.ok).toBe(false);expect(result.message).toContain('Deriv temporarily unavailable');expect(useApp.getState().accounts).toEqual([demo]);expect(useApp.getState().busy).toBeNull();expect(runClassicDiscovery).not.toHaveBeenCalled();
  });
  it('does not restart legacy discovery on a cached listing',async()=>{
    const fetchMock=setup([demo,classicReal],true);
    await useApp.getState().syncBalances();expect(runClassicDiscovery).not.toHaveBeenCalled();expect(fetchMock).toHaveBeenCalledTimes(1);
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

describe('visible account-channel diagnostics and safe reconnect',()=>{
 it('shows the broker socket refusal instead of silently remaining Not connected',async()=>{
  const demo={...real,loginid:'DOT1',isVirtual:true};
  useApp.setState({session:demo,bot:null,botState:'idle',tradingConnecting:false});
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({ok:false,message:'Deriv OTP service temporarily unavailable.'}),{status:502})));
  await useApp.getState().attachTradingSocket('deriv_demo');
  expect(useApp.getState().tradingMessage).toBe('Deriv OTP service temporarily unavailable.');expect(useApp.getState().tradingConnecting).toBe(false);expect(useApp.getState().tradingLoginid).toBeNull();
 });
 it('cannot replace a pending accepted contract with a reconnect',async()=>{
  const disconnect=vi.fn(),fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  useApp.setState({session:real,bot:{hasPendingOrder:()=>true} as never,provider:{disconnect} as unknown as MarketProvider,tradingConnecting:false});
  await useApp.getState().attachTradingSocket('deriv_real');expect(fetch).not.toHaveBeenCalled();expect(disconnect).not.toHaveBeenCalled();
 });
 it('ignores a late socket response belonging to a previous account',async()=>{
  let release!:(r:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>((resolve)=>{release=resolve;})));
  useApp.setState({session:real,bot:null,botState:'idle',tradingConnecting:false});
  const pending=useApp.getState().attachTradingSocket('deriv_real');
  useApp.setState({session:{...real,loginid:'ROT_NEW'},tradingConnecting:false,tradingMessage:'New account connection'});
  release(new Response(JSON.stringify({ok:false,message:'Old account error'}),{status:502}));await pending;
  expect(useApp.getState().tradingMessage).toBe('New account connection');
 });
});

it('does not delay account initialization behind market ranking',async()=>{
 const provider=new DerivProvider('deriv_demo');
 vi.spyOn(provider,'activeSymbols').mockResolvedValue([]);
 const rankMarkets=vi.fn(()=>new Promise<void>(()=>{}));
 useApp.setState({provider,rankMarkets});
 await useApp.getState().loadSymbols();expect(rankMarkets).toHaveBeenCalledOnce();
});

it('discards a delayed Demo refresh after the dropdown has selected Real',async()=>{
 const demo={...real,loginid:'DOT1',isVirtual:true};let release!:(r:Response)=>void;
 useApp.setState({session:demo,accounts:[{...demo},{...real}],bot:null,botState:'idle',busy:null,applyMode:vi.fn(async()=>{})});
 vi.stubGlobal('fetch',vi.fn((url:string)=>url.includes('session/select')?Promise.resolve(new Response(JSON.stringify({ok:true,session:real,accounts:[demo,real]}))):new Promise<Response>((resolve)=>{release=resolve;})));
 const refresh=useApp.getState().refreshSession(false);
 expect((await useApp.getState().selectAccount(real.loginid)).ok).toBe(true);
 release(new Response(JSON.stringify({authenticated:true,session:demo,accounts:[demo]})));await refresh;
 expect(useApp.getState().session?.loginid).toBe(real.loginid);expect(useApp.getState().accounts).toHaveLength(2);
});
it('finishes authentication without waiting for market/socket initialization',async()=>{
 const applyMode=vi.fn(()=>new Promise<void>(()=>{}));useApp.setState({applyMode});
 const result=await useApp.getState().finishAuthentication({session:real,accounts:[real]});
 expect(result.ok).toBe(true);expect(useApp.getState().session?.loginid).toBe(real.loginid);expect(applyMode).toHaveBeenCalledWith('deriv_real',false);
});

it('blocks execution with an authenticated credential but no selected account identity',async()=>{
 const strategy=createStrategy();useApp.setState({session:{...real,loginid:'',isVirtual:true},tradingLoginid:'',strategies:[strategy],provider:{mode:'deriv_demo',isConnected:()=>true} as MarketProvider,settings:{...DEFAULT_SETTINGS,limits:{...DEFAULT_SETTINGS.limits,tradingEnabled:true}}});
 expect((await useApp.getState().runStrategy(strategy.id)).ok).toBe(false);expect(useApp.getState().bot).toBeNull();
});
it('reports empty REST discovery without reopening sockets or leaving busy set',async()=>{
 useApp.setState({session:{...real,loginid:''},accounts:[]});
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({ok:true,accounts:[],message:'Migration pending',diagnostics:{httpStatus:200,returned:0,accepted:0,rejected:0,migration:'pending',legacyMappings:1,checkedAt:1}}))));
 const result=await useApp.getState().syncBalances();expect(result.message).toBe('Migration pending');expect(useApp.getState().session?.accountDiagnostics?.migration).toBe('pending');expect(useApp.getState().busy).toBeNull();expect(runClassicDiscovery).not.toHaveBeenCalled();
});

describe('explicit run confirmation permission handshake',()=>{
 const demo={...real,loginid:'DOT_CONFIRMED',isVirtual:true};
 it('enables Demo on explicit confirmation without pretending Real acknowledgement is required',async()=>{
  useApp.setState({session:demo,tradingLoginid:demo.loginid,bot:null,botState:'idle'});
  expect(useApp.getState().settings.limits.tradingEnabled).toBe(false);
  expect((await useApp.getState().authorizeConfirmedRun(demo.loginid,false)).ok).toBe(true);
  expect(useApp.getState().settings.limits.tradingEnabled).toBe(true);expect(useApp.getState().settings.realTradingAcknowledged).toBe(false);expect(useApp.getState().bot).toBeNull();
 });
 it('does not auto-acknowledge Real or enable it without the account-specific confirmation',async()=>{
  useApp.setState({session:real,tradingLoginid:real.loginid});
  expect((await useApp.getState().authorizeConfirmedRun(real.loginid,false)).ok).toBe(false);expect(useApp.getState().settings.limits.tradingEnabled).toBe(false);expect(useApp.getState().settings.realTradingAcknowledged).toBe(false);
  expect((await useApp.getState().authorizeConfirmedRun(real.loginid,true)).ok).toBe(true);expect(useApp.getState().settings.acknowledgedAccountLoginid).toBe(real.loginid);
 });
 it('refuses changed or empty account identities',async()=>{
  useApp.setState({session:demo,tradingLoginid:demo.loginid});expect((await useApp.getState().authorizeConfirmedRun('ROT_OLD',true)).ok).toBe(false);expect((await useApp.getState().authorizeConfirmedRun('',true)).ok).toBe(false);expect(useApp.getState().settings.limits.tradingEnabled).toBe(false);
 });
 it('connects and verifies the selected account rather than bypassing the broker gate',async()=>{
  const attachTradingSocket=vi.fn(async()=>{useApp.setState({tradingMessage:'Broker unavailable'});});useApp.setState({session:demo,tradingLoginid:null,attachTradingSocket});
  const result=await useApp.getState().authorizeConfirmedRun(demo.loginid,false);expect(attachTradingSocket).toHaveBeenCalledWith('deriv_demo');expect(result.ok).toBe(false);expect(result.message).toBe('Broker unavailable');expect(useApp.getState().bot).toBeNull();
 });
 it('respects emergency stop while the trading connection is being verified',async()=>{
  const attachTradingSocket=vi.fn(async()=>{useApp.setState({tradingLoginid:demo.loginid});await useApp.getState().setSettings({limits:{...useApp.getState().settings.limits,tradingEnabled:false}});});useApp.setState({session:demo,tradingLoginid:null,attachTradingSocket});
  expect((await useApp.getState().authorizeConfirmedRun(demo.loginid,false)).ok).toBe(false);expect(useApp.getState().settings.limits.tradingEnabled).toBe(false);
 });
});

it('a delayed workspace restoration cannot overwrite a permission the user has just enabled',async()=>{
 let release!:(value:typeof DEFAULT_SETTINGS)=>void;
 const read=vi.spyOn(persistence,'loadSettings').mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 useApp.setState({hydrated:false,loadConfig:vi.fn(async()=>{}),refreshSession:vi.fn(async()=>{}),startUpkeep:vi.fn(),applyMode:vi.fn(async()=>{})});
 try{
  const first=useApp.getState().hydrate();const second=useApp.getState().hydrate();
  await useApp.getState().setSettings({limits:{...DEFAULT_SETTINGS.limits,tradingEnabled:true}});
  release({...DEFAULT_SETTINGS,limits:{...DEFAULT_SETTINGS.limits,tradingEnabled:false}});await Promise.all([first,second]);
  expect(read).toHaveBeenCalledOnce();expect(useApp.getState().settings.limits.tradingEnabled).toBe(true);expect(useApp.getState().risk.limits.tradingEnabled).toBe(true);
 }finally{read.mockRestore();}
});
it('persists rapid permission changes in order so an older write cannot undo Stop',async()=>{
 let release!:()=>void;const save=vi.mocked(persistence.saveSettings);save.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
 const on=useApp.getState().setSettings({limits:{...DEFAULT_SETTINGS.limits,tradingEnabled:true}});
 await vi.waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
 const off=useApp.getState().setSettings({limits:{...DEFAULT_SETTINGS.limits,tradingEnabled:false}});
 expect(save).toHaveBeenCalledTimes(1);release();await Promise.all([on,off]);expect(save).toHaveBeenCalledTimes(2);expect(save.mock.calls[1][0].limits.tradingEnabled).toBe(false);expect(useApp.getState().settings.limits.tradingEnabled).toBe(false);
});

it('keeps the working market provider if authenticated balance verification fails',async()=>{
 const previous={isConnected:()=>true,disconnect:vi.fn()} as unknown as MarketProvider;
 useApp.setState({session:{...real,isVirtual:true,loginid:'DOT1'},provider:previous,tradingLoginid:null,bot:null,botState:'idle'});
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({ok:true,url:'ws://fixture/DOT1',loginid:'DOT1',mode:'deriv_demo'}))));
 const connect=vi.spyOn(DerivProvider.prototype,'connect').mockResolvedValue();const balance=vi.spyOn(DerivProvider.prototype,'streamBalance').mockRejectedValue(new Error('Invalid broker balance'));
 try{await useApp.getState().attachTradingSocket('deriv_demo');expect(useApp.getState().provider).toBe(previous);expect(previous.disconnect).not.toHaveBeenCalled();expect(useApp.getState().tradingLoginid).toBeNull();expect(useApp.getState().tradingMessage).toBe('Invalid broker balance');expect(useApp.getState().tradingConnecting).toBe(false);}finally{connect.mockRestore();balance.mockRestore();}
});
it('rejects an OTP response for another account before touching the existing market provider',async()=>{
 const previous={disconnect:vi.fn()} as unknown as MarketProvider;useApp.setState({session:{...real,isVirtual:true,loginid:'DOT1'},provider:previous});vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({ok:true,url:'ws://fixture/OTHER',loginid:'OTHER',mode:'deriv_demo'}))));await useApp.getState().attachTradingSocket('deriv_demo');expect(previous.disconnect).not.toHaveBeenCalled();expect(useApp.getState().provider).toBe(previous);expect(useApp.getState().tradingMessage).toContain('mismatched');
});

 describe('global session opening at the execution boundary',()=>{
 function setup(){const strategy=createStrategy();useApp.setState({session:real,tradingLoginid:real.loginid,strategies:[strategy],provider:{mode:'deriv_real',isConnected:()=>true} as MarketProvider,runPanelOpen:false,runPanelTab:'journal',settings:{...DEFAULT_SETTINGS,mode:'deriv_real',realTradingAcknowledged:true,acknowledgedAccountLoginid:real.loginid,limits:{...DEFAULT_SETTINGS.limits,tradingEnabled:true}}});return strategy;}
 it('opens Summary synchronously after preflight, before broker start resolves',async()=>{const s=setup();let release!:()=>void;const spy=vi.spyOn(TradingBot.prototype,'start').mockImplementation(()=>new Promise<void>(resolve=>{release=resolve;}));try{const pending=useApp.getState().runStrategy(s.id);expect(useApp.getState().runPanelOpen).toBe(true);expect(useApp.getState().runPanelTab).toBe('summary');expect(useApp.getState().activeStrategyId).toBe(s.id);release();await pending;}finally{spy.mockRestore();}});
 it('does not expand a rejected or mismatched account execution',async()=>{const s=setup();useApp.setState({tradingLoginid:'another-account'});expect((await useApp.getState().runStrategy(s.id)).ok).toBe(false);expect(useApp.getState().runPanelOpen).toBe(false);});
 it('retains the open workspace and exposes an actual startup failure',async()=>{const s=setup();const spy=vi.spyOn(TradingBot.prototype,'start').mockRejectedValue(new Error('History channel failed'));try{expect((await useApp.getState().runStrategy(s.id)).ok).toBe(false);expect(useApp.getState().runPanelOpen).toBe(true);expect(useApp.getState().botDetail).toBe('History channel failed');expect(useApp.getState().botState).toBe('error');}finally{spy.mockRestore();}});
 });
