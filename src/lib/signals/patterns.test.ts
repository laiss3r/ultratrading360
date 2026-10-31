import {describe,expect,it} from 'vitest';
import {PatternTracker,contractOutcome,payoutCheck,baseline,interval} from './patterns';
import type {Quote} from '../engine/provider';
import type {ContractLeg} from '../engine/rotation';
const start=1700010000;
const quote=(i:number,digit=i%2?8:1,source:'deriv_history'|'deriv_live'='deriv_history'):Quote=>({symbol:'R_10',price:100+digit/100,digit,epoch:start+i,pipSize:2,source});
const history=(digit:(i:number)=>number=(i)=>i%2?8:1)=>Array.from({length:5000},(_,i)=>quote(i-5000,digit(i)));
const even:ContractLeg={contractType:'DIGITEVEN'};
function feed(t:PatternTracker,count:number,digit:(i:number)=>number=(i)=>i%2?8:1){for(let i=0;i<count;i++)t.ingest(quote(i,digit(i),'deriv_live'),(start+i)*1000);return t.snapshot((start+count-1)*1000);}
describe('causal, contract-specific live pattern evidence',()=>{
 it('does not qualify on historical patterns alone or one fresh tick',()=>{const t=new PatternTracker('R_10',even,1,history(),start*1000);expect(t.snapshot(start*1000).status).toBe('stale');const e=feed(t,1);expect(e.status).not.toBe('qualified');expect(e.forward.total).toBe(0);});
 it('qualifies a deliberately predictable fixture only after new forward outcomes',()=>{const t=new PatternTracker('R_10',even,1,history(),start*1000);const e=feed(t,65);expect(e.status).toBe('qualified');expect(e.pattern).toBe('0');expect(e.forward.total).toBeGreaterThanOrEqual(30);expect(e.validation.total).toBeGreaterThanOrEqual(80);expect(payoutCheck(e,1,1.95).allowed).toBe(true);expect(payoutCheck(e,1,1.05).allowed).toBe(false);});
 it('refuses a pattern that looked perfect in training but reverses in held-out history',()=>{const h=history((i)=>i<3000?(i%2?8:1):1);const t=new PatternTracker('R_10',even,1,h,start*1000);const e=feed(t,65);expect(e.status).not.toBe('qualified');expect(e.validation.hits).toBe(0);});
 it('does not qualify a seeded independent digit sample',()=>{let seed=38231;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return (seed>>>16)%10;};const t=new PatternTracker('R_10',even,1,history(()=>random()),start*1000);expect(feed(t,301,()=>random()).status).not.toBe('qualified');});
 it('matures forward outcomes only after duration; never treats a feature tick as its own result',()=>{const t=new PatternTracker('R_10',even,3,history(),start*1000);expect(feed(t,3).forward.total).toBe(0);});
 it('invalidates a qualified signal after 5 seconds without a fresh tick',()=>{const t=new PatternTracker('R_10',even,1,history(),start*1000);const e=feed(t,65);expect(t.snapshot(e.lastTickAt+5001).status).toBe('stale');});
 it('rejects duplicate, wrong-market, future and out-of-order ticks without adding outcomes',()=>{const t=new PatternTracker('R_10',even,1,history(),start*1000);const q=quote(0,1,'deriv_live');expect(t.ingest(q,start*1000)).toBe(true);expect(t.ingest(q,start*1000)).toBe(false);expect(t.ingest({...q,symbol:'R_25'},start*1000)).toBe(false);expect(t.ingest(quote(10,8,'deriv_live'),start*1000)).toBe(false);expect(t.ingest(quote(-1,8,'deriv_live'),start*1000)).toBe(false);expect(t.snapshot(start*1000).status).toBe('stale');});
 it('clears pending evidence on a stream gap instead of inventing missing ticks',()=>{const t=new PatternTracker('R_10',even,1,history(),start*1000);feed(t,65);expect(t.ingest(quote(80,8,'deriv_live'),(start+80)*1000)).toBe(false);expect(t.snapshot((start+80)*1000).status).toBe('stale');expect(t.snapshot((start+80)*1000).reason).toMatch(/gap/);});
 it('rejects stale and unordered seeds',()=>{expect(()=>new PatternTracker('R_10',even,1,history(),(start+20)*1000)).toThrow(/stale/);const h=history();[h[1],h[2]]=[h[2],h[1]];expect(()=>new PatternTracker('R_10',even,1,h,start*1000)).toThrow(/ordered/);});
 it('uses a new live sample after refitting an expired model',()=>{const t=new PatternTracker('R_10',even,1,history(),start*1000);const e=feed(t,65);expect(t.snapshot(e.trainedAt+15*60*1000+1).status).toBe('stale');});
 it.each([
  ['DIGITEVEN',undefined,8,true],['DIGITODD',undefined,8,false],['DIGITOVER',4,8,true],['DIGITUNDER',4,1,true],['DIGITMATCH',8,8,true],['DIGITDIFF',8,8,false],['CALL',undefined,8,true],['PUT',undefined,8,false],
 ] as const)('evaluates the chosen %s contract, not a shared parity guess',(contractType,barrier,digit,result)=>{expect(contractOutcome({contractType,barrier},quote(0,1),quote(1,digit))).toBe(result);});
 it('requires a valid broker payout; high observed win rate alone is insufficient',()=>{expect(baseline({contractType:'DIGITDIFF',barrier:4})).toBe(.9);const t=new PatternTracker('R_10',even,1,history(),start*1000);const e=feed(t,65);expect(payoutCheck(e,1,NaN).allowed).toBe(false);expect(payoutCheck(e,1,1).allowed).toBe(false);expect(interval({hits:0,total:0})).toEqual([0,1]);});
 it('does not invent signals for impossible barriers or non-tick horizons',()=>{expect(()=>new PatternTracker('R_10',{contractType:'DIGITOVER',barrier:9},1,history(),start*1000)).toThrow(/Invalid/);expect(()=>new PatternTracker('R_10',even,11,history(),start*1000)).toThrow(/Invalid/);});
});
