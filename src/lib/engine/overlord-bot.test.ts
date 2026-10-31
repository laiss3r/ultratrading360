import { describe, expect, it, vi } from 'vitest';
import { TradingBot } from './bot';
import { createStrategy, effectiveStrategyLimits } from './strategies';
import { DEFAULT_RECOVERY, DEFAULT_RISK_LIMITS, RiskManager } from './risk';
import { DEFAULT_OVERLORD, overlordStrategy } from '../overlord';
import type { MarketProvider, PriceRequest, PricedContract, Quote, SettledContract, ExecuteOptions } from './provider';
const flush=()=>new Promise((r)=>setTimeout(r,0));
function fixture(){
  let onQuote:((q:Quote)=>void)|null=null;
  const price=vi.fn(async(req:PriceRequest):Promise<PricedContract>=>({...req,symbol:req.symbol,stake:req.stake,payout:req.stake*1.95,askPrice:req.stake,source:'deriv_live'}));
  const execute=vi.fn(async(p:PricedContract,opts:ExecuteOptions):Promise<SettledContract>=>{if(opts.shouldExecute&&!opts.shouldExecute())throw Error('Unexpected refusal');return {won:true,stake:p.stake,payout:p.payout,profit:p.stake*.95,source:'deriv_live'};});
  const provider:MarketProvider={mode:'deriv_demo',source:'deriv_live',connect:async()=>{},disconnect:()=>{},isConnected:()=>true,history:async()=>[],stream:async(_symbol,handler)=>{onQuote=handler;return()=>{onQuote=null;};},price,execute};
  const push=()=>onQuote?.({symbol:'R_10',digit:2,price:100.02,epoch:1700000000,pipSize:2,source:'deriv_live'});
  return {provider,price,execute,push};
}
const global={...DEFAULT_RISK_LIMITS,tradingEnabled:true,maxDrawdownPct:0};
describe('Overlord genuine execution orchestration (scripted upstream)',()=>{
  it('uses settled outcomes for recovery switching and capped martingale without overlap',async()=>{
    const f=fixture();let index=0;f.execute.mockImplementation(async(p)=>{const won=index++>=2;return {won,stake:p.stake,payout:won?p.stake*1.95:0,profit:won?p.stake*.95:-p.stake,source:'deriv_live'};});
    const s=overlordStrategy({...DEFAULT_OVERLORD,martingale:true,recoveryEnabled:true,duration:3},'R_10','EUR',{...global,maxStake:3});s.cooldownSeconds=0;
    const risk=new RiskManager(effectiveStrategyLimits({...global,maxStake:3},s),DEFAULT_RECOVERY,10000);const bot=new TradingBot(s,f.provider,risk,{},10000);await bot.start();
    for(let i=0;i<4;i++){f.push();await flush();}
    expect(f.price.mock.calls.map(([r])=>r.contractType)).toEqual(['DIGITEVEN','DIGITOVER','DIGITOVER','DIGITEVEN']);
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
    const f=fixture();f.execute.mockImplementation(async(p)=>({won:win,stake:p.stake,payout:win?1.95:0,profit:win?.95:-1,source:'deriv_live'}));const s=overlordStrategy({...DEFAULT_OVERLORD,targetProfit:.5,stopLoss:.5},'R_10','USD',global);s.cooldownSeconds=0;const bot=new TradingBot(s,f.provider,new RiskManager(effectiveStrategyLimits(global,s)));await bot.start();f.push();await flush();expect(bot.state).toBe('halted');f.push();await flush();expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it('does not deny an order because its own reservation fills the exposure cap',()=>{const risk=new RiskManager({...global,maxOpenExposure:1,maxSessionExposure:1});risk.openExposure(1);expect(risk.evaluateReserved(1,'deriv_demo').allowed).toBe(true);expect(risk.getSnapshot().openExposure).toBe(1);expect(risk.getSnapshot().sessionExposure).toBe(1);risk.releaseReservation(1);expect(risk.getSnapshot().tradesThisSession).toBe(0);});
});
