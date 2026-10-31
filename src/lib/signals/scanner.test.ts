import {afterEach,describe,expect,it,vi} from 'vitest';
import {watchSignals} from './scanner';
import type {MarketProvider,Quote} from '../engine/provider';
import type {ActiveSymbol} from '../deriv/types';
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const market=(n:number)=>({underlying_symbol:`R_${n}`,underlying_symbol_name:`Fixture ${n}`} as ActiveSymbol);
const hist=(symbol:string):Quote[]=>Array.from({length:1200},(_,i)=>({symbol,price:100.01,digit:1,epoch:Math.floor(Date.now()/1000)-1200+i,pipSize:2,source:'deriv_history'}));
afterEach(()=>vi.useRealTimers());
describe('live signal scan resource ownership',()=>{
 it('limits history requests to three and never opens late subscriptions after cancellation',async()=>{
  vi.useFakeTimers();const resolve:((q:Quote[])=>void)[]=[];const history=vi.fn((_symbol:string,_count:number)=>new Promise<Quote[]>((r)=>resolve.push(r))),stream=vi.fn();
  const p={history,stream} as unknown as MarketProvider;const changed=vi.fn();const stop=watchSignals(p,[10,25,50,75,100].map(market),{contractType:'DIGITEVEN'},1,changed);
  expect(history).toHaveBeenCalledTimes(3);expect(history.mock.calls.every((args)=>args[1]===5000)).toBe(true);stop();const count=changed.mock.calls.length;resolve.forEach((r)=>r(hist('R_10')));await flush();expect(stream).not.toHaveBeenCalled();expect(changed).toHaveBeenCalledTimes(count);expect(vi.getTimerCount()).toBe(0);
 });
 it('disposes every subscription, including a stream that finishes opening after Stop',async()=>{
  vi.useFakeTimers();const finishes:((f:()=>void)=>void)[]=[];const stream=vi.fn(()=>new Promise<()=>void>((r)=>finishes.push(r)));
  const p={history:vi.fn(async(symbol:string)=>hist(symbol)),stream} as unknown as MarketProvider;
  const update=vi.fn();const stop=watchSignals(p,[market(10),market(25)],{contractType:'DIGITODD'},1,update);await flush();expect(stream).toHaveBeenCalledTimes(2);const first=vi.fn(),late=vi.fn();finishes[0](first);await flush();stop();finishes[1](late);await flush();expect(first).toHaveBeenCalledTimes(1);expect(late).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 });
});
