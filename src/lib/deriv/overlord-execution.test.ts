import { afterEach, describe, expect, it, vi } from 'vitest';
import { DerivClient } from './client';
import { ContractService } from './contracts';
import { TradingService, OrderCancelledError } from './trading';
import { DerivProvider } from '../engine/provider';
import type { OpenContract } from './types';
afterEach(()=>vi.restoreAllMocks());
const proposal={id:'test-proposal',ask_price:1,payout:1.95,spot:100,spot_value:'100.00',date_start:1700000000,date_expiry:1700000008,longcode:'Synthetic test only'};
describe('pricing context and final purchase guards',()=>{
  it('keeps the chosen currency, duration, barrier and contract at execution, and consumes context once',async()=>{
    vi.spyOn(DerivClient.prototype,'connect').mockImplementation(async function(this:DerivClient){this.status='open';});
    vi.spyOn(ContractService.prototype,'proposal').mockResolvedValue({proposal,impliedProbability:1/1.95});
    const buy=vi.spyOn(TradingService.prototype,'buy').mockResolvedValue({contractId:1,proposalId:proposal.id,buyPrice:1,payout:1.95,longcode:'Test',currency:'EUR',dateStart:1700000000,dateExpiry:1700000008,verifiedProposal:proposal});
    vi.spyOn(TradingService.prototype,'watchContract').mockResolvedValue({profit:.95,payout:1.95,is_sold:1,status:'won'} as OpenContract);
    const p=new DerivProvider('deriv_demo');await p.connect();const priced=await p.price({symbol:'R_10',contractType:'DIGITOVER',barrier:'4',stake:1,duration:8,durationUnit:'t',currency:'EUR'});
    await p.execute(priced,{authorized:true});expect(buy.mock.calls[0][0]).toMatchObject({underlying:'R_10',currency:'EUR',duration:8,durationUnit:'t',contractType:'DIGITOVER',barrier:'4'});
    await expect(p.execute(priced,{authorized:true})).rejects.toThrow('consumed');p.disconnect();
  });
  it('checks Stop/permission again after repricing and sends no buy if cancelled',async()=>{
    const client={send:vi.fn()} as unknown as DerivClient;
    const contracts={proposal:vi.fn(async()=>({proposal,impliedProbability:1/1.95}))} as unknown as ContractService;
    const service=new TradingService(client,contracts);
    await expect(service.buy({underlying:'R_10',contractType:'DIGITEVEN',stake:1,currency:'USD',duration:1,durationUnit:'t'},{authorized:true,shouldExecute:()=>false})).rejects.toBeInstanceOf(OrderCancelledError);
    expect(client.send).not.toHaveBeenCalled();
  });
  it('settles an already-terminal first subscription frame and cancels its replay',async()=>{
    const first={msg_type:'proposal_open_contract',subscription:{id:'test-sub'},proposal_open_contract:{contract_id:1,is_sold:1,status:'won',profit:.95}};
    const client={subscribe:vi.fn(async()=>first),forget:vi.fn(async()=>{})} as unknown as DerivClient;
    const service=new TradingService(client,{} as ContractService);
    expect((await service.watchContract(1)).profit).toBe(.95);expect(client.forget).toHaveBeenCalledWith('test-sub','poc_1');
  });
});

it('normalizes current-schema string money and entry_spot/exit_spot before reporting settlement',async()=>{
 const first={subscription:{id:'current-schema'},proposal_open_contract:{contract_id:7,is_sold:1,status:'lost',buy_price:'1.00',payout:'1.95',profit:'-1.00',bid_price:'0.00',entry_spot:'9608.69',exit_spot:'9608.57'}};
 const client={subscribe:vi.fn(async()=>first),forget:vi.fn(async()=>{})} as unknown as DerivClient;
 const c=await new TradingService(client,{} as ContractService).watchContract(7);
 expect(c).toMatchObject({profit:-1,buy_price:1,payout:1.95,bid_price:0,entry_tick:9608.69,exit_tick:9608.57});
});
it('checks the second proposal payout, not only its unchanged ask price',async()=>{
 const client={send:vi.fn()} as unknown as DerivClient;
 const contracts={proposal:vi.fn(async()=>({proposal:{...proposal,payout:1.05},impliedProbability:1/1.05}))} as unknown as ContractService;
 await expect(new TradingService(client,contracts).buy({underlying:'R_10',contractType:'DIGITEVEN',stake:1,currency:'USD',duration:1,durationUnit:'t'},{authorized:true,shouldExecute:(p)=>p.payout>=1.9})).rejects.toBeInstanceOf(OrderCancelledError);expect(client.send).not.toHaveBeenCalled();
});
it('never counts the potential payout as an actual gross return on a lost contract',async()=>{
 vi.spyOn(DerivClient.prototype,'connect').mockImplementation(async function(this:DerivClient){this.status='open';});
 vi.spyOn(ContractService.prototype,'proposal').mockResolvedValue({proposal,impliedProbability:1/1.95});
 vi.spyOn(TradingService.prototype,'buy').mockResolvedValue({contractId:3,proposalId:'x',buyPrice:1,payout:1.95,longcode:'Test',currency:'USD',dateStart:1700000000,dateExpiry:1700000001,verifiedProposal:proposal});
 vi.spyOn(TradingService.prototype,'watchContract').mockResolvedValue({profit:-1,payout:1.95,is_sold:1,status:'lost'} as OpenContract);
 const p=new DerivProvider('deriv_demo');await p.connect();const priced=await p.price({symbol:'R_10',contractType:'DIGITEVEN',stake:1,duration:1,durationUnit:'t',currency:'USD'});const settled=await p.execute(priced,{authorized:true});expect(settled).toMatchObject({profit:-1,payout:0,contractId:3});p.disconnect();
});
