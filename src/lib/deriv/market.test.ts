import {expect,it,vi} from 'vitest';
import {MarketDataService} from './market';
import type {DerivClient} from './client';
it('delivers the first real tick and gives chart/bot/scanner independent replay keys',async()=>{
 const subscribe=vi.fn(async(_request, _handler,key)=>({subscription:{id:key},tick:{symbol:'R_10',quote:100.01,pip_size:2,epoch:1700000000}}));const forget=vi.fn(async()=>{});
 const service=new MarketDataService({subscribe,forget} as unknown as DerivClient);const first=vi.fn(),second=vi.fn();const dispose1=await service.streamTicks('R_10',first),dispose2=await service.streamTicks('R_10',second);
 expect(first).toHaveBeenCalledTimes(1);expect(second).toHaveBeenCalledTimes(1);expect(subscribe.mock.calls[0][2]).not.toBe(subscribe.mock.calls[1][2]);dispose1();dispose2();expect(forget).toHaveBeenCalledWith(subscribe.mock.calls[0][2],subscribe.mock.calls[0][2]);expect(forget).toHaveBeenCalledTimes(2);
});

it('pages the genuine 1,000-row cap to 5,000 and refreshes the newest seed',async()=>{
 const send=vi.fn(async(request:Record<string,unknown>)=>{
  const end=request.end==='latest'?(send.mock.calls.length===1?10000:10002):Number(request.end);
  const count=Number(request.count);const times=Array.from({length:count},(_,i)=>end-count+i+1);
  return {pip_size:2,history:{times,prices:times.map((t)=>100+t/100)}};
 });
 const service=new MarketDataService({send} as unknown as DerivClient,0);const progress=vi.fn();const result=await service.ticksHistory('R_10',5000,undefined,progress);
 expect(progress.mock.calls).toEqual([[1000,5000],[2000,5000],[3000,5000],[4000,5000],[5000,5000]]);
 expect(send).toHaveBeenCalledTimes(6);expect(send.mock.calls[1][0].end).toBe('9000');expect(send.mock.calls[4][0].end).toBe('6000');expect(send.mock.calls[5][0].end).toBe('latest');
 expect(result.ticks).toHaveLength(5000);expect(result.ticks[0].epoch).toBe(5003);expect(result.ticks.at(-1)?.epoch).toBe(10002);expect(result.pipSize).toBe(2);
 expect(result.ticks.every((tick,i,a)=>i===0||tick.epoch===a[i-1].epoch+1)).toBe(true);
});
it('fails closed when the broker ignores the historical page cursor',async()=>{
 const send=vi.fn(async()=>({pip_size:2,history:{prices:Array(1000).fill(100),times:Array.from({length:1000},(_,i)=>i+1)}}));
 const service=new MarketDataService({send} as unknown as DerivClient,0);
 await expect(service.ticksHistory('R_10',5000)).rejects.toThrow('page boundary');
});
it('cancels rate-limit backoff without retrying an abandoned scan',async()=>{
 vi.useFakeTimers();
 try{
  const send=vi.fn(async()=>{throw new Error('You have reached the rate limit for ticks_history_expensive.');});
  const service=new MarketDataService({send} as unknown as DerivClient,0),abort=new AbortController();
  const pending=service.ticksHistory('R_10',1000,abort.signal);
  const rejected=expect(pending).rejects.toThrow('cancelled');
  await vi.advanceTimersByTimeAsync(1);expect(send).toHaveBeenCalledTimes(1);abort.abort();await rejected;
  await vi.runAllTimersAsync();expect(send).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});
