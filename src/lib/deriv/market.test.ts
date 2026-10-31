import {expect,it,vi} from 'vitest';
import {MarketDataService} from './market';
import type {DerivClient} from './client';
it('delivers the first real tick and gives chart/bot/scanner independent replay keys',async()=>{
 const subscribe=vi.fn(async(_request, _handler,key)=>({subscription:{id:key},tick:{symbol:'R_10',quote:100.01,pip_size:2,epoch:1700000000}}));const forget=vi.fn(async()=>{});
 const service=new MarketDataService({subscribe,forget} as unknown as DerivClient);const first=vi.fn(),second=vi.fn();const dispose1=await service.streamTicks('R_10',first),dispose2=await service.streamTicks('R_10',second);
 expect(first).toHaveBeenCalledTimes(1);expect(second).toHaveBeenCalledTimes(1);expect(subscribe.mock.calls[0][2]).not.toBe(subscribe.mock.calls[1][2]);dispose1();dispose2();expect(forget).toHaveBeenCalledWith(subscribe.mock.calls[0][2],subscribe.mock.calls[0][2]);expect(forget).toHaveBeenCalledTimes(2);
});
