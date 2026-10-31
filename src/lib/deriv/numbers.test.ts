import {describe,expect,it} from 'vitest';
import {brokerNumber,requiredBrokerNumber} from './numbers';
import {ContractService} from './contracts';
import type {DerivClient} from './client';
describe('broker numeric schema boundaries',()=>{
 it.each([null,undefined,'',true,false,'bad','NaN',Infinity,'0x10'])('does not coerce %s into an invented zero',v=>{expect(brokerNumber(v)).toBeUndefined();expect(()=>requiredBrokerNumber(v,'profit')).toThrow(/assumed/);});
 it('accepts genuine numeric strings, negative P/L and zero',()=>{expect(brokerNumber('-1.00')).toBe(-1);expect(brokerNumber('0.00')).toBe(0);expect(brokerNumber('9608.570')).toBe(9608.57);});
 it('normalizes proposal money before a finite-number payout guard',async()=>{
  const client={send:async()=>({proposal:{id:'fixture',ask_price:'1.00',payout:'1.95'}})} as unknown as DerivClient;
  const r=await new ContractService(client).proposal({underlying:'R_10',contractType:'DIGITEVEN',amount:1,basis:'stake',currency:'USD',duration:1,durationUnit:'t'});expect(r.proposal.ask_price).toBe(1);expect(r.proposal.payout).toBe(1.95);
 });
});
