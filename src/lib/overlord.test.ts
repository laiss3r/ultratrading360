import { describe, expect, it } from 'vitest';
import { DEFAULT_OVERLORD, eligibleMarkets, observeMarket, overlordStrategy, scanMarkets, validateOverlord } from './overlord';
import { DEFAULT_RISK_LIMITS } from './engine/risk';
import { effectiveStrategyLimits, validateStrategy } from './engine/strategies';
import type { Quote, MarketProvider } from './engine/provider';
import type { ActiveSymbol } from './deriv/types';
const symbol=(id:string,extra:Partial<ActiveSymbol>={}):ActiveSymbol=>({underlying_symbol:id,underlying_symbol_name:id,market:'synthetic_index',submarket:'random_index',pip_size:2,exchange_is_open:1,is_trading_suspended:0,trade_count:1,...extra});
const quotes=(id='R_10'):Quote[]=>Array.from({length:301},(_,i)=>({symbol:id,price:100+i/100,digit:i%10,epoch:1700000000+i,pipSize:2,source:'deriv_history'}));
describe('measured market comparison',()=>{
  it.each([['DIGITEVEN',.5],['DIGITODD',.5],['DIGITOVER',.5],['DIGITUNDER',.4],['DIGITMATCH',.1],['DIGITDIFF',.9]] as const)('%s measures actual digits and the strict barrier',(contract,expected)=>{
    const r=observeMarket('R_10','Test',quotes(),contract,4);expect(r.sample).toBe(300);expect(r.rate).toBeCloseTo(expected);expect(r.lower).toBeLessThan(r.rate);expect(r.upper).toBeGreaterThan(r.rate);
  });
  it('uses duration-sized non-overlapping moves for Rise/Fall, with no invented 50% baseline',()=>{
    const r=observeMarket('R_10','Test',quotes(),'CALL',4,5);expect(r.sample).toBe(60);expect(r.hits).toBe(60);expect(r.baseline).toBeNull();
  });
  it('rejects short, cross-market, malformed or unordered data',()=>{
    expect(()=>observeMarket('R_10','Test',quotes().slice(0,20),'DIGITEVEN',4)).toThrow();
    expect(()=>observeMarket('R_25','Test',quotes(),'DIGITEVEN',4)).toThrow();
    expect(()=>observeMarket('R_10','Test',[...quotes().slice(1),quotes()[0]],'DIGITEVEN',4)).toThrow();
  });
  it('excludes closed, suspended and non-volatility markets',()=>{expect(eligibleMarkets([symbol('R_10'),symbol('1HZ10V'),symbol('R_25',{exchange_is_open:0}),symbol('R_50',{is_trading_suspended:1}),symbol('frxEURUSD')]).map((s)=>s.underlying_symbol)).toEqual(['R_10','1HZ10V']);});
  it('scans real returned samples with bounded concurrency and reports failed markets',async()=>{
    let active=0,max=0;const provider={history:async(id:string)=>{active++;max=Math.max(max,active);await new Promise((r)=>setTimeout(r,1));active--;if(id==='R_50')throw Error('Unavailable');return quotes(id);}} as unknown as MarketProvider;
    const r=await scanMarkets(provider,[10,25,50,75,100].map((n)=>symbol(`R_${n}`)),'DIGITEVEN',4,1);
    expect(max).toBeLessThanOrEqual(3);expect(r.results).toHaveLength(4);expect(r.failures).toHaveLength(1);expect(r.results[0].symbol).toBe('R_10');
  });
  it('rejects cancellation and never creates a fallback result',async()=>{const abort=new AbortController();abort.abort();await expect(scanMarkets({} as MarketProvider,[symbol('R_10')],'DIGITEVEN',4,1,abort.signal)).rejects.toThrow('cancelled');});
});
describe('validated automation configuration',()=>{
  it('builds executable strategy metadata without enabling execution',()=>{
    const s=overlordStrategy({...DEFAULT_OVERLORD,martingale:true,recoveryEnabled:true,duration:7},'R_10','EUR',DEFAULT_RISK_LIMITS);
    expect(validateStrategy(s).valid).toBe(true);expect(s.entry.children[0]).toMatchObject({kind:'always'});expect(s.duration).toBe(7);expect(s.currency).toBe('EUR');expect(s.limits.tradingEnabled).toBe(false);expect(s.progression).toMatchObject({kind:'martingale',multiplier:2.1,stepLimit:4});expect(s.contractRotation?.recovery.contractType).toBe('DIGITOVER');
  });
  it.each([{stake:NaN},{stopLoss:0},{targetProfit:Infinity},{duration:11},{martingale:true,multiplier:1},{martingale:true,maxSteps:100},{contractType:'DIGITOVER' as const,barrier:9}])('rejects invalid settings %j',(patch)=>{expect(validateOverlord({...DEFAULT_OVERLORD,...patch}).length).toBeGreaterThan(0);});
  it('keeps strict strategy stops while global permissions and smaller caps always win',()=>{
    const global={...DEFAULT_RISK_LIMITS,tradingEnabled:true,maxSessionProfit:20,maxSessionLoss:50,maxStake:5};
    const s=overlordStrategy({...DEFAULT_OVERLORD,targetProfit:10,stopLoss:30},'R_10','USD',global);const effective=effectiveStrategyLimits(global,s);
    expect(effective.maxSessionProfit).toBe(10);expect(effective.maxSessionLoss).toBe(30);expect(effective.maxStake).toBe(5);expect(effective.tradingEnabled).toBe(true);expect(effective.realTradingAcknowledged).toBe(false);
  });
});
