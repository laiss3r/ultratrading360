import {afterEach,expect,it,vi} from 'vitest';
import {derivJson} from './request';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it.each(['headers','body'])('bounds a stalled %s read, even if the transport ignores abort',async(stage)=>{
 vi.useFakeTimers();let signal:AbortSignal|undefined;
 vi.stubGlobal('fetch',vi.fn((_url:string,init:RequestInit)=>{signal=init.signal as AbortSignal;return stage==='headers'?new Promise(()=>{}):Promise.resolve({json:()=>new Promise(()=>{})});}));
 const result=derivJson('https://example.test/',{},100).catch((error)=>error);
 await vi.advanceTimersByTimeAsync(101);expect((await result).message).toContain('deadline');expect(signal?.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
it('clears the timer after a complete JSON response',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn(async()=>new Response('{"data":[]}')));
 expect((await derivJson('https://example.test/',{})).body).toEqual({data:[]});expect(vi.getTimerCount()).toBe(0);
});
