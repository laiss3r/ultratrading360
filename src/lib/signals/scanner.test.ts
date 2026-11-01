import {afterEach,describe,expect,it,vi} from 'vitest';
import {watchSignals,type WatchedSignal} from './scanner';
import type {MarketProvider,Quote} from '../engine/provider';
import type {ActiveSymbol} from '../deriv/types';
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const market=(n:number)=>({underlying_symbol:`R_${n}`,underlying_symbol_name:`Fixture ${n}`} as ActiveSymbol);
const hist=(symbol:string):Quote[]=>Array.from({length:1200},(_,i)=>({symbol,price:100.01,digit:1,epoch:Math.floor(Date.now()/1000)-1200+i,pipSize:2,source:'deriv_history'}));
const quote=(symbol='R_10',epoch=Math.floor(Date.now()/1000)):Quote=>({symbol,epoch,price:100.02,digit:2,pipSize:2,source:'deriv_live'});
afterEach(()=>vi.useRealTimers());
describe('stream-first real-time signal scanner',()=>{
 it('opens streams before history, caps concurrent seeds and cancels all work',async()=>{
  vi.useFakeTimers();const resolve:((q:Quote[])=>void)[]=[];const history=vi.fn(()=>new Promise<Quote[]>(r=>resolve.push(r))),dispose=vi.fn(),stream=vi.fn(async()=>dispose);
  const p={history,stream,isConnected:()=>true} as unknown as MarketProvider;const changed=vi.fn();const stop=watchSignals(p,[10,25,50,75,100].map(market),{contractType:'DIGITEVEN'},1,changed);
  expect(stream).toHaveBeenCalledTimes(3);expect(history).not.toHaveBeenCalled();await flush();expect(stream).toHaveBeenCalledTimes(5);expect(history).toHaveBeenCalledTimes(3);
  stop();const count=changed.mock.calls.length;resolve.forEach(r=>r(hist('R_10')));await flush();expect(dispose).toHaveBeenCalledTimes(5);expect(changed).toHaveBeenCalledTimes(count);expect(vi.getTimerCount()).toBe(0);
 });
 it('disposes a stream that finishes opening after Stop',async()=>{
  vi.useFakeTimers();const finishes:((f:()=>void)=>void)[]=[];const stream=vi.fn(()=>new Promise<()=>void>(r=>finishes.push(r)));
  const p={history:vi.fn(async(symbol:string)=>hist(symbol)),stream,isConnected:()=>true} as unknown as MarketProvider;
  const stop=watchSignals(p,[market(10),market(25)],{contractType:'DIGITODD'},1,vi.fn());const first=vi.fn(),late=vi.fn();finishes[0](first);await flush();stop();finishes[1](late);await flush();expect(first).toHaveBeenCalledTimes(1);expect(late).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
 });
 it('reports actual page progress, buffers ticks without counting them as forward evidence, rejects duplicates and malformed ticks',async()=>{
  vi.useFakeTimers();let tick!:(q:Quote)=>void,finish!:(q:Quote[])=>void,progress!: (loaded:number,total:number)=>void;let rows:WatchedSignal[]=[];
  const p={isConnected:()=>true,stream:async(_s:string,cb:typeof tick)=>{tick=cb;return ()=>{};},history:(_s:string,_n:number,_a:AbortSignal,cb:typeof progress)=>{progress=cb;return new Promise<Quote[]>(r=>finish=r);}} as unknown as MarketProvider;
  const stop=watchSignals(p,[market(10),market(10)],{contractType:'DIGITEVEN'},1,r=>rows=r);await flush();progress(1000,5000);tick(quote());tick(quote());tick({...quote(),pipSize:100});tick({...quote(),source:'deriv_history'});await vi.advanceTimersByTimeAsync(250);
  expect(rows).toHaveLength(1);expect(rows[0].historyLoaded).toBe(1000);expect(rows[0].liveTicks).toBe(1);expect(rows[0].digits).toEqual([2]);finish(hist('R_10'));await flush();expect(rows[0].phase).toBe('watching');expect(rows[0].evidence?.forward.total).toBe(0);stop();expect(vi.getTimerCount()).toBe(0);
 });
 it('retries seed failures while retaining the live stream and ignores late cancelled progress',async()=>{
  vi.useFakeTimers();let progress!:(a:number,b:number)=>void;const history=vi.fn().mockImplementationOnce((_s,_n,_a,cb)=>{progress=cb;return new Promise(()=>{});}).mockImplementation(async(s:string)=>hist(s));const stream=vi.fn(async()=>()=>{});let rows:WatchedSignal[]=[];
  const stop=watchSignals({history,stream,isConnected:()=>true} as unknown as MarketProvider,[market(10)],{contractType:'DIGITEVEN'},1,r=>rows=r);await flush();await vi.advanceTimersByTimeAsync(45000);expect(rows[0].phase).toBe('retrying');progress(4000,5000);expect(rows[0].historyLoaded).toBe(0);await vi.advanceTimersByTimeAsync(2000);expect(history).toHaveBeenCalledTimes(2);expect(stream).toHaveBeenCalledTimes(1);expect(rows[0].phase).toBe('watching');stop();expect(vi.getTimerCount()).toBe(0);
 });
 it('automatically reseeds after a live gap and blocks disconnected evidence',async()=>{
  vi.useFakeTimers();let tick!:(q:Quote)=>void,connected=true;let rows:WatchedSignal[]=[];const history=vi.fn(async(s:string)=>hist(s));const stop=watchSignals({history,isConnected:()=>connected,stream:async(_s:string,cb:typeof tick)=>{tick=cb;return ()=>{};}} as unknown as MarketProvider,[market(10)],{contractType:'DIGITEVEN'},1,r=>rows=r);await flush();tick(quote());await vi.advanceTimersByTimeAsync(10000);tick(quote());await flush();expect(history).toHaveBeenCalledTimes(2);connected=false;await vi.advanceTimersByTimeAsync(250);expect(rows[0].evidence?.status).toBe('stale');stop();expect(vi.getTimerCount()).toBe(0);
 });
});
