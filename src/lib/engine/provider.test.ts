import { afterEach, describe, expect, it, vi } from 'vitest';
import { DerivProvider } from './provider';

import {DerivClient} from '../deriv/client';
afterEach(()=>vi.restoreAllMocks());
const SYM = 'R_100';

describe('DerivProvider refuses to fabricate', () => {
  it('throws instead of reporting a trade when the socket is not connected', async () => {
    const p = new DerivProvider('deriv_demo');
    expect(p.isConnected()).toBe(false);
    await expect(
      p.execute({ stake: 1, payout: 1.96, askPrice: 1, contractType: 'DIGITODD', symbol: SYM, source: 'deriv_live' }, { authorized: true }),
    ).rejects.toThrow(/not connected|dropped|refusing/i);
  });

  it('labels its own source as deriv_live so provenance is unambiguous', () => {
    const p = new DerivProvider('deriv_demo');
    expect(p.source).toBe('deriv_live');
    expect(p.mode).toBe('deriv_demo');
  });
});


describe('authenticated balance verification',()=>{
 it.each([100,'100.00',0,'0.00'])('accepts a finite broker balance %s without fabricating a value',async(balance)=>{
  vi.spyOn(DerivClient.prototype,'subscribe').mockResolvedValue({balance:{balance,currency:'USD',loginid:'DOT1'}} as never);
  const callback=vi.fn();await new DerivProvider('deriv_demo').streamBalance(callback,{loginid:'DOT1',currency:'USD'});expect(callback).toHaveBeenCalledWith(Number(balance),'USD');
 });
 it.each([null,'',false,'NaN',-1,Infinity])('rejects invalid amount %s',async(balance)=>{
  vi.spyOn(DerivClient.prototype,'subscribe').mockResolvedValue({balance:{balance,currency:'USD'}} as never);const callback=vi.fn();await expect(new DerivProvider('deriv_demo').streamBalance(callback)).rejects.toThrow('invalid');expect(callback).not.toHaveBeenCalled();
 });
 it.each([{loginid:'OTHER',currency:'USD'},{loginid:'DOT1',currency:'EUR'}])('rejects a mismatched identity or currency',async(identity)=>{
  vi.spyOn(DerivClient.prototype,'subscribe').mockResolvedValue({balance:{balance:'100.00',...identity}} as never);await expect(new DerivProvider('deriv_demo').streamBalance(vi.fn(),{loginid:'DOT1',currency:'USD'})).rejects.toThrow('does not match');
 });
 it('revokes a verified socket on malformed replay rather than retaining trading authority',async()=>{
  let frame!:(m:never)=>void;vi.spyOn(DerivClient.prototype,'subscribe').mockImplementation(async(_r,cb)=>{frame=cb;return {balance:{balance:'1.00',currency:'USD'}} as never;});const close=vi.spyOn(DerivClient.prototype,'close').mockImplementation(()=>{});const cb=vi.fn();await new DerivProvider('deriv_demo').streamBalance(cb);frame({balance:{balance:'bad',currency:'USD'}} as never);expect(close).toHaveBeenCalledOnce();expect(cb).toHaveBeenCalledTimes(1);
 });
});

describe('single-use fresh broker pricing',()=>{
 it.each([0,1500])('reuses a fresh quote but reprices an aged quote (%sms)',async(age)=>{
  const {ContractService}=await import('../deriv/contracts');const {TradingService}=await import('../deriv/trading');
  const p=new DerivProvider('deriv_demo');vi.spyOn(p,'isConnected').mockReturnValue(true);
  const proposal={id:'actual-quote',ask_price:1,payout:1.95,spot:100,spot_value:'100.00',date_start:1,date_expiry:2,longcode:'Broker proposal'};
  const price=vi.spyOn(ContractService.prototype,'proposal').mockResolvedValue({proposal,impliedProbability:1/1.95});
  vi.spyOn(DerivClient.prototype,'send').mockResolvedValue({buy:{buy_price:1,contract_id:42,payout:1.95,longcode:'Broker contract',purchase_time:1,start_time:1}} as never);
  vi.spyOn(TradingService.prototype,'watchContract').mockResolvedValue({contract_id:42,profit:.95,buy_price:1,is_sold:1,status:'won'} as never);
  const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now);
  const priced=await p.price({symbol:'R_10',contractType:'DIGITEVEN',stake:1,duration:1,durationUnit:'t',currency:'USD'});
  vi.mocked(Date.now).mockReturnValue(now+age);const permission=vi.fn(()=>true);
  await p.execute(priced,{authorized:true,shouldExecute:permission});expect(price).toHaveBeenCalledTimes(age===0?1:2);expect(permission).toHaveBeenCalled();await expect(p.execute(priced,{authorized:true})).rejects.toThrow(/consumed/);
 });
});

describe('measured execution timing',()=>{
 it.each([0,1500])('reports actual pricing (including refresh) and buy acknowledgement without settlement wait (%sms quote age)',async(age)=>{
  const {ContractService}=await import('../deriv/contracts');const {TradingService}=await import('../deriv/trading');
  const p=new DerivProvider('deriv_demo');vi.spyOn(p,'isConnected').mockReturnValue(true);
  let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock);
  const proposal={id:'timed-quote',ask_price:1,payout:1.95,spot:100,spot_value:'100.00',date_start:1,date_expiry:2,longcode:'Measured test proposal'};
  vi.spyOn(ContractService.prototype,'proposal').mockImplementation(async()=>{clock+=40;return {proposal,impliedProbability:1/1.95};});
  vi.spyOn(DerivClient.prototype,'send').mockImplementation(async()=>{clock+=70;return {buy:{buy_price:1,contract_id:42,payout:1.95,longcode:'Test receipt',purchase_time:1,start_time:1}} as never;});
  vi.spyOn(TradingService.prototype,'watchContract').mockImplementation(async()=>{clock+=3000;return {contract_id:42,profit:.95,buy_price:1,is_sold:1,status:'won'} as never;});
  const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now);
  const priced=await p.price({symbol:'R_10',contractType:'DIGITEVEN',stake:1,duration:1,durationUnit:'t',currency:'USD'});
  clock+=age;vi.mocked(Date.now).mockReturnValue(now+age);const updates:import('./execution').ContractUpdate[]=[];
  const result=await p.execute(priced,{authorized:true,onUpdate:u=>updates.push(u)});
  const expected={proposalMs:age?80:40,buyAckMs:70,quoteToReceiptMs:age?1650:110};
  expect(result.timing).toEqual(expected);expect(updates.find(u=>u.phase==='open')?.timing).toEqual(expected);expect(result.timing!.quoteToReceiptMs).toBeLessThan(clock);
 });
});

describe('public broker clock',()=>{
 it('uses the genuine server time response in milliseconds',async()=>{const send=vi.spyOn(DerivClient.prototype,'send').mockResolvedValue({time:1793637000} as never);expect(await new DerivProvider('deriv_demo').serverTime()).toBe(1793637000000);expect(send).toHaveBeenCalledWith({time:1});});
 it.each([undefined,'1793637000',NaN,0,-1])('rejects invalid server time %s',async(time)=>{vi.spyOn(DerivClient.prototype,'send').mockResolvedValue({time} as never);await expect(new DerivProvider('deriv_demo').serverTime()).rejects.toThrow('invalid');});
});
