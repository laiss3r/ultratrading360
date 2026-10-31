import { describe, expect, it, vi } from 'vitest';
import { OrderCancelledError } from '../deriv/trading';
import { TradingBot } from './bot';
import { createStrategy, effectiveStrategyLimits } from './strategies';
import { DEFAULT_RECOVERY, DEFAULT_RISK_LIMITS, RiskManager } from './risk';
import { DEFAULT_OVERLORD, overlordStrategy } from '../overlord';
import type { MarketProvider, PriceRequest, PricedContract, Quote, SettledContract, ExecuteOptions } from './provider';
const flush=()=>new Promise((r)=>setTimeout(r,0));
function fixture(mode:'deriv_demo'|'deriv_real'='deriv_demo'){
  let tickIndex=0;
  let onQuote:((q:Quote)=>void)|null=null;
  const price=vi.fn(async(req:PriceRequest):Promise<PricedContract>=>({...req,symbol:req.symbol,stake:req.stake,payout:req.stake*1.95,askPrice:req.stake,source:'deriv_live'}));
  const execute=vi.fn(async(p:PricedContract,opts:ExecuteOptions):Promise<SettledContract>=>{if(opts.shouldExecute&&!opts.shouldExecute())throw new OrderCancelledError();return {won:true,stake:p.stake,payout:p.payout,profit:p.stake*.95,source:'deriv_live'};});
  const provider:MarketProvider={mode,source:'deriv_live',connect:async()=>{},disconnect:()=>{},isConnected:()=>true,history:async(_symbol,count)=>Array.from({length:count},(_,i)=>({symbol:'R_10',digit:i%2?8:1,price:100+(i%2?8:1)/100,epoch:Math.floor(Date.now()/1000)-count+i+1,pipSize:2,source:'deriv_history' as const})),stream:async(_symbol,handler)=>{onQuote=handler;return()=>{onQuote=null;};},price,execute};
  const push=()=>{const digit=tickIndex++%2?8:1;onQuote?.({symbol:'R_10',digit,price:100+digit/100,epoch:Math.floor(Date.now()/1000),pipSize:2,source:'deriv_live'});};
  return {provider,price,execute,push};
}
const global={...DEFAULT_RISK_LIMITS,tradingEnabled:true,maxDrawdownPct:0};
describe('Overlord genuine execution orchestration (scripted upstream)',()=>{
  it('uses settled outcomes for recovery switching and capped martingale without overlap',async()=>{
    const f=fixture();let index=0;let latest:unknown;f.execute.mockImplementation(async(p)=>{const won=index++>=2;return {won,stake:p.stake,payout:won?p.stake*1.95:0,profit:won?p.stake*.95:-p.stake,source:'deriv_live'};});
    const s=overlordStrategy({...DEFAULT_OVERLORD,martingale:true,recoveryEnabled:true,duration:3},'R_10','EUR',{...global,maxStake:3});s.cooldownSeconds=0;s.maxTrades=4;
    const risk=new RiskManager(effectiveStrategyLimits({...global,maxStake:3},s),DEFAULT_RECOVERY,10000);const bot=new TradingBot(s,f.provider,risk,{onSignal:(e)=>{latest=e;}},10000);await bot.start();
    for(let i=0;i<300&&bot.getTrades().length<4;i++){f.push();await flush();}
    expect(f.price.mock.calls.map(([r])=>r.contractType),JSON.stringify(latest)).toEqual(['DIGITEVEN','DIGITOVER','DIGITOVER','DIGITEVEN']);
    expect(f.price.mock.calls.map(([r])=>r.stake)).toEqual([1,2.1,3,1]);expect(f.price.mock.calls[0][0]).toMatchObject({duration:3,currency:'EUR'});expect(bot.getTrades().map((t)=>t.contractType)).toEqual(['DIGITEVEN','DIGITOVER','DIGITOVER','DIGITEVEN']);bot.stop();
  });
  it('waits for settlement despite rapid quotes and preserves a pending-order guard after Stop',async()=>{
    const f=fixture();let release!:(value:SettledContract)=>void;f.execute.mockImplementation(()=>new Promise((resolve)=>{release=resolve;}));
    const s=createStrategy({market:'R_10',cooldownSeconds:0,entry:{id:'root',op:'AND',children:[{id:'always',kind:'always'}]}});const risk=new RiskManager(global,DEFAULT_RECOVERY,1000);const bot=new TradingBot(s,f.provider,risk);await bot.start();f.push();await flush();for(let i=0;i<20;i++)f.push();await flush();expect(f.execute).toHaveBeenCalledTimes(1);bot.stop();expect(bot.hasPendingOrder()).toBe(true);release({won:true,stake:.35,payout:.68,profit:.33,source:'deriv_live'});await flush();expect(bot.hasPendingOrder()).toBe(false);expect(bot.state).toBe('stopped');expect(risk.getSnapshot().openExposure).toBe(0);
  });
  it('does not buy when stopped while the first proposal is pending',async()=>{
    const f=fixture();let release!:(p:PricedContract)=>void;f.price.mockImplementation(()=>new Promise((resolve)=>{release=resolve;}));const s=createStrategy({market:'R_10',cooldownSeconds:0,entry:{id:'r',op:'AND',children:[{id:'a',kind:'always'}]}});const bot=new TradingBot(s,f.provider,new RiskManager(global));await bot.start();f.push();await flush();bot.stop();release({stake:1,payout:1.95,askPrice:1,symbol:'R_10',contractType:'DIGITEVEN',source:'deriv_live'});await flush();expect(f.execute).not.toHaveBeenCalled();
  });
  it.each([true,false])('halts immediately at a profit/loss stop (win=%s)',async(win)=>{
    const f=fixture();f.execute.mockImplementation(async(p)=>({won:win,stake:p.stake,payout:win?1.95:0,profit:win?.95:-1,source:'deriv_live'}));const s=overlordStrategy({...DEFAULT_OVERLORD,targetProfit:.5,stopLoss:.5},'R_10','USD',global);s.cooldownSeconds=0;const bot=new TradingBot(s,f.provider,new RiskManager(effectiveStrategyLimits(global,s)));await bot.start();for(let i=0;i<100&&bot.state!=='halted';i++){f.push();await flush();}expect(bot.state).toBe('halted');f.push();await flush();expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it('does not deny an order because its own reservation fills the exposure cap',()=>{const risk=new RiskManager({...global,maxOpenExposure:1,maxSessionExposure:1});risk.openExposure(1);expect(risk.evaluateReserved(1,'deriv_demo').allowed).toBe(true);expect(risk.getSnapshot().openExposure).toBe(1);expect(risk.getSnapshot().sessionExposure).toBe(1);risk.releaseReservation(1);expect(risk.getSnapshot().tradesThisSession).toBe(0);});
});


describe('qualified entry gating on BOTH account environments',()=>{
 it.each(['deriv_demo','deriv_real'] as const)('waits for forward evidence, then executes only a qualified %s entry',async(mode)=>{
  const f=fixture(mode);const limits={...global,realTradingAcknowledged:true};const s=overlordStrategy({...DEFAULT_OVERLORD,maxTrades:1},'R_10','USD',limits);s.cooldownSeconds=0;
  const events:string[]=[];const bot=new TradingBot(s,f.provider,new RiskManager(effectiveStrategyLimits(limits,s)),{onExecution:(e)=>events.push(e.phase)},1000,{accountLoginid:mode==='deriv_real'?'CR_TEST':'DOT_TEST'});
  await bot.start();for(let i=0;i<50;i++){f.push();await flush();}expect(f.price).not.toHaveBeenCalled();
  for(let i=0;i<30&&bot.state==='running';i++){f.push();await flush();}expect(f.execute).toHaveBeenCalledTimes(1);expect(bot.getTrades()[0]).toMatchObject({mode,accountLoginid:mode==='deriv_real'?'CR_TEST':'DOT_TEST'});expect(events).toContain('qualified');expect(events).toContain('settled');bot.stop();
 });
 it('revokes an entry if another tick changes the signal during proposal latency',async()=>{
  const f=fixture();let release!:(p:PricedContract)=>void;f.price.mockImplementation(()=>new Promise((r)=>{release=r;}));
  const s=overlordStrategy({...DEFAULT_OVERLORD},'R_10','USD',global);s.cooldownSeconds=0;const risk=new RiskManager(effectiveStrategyLimits(global,s));const bot=new TradingBot(s,f.provider,risk);await bot.start();
  for(let i=0;i<80&&!f.price.mock.calls.length;i++){f.push();await flush();}expect(f.price).toHaveBeenCalledTimes(1);f.push();await flush();release({symbol:'R_10',contractType:'DIGITEVEN',stake:1,askPrice:1,payout:1.95,source:'deriv_live'});await flush();expect(bot.getTrades()).toHaveLength(0);expect(risk.getSnapshot().openExposure).toBe(0);expect(bot.state).toBe('running');bot.stop();
 });
 it('cannot turn a stopped pending start back into a running bot',async()=>{
  const f=fixture();let release!:(q:Quote[])=>void;f.provider.history=()=>new Promise((r)=>{release=r;});const bot=new TradingBot(createStrategy({market:'R_10'}),f.provider,new RiskManager(global));const started=bot.start();bot.stop();release([]);await started;expect(bot.state).toBe('stopped');expect(f.execute).not.toHaveBeenCalled();
 });
});
