import {afterEach,describe,expect,it,vi} from 'vitest';
import {DISCOVERY_POLICY,HistoricalDiscovery,analyzeDigits,volatilityMarkets,type DiscoveryProvider,type DiscoveryRow,type DiscoverySpec} from './discovery';
import type {ActiveSymbol} from '../deriv/types';
import type {Quote} from '../engine/provider';
const market=(id:string,extra:Partial<ActiveSymbol>={}):ActiveSymbol=>({underlying_symbol:id,underlying_symbol_name:`Volatility ${id} Index`,market:'synthetic_index',submarket:'random_index',pip_size:.01,exchange_is_open:1,is_trading_suspended:0,...extra});
const specs:DiscoverySpec[]=['DIGITEVEN','DIGITODD','DIGITOVER','DIGITUNDER'].map(contract_type=>({contract_type,contract_category:'digits',contract_display:contract_type,min_contract_duration:'1t',max_contract_duration:'10t',...(contract_type==='DIGITOVER'?{last_digit_range:[0,1,2,3,4,5,6,7,8]}:contract_type==='DIGITUNDER'?{last_digit_range:[1,2,3,4,5,6,7,8,9]}:{})}));
const quotes=(symbol='R_10',count=1000):Quote[]=>Array.from({length:count},(_,i)=>({symbol,price:100+(i%10)/100,pipSize:2,digit:9,epoch:Math.floor(Date.now()/1000)-count+i+1,source:'deriv_history'}));
const provider=(markets:ActiveSymbol[]=[market('R_10')]):DiscoveryProvider=>({connect:vi.fn(async()=>{}),disconnect:vi.fn(),activeSymbols:vi.fn(async()=>markets),contractsFor:vi.fn(async()=>specs),history:vi.fn(async s=>quotes(s))});
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
afterEach(()=>vi.useRealTimers());
describe('all API-returned Volatility markets',()=>{
 it('includes named S variants, 1s, legacy suffixes, future names and unavailable rows, without a 20-market cap',()=>{
  const list=[...Array.from({length:31},(_,i)=>market(`S${i}`)),market('R_10S',{underlying_symbol_name:'API exact S name'}),market('1HZ100VS',{underlying_symbol_name:'API exact 1s S name'}),market('NEW_SYMBOL',{underlying_symbol_name:'Volatility 250 S Index',exchange_is_open:0}),market('R_50',{is_trading_suspended:1}),market('frxEURUSD',{underlying_symbol_name:'EUR/USD'}),market('CRASH',{underlying_symbol_name:'Crash 1000 Index'})];
  const out=volatilityMarkets([...list,list[0]]);expect(out).toHaveLength(35);expect(out.find(s=>s.underlying_symbol==='R_10S')?.underlying_symbol_name).toBe('API exact S name');expect(out.some(s=>s.underlying_symbol==='1HZ100VS')).toBe(true);expect(out.some(s=>s.exchange_is_open===0)).toBe(true);
 });
});
describe('exact historical contract estimates, never hardcoded confidence',()=>{
 it('derives actual digits at API precision instead of trusting a precomputed digit field',()=>{
  const a=analyzeDigits('R_10',quotes(),specs);expect(a.counts).toEqual(Array(10).fill(100));expect(a.digits.slice(-10)).toEqual([0,1,2,3,4,5,6,7,8,9]);expect(a.opportunities).toHaveLength(20);expect(a.sample).toBe(1000);
 });
 it.each([['DIGITEVEN',undefined,.5],['DIGITODD',undefined,.5],['DIGITOVER',4,.5],['DIGITUNDER',4,.4],['DIGITOVER',0,.9],['DIGITUNDER',9,.9]] as const)('%s %s uses strict digit boundaries and measured counts', (type,barrier,rate)=>{
  const o=analyzeDigits('R_10',quotes(),specs).opportunities.find(o=>o.contractType===type&&o.barrier===barrier)!;expect(o.probability).toBe(rate);expect(o.hits).toBe(rate*1000);expect(o.probability).toBe(o.hits/o.sample);expect(o.lower).toBeLessThan(rate);expect(o.upper).toBeGreaterThan(rate);expect(o.lift).toBeCloseTo(0);
 });
 it('includes trailing zeros at 3 decimal precision',()=>{const q=quotes().map(q=>({...q,price:123.45,pipSize:3}));const a=analyzeDigits('R_10',q,specs);expect(a.counts[0]).toBe(1000);expect(a.opportunities.find(o=>o.contractType==='DIGITEVEN')?.probability).toBe(1);});
 it('samples non-overlapping terminal outcomes for the selected duration',()=>{const a=analyzeDigits('R_10',quotes(),specs,2);expect(a.sample).toBe(500);expect(a.opportunities.find(o=>o.contractType==='DIGITODD')?.hits).toBe(500);expect(a.counts[0]).toBe(0);});
 it('only analyses broker-supported contract types, barriers and durations, with duplicate specs deduplicated',()=>{
  const supported=[{...specs[2],last_digit_range:[4],max_contract_duration:'2t'}];expect(analyzeDigits('R_10',quotes(),[...supported,...supported],2).opportunities).toHaveLength(1);expect(()=>analyzeDigits('R_10',quotes(),supported,3)).toThrow('no supported');
 });
 it('excludes impossible and invalid barriers',()=>{const a=analyzeDigits('R_10',quotes(),[{...specs[2],last_digit_range:[-1,0,9,NaN,10,3.5]}]);expect(a.opportunities.map(o=>o.barrier)).toEqual([0]);});
 it('ranks actual highest hit rate, exposing that an easy barrier is not an edge',()=>{const q=quotes().map((q,i)=>({...q,price:i<930?100.08:100.09}));const a=analyzeDigits('R_10',q,specs);expect(a.best).toMatchObject({contractType:'DIGITOVER',barrier:7,hits:1000,probability:1,baseline:.2});});
 it.each([0,11,1.5,NaN])('rejects invalid duration %s',d=>{expect(()=>analyzeDigits('R_10',quotes(),specs,d)).toThrow('duration');});
 it.each(['short','mixed-symbol','unordered','nonfinite','mixed-precision','live-source'])('rejects %s data without manufacturing a result',kind=>{
  let q=quotes();if(kind==='short')q=q.slice(0,20);if(kind==='mixed-symbol')q[0]={...q[0],symbol:'OTHER'};if(kind==='unordered')q[1]={...q[1],epoch:q[0].epoch-1};if(kind==='nonfinite')q[0]={...q[0],price:NaN};if(kind==='mixed-precision')q[0]={...q[0],pipSize:3};if(kind==='live-source')q[0]={...q[0],source:'deriv_live'};expect(()=>analyzeDigits('R_10',q,specs)).toThrow();
 });
});
describe('bounded history-first fetching and cache ownership',()=>{
 it('fetches all 25 available markets using a fixed single-page count; never opens a stream',async()=>{
  const p=provider(Array.from({length:25},(_,i)=>market(`S${i}`)));let active=0,max=0;
  vi.mocked(p.history).mockImplementation(async(s,count,signal,progress)=>{expect(count).toBe(1000);expect(signal?.aborted).toBe(false);active++;max=Math.max(max,active);await Promise.resolve();progress?.(1000,1000);active--;return quotes(s);});
  let rows:DiscoveryRow[]=[];await new HistoricalDiscovery(p).scan(1,{signal:new AbortController().signal,onUpdate:r=>rows=r});expect(rows).toHaveLength(25);expect(rows.every(r=>r.phase==='ready')).toBe(true);expect(max).toBeLessThanOrEqual(4);expect(p.history).toHaveBeenCalledTimes(25);
 });
 it('produces the first historical result while other markets are still loading, with no live tick',async()=>{
  const p=provider([market('R_10'),market('R_25')]);let finish!:(q:Quote[])=>void;vi.mocked(p.history).mockImplementation(s=>s==='R_10'?Promise.resolve(quotes(s)):new Promise(r=>finish=r));let rows:DiscoveryRow[]=[];const task=new HistoricalDiscovery(p).scan(1,{signal:new AbortController().signal,onUpdate:r=>rows=r});await flush();expect(rows.find(r=>r.symbol==='R_10')?.phase).toBe('ready');expect(rows.find(r=>r.symbol==='R_25')?.phase).toBe('loading');finish(quotes('R_25'));await task;
 });
 it('reuses fresh history when duration changes, and force refresh fetches all markets again',async()=>{
  const p=provider(),d=new HistoricalDiscovery(p);let rows:DiscoveryRow[]=[];const options={signal:new AbortController().signal,onUpdate:(r:DiscoveryRow[])=>rows=r};await d.scan(1,options);await d.scan(2,options);expect(p.history).toHaveBeenCalledTimes(1);expect(rows[0].cached).toBe(true);expect(rows[0].analysis?.sample).toBe(500);await d.scan(1,{...options,force:true});expect(p.history).toHaveBeenCalledTimes(2);expect(rows[0].cached).toBe(false);
 });
 it('reports a cached market unsupported for the new duration without aborting other markets',async()=>{
  const p=provider([market('R_10'),market('R_25')]);vi.mocked(p.contractsFor).mockImplementation(async(s)=>s==='R_10'?specs.map(s=>({...s,max_contract_duration:'1t'})):specs);const d=new HistoricalDiscovery(p);let rows:DiscoveryRow[]=[];const options={signal:new AbortController().signal,onUpdate:(r:DiscoveryRow[])=>rows=r};await d.scan(1,options);await d.scan(2,options);expect(rows.find(r=>r.symbol==='R_10')?.phase).toBe('error');expect(rows.find(r=>r.symbol==='R_25')?.phase).toBe('ready');
 });
 it('expires the cache after 60 seconds',async()=>{vi.useFakeTimers();const p=provider(),d=new HistoricalDiscovery(p),options={signal:new AbortController().signal,onUpdate:vi.fn()};await d.scan(1,options);await vi.advanceTimersByTimeAsync(60001);await d.scan(1,options);expect(p.history).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);});
 it('shows closed/suspended rows and partial API errors while successful markets still finish',async()=>{
  const p=provider([market('R_10'),market('R_25'),market('R_50',{exchange_is_open:0}),market('R_75',{is_trading_suspended:1})]);vi.mocked(p.history).mockImplementation(async(s)=>{if(s==='R_25')throw Error('API unavailable');return quotes(s);});let rows:DiscoveryRow[]=[];await new HistoricalDiscovery(p).scan(1,{signal:new AbortController().signal,onUpdate:r=>rows=r});expect(p.history).toHaveBeenCalledTimes(2);expect(rows.filter(r=>r.phase==='unavailable')).toHaveLength(2);expect(rows.find(r=>r.symbol==='R_25')?.error).toBe('API unavailable');expect(rows.filter(r=>r.phase==='ready')).toHaveLength(1);
 });
 it.each([-120000,10000])('rejects stale or future historical timestamps (%s ms)',async(offset)=>{const p=provider();vi.mocked(p.history).mockResolvedValue(quotes().map(q=>({...q,epoch:q.epoch+offset/1000})));let rows:DiscoveryRow[]=[];await new HistoricalDiscovery(p).scan(1,{signal:new AbortController().signal,onUpdate:r=>rows=r});expect(rows[0].phase).toBe('error');expect(rows[0].analysis).toBeUndefined();});
 it('cancels hung reads promptly and ignores late page callbacks/results',async()=>{
  vi.useFakeTimers();const p=provider(),controller=new AbortController();let progress!:(a:number,b:number)=>void,finish!:(q:Quote[])=>void;vi.mocked(p.history).mockImplementation((_s,_n,_a,cb)=>{progress=cb!;return new Promise(r=>finish=r);});const changed=vi.fn();const task=new HistoricalDiscovery(p).scan(1,{signal:controller.signal,onUpdate:changed});const rejected=expect(task).rejects.toThrow('cancelled');await flush();controller.abort();await rejected;const before=changed.mock.calls.length;progress(1000,1000);finish(quotes());await flush();expect(changed).toHaveBeenCalledTimes(before);expect(vi.getTimerCount()).toBe(0);
 });
 it('times out a stuck market independently instead of leaving discovery spinning',async()=>{
  vi.useFakeTimers();const p=provider();vi.mocked(p.history).mockImplementation(()=>new Promise(()=>{}));let rows:DiscoveryRow[]=[];const task=new HistoricalDiscovery(p).scan(1,{signal:new AbortController().signal,onUpdate:r=>rows=r});await flush();await vi.advanceTimersByTimeAsync(DISCOVERY_POLICY.deadlineMs);await task;expect(rows[0].phase).toBe('error');expect(rows[0].error).toContain('deadline');expect(vi.getTimerCount()).toBe(0);
 });
 it('cancels during connection without starting history reads',async()=>{
  vi.useFakeTimers();const p=provider();vi.mocked(p.connect).mockImplementation(()=>new Promise(()=>{}));const signal=new AbortController();const task=new HistoricalDiscovery(p).scan(1,{signal:signal.signal,onUpdate:vi.fn()});const rejected=expect(task).rejects.toThrow('cancelled');signal.abort();await rejected;expect(p.history).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it('surfaces empty listing and discovery API errors instead of inventing markets',async()=>{
  const p=provider([]),d=new HistoricalDiscovery(p),options={signal:new AbortController().signal,onUpdate:vi.fn()};await expect(d.scan(1,options)).rejects.toThrow('no Volatility');vi.mocked(p.activeSymbols).mockRejectedValue(Error('Offline'));await expect(d.scan(1,options)).rejects.toThrow('Offline');
 });
});
