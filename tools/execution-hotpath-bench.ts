/** Synthetic local CPU/storage-adapter benchmark. Never connects, prices or buys.
 * npm exec --yes --package=tsx -- tsx tools/execution-hotpath-bench.ts */
import {writeFile,unlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import * as current from '../src/lib/elite/checkpoint';
import type {ExecutionEvent} from '../src/lib/engine/execution';
const reference='5365fd5fbf90188aba268d3362c1169839189b36';
const file='src/lib/elite/.hotpath-baseline.ts';
const receipt:ExecutionEvent={id:'fixture',runId:'elite_latency_fixture',tool:'elite',operationId:'fixture:R_10',accountLoginid:'SYNTHETIC_ONLY',mode:'deriv_demo',at:1,phase:'qualified',detail:'Synthetic benchmark only',symbol:'R_10',contractType:'DIGITEVEN',duration:1,durationUnit:'t',currency:'USD',stake:1};
const payload=JSON.stringify({events:[],trades:Array.from({length:100},(_,i)=>({id:`t${i}`,runId:'elite_latency_fixture',source:'deriv_live',profit:-1,stake:1,payout:0,contractId:i+1,accountLoginid:'SYNTHETIC_ONLY',mode:'deriv_demo',symbol:'R_10',longcode:'Synthetic benchmark payload, not a genuine contract. '.repeat(12)}))});
function measure(api:typeof current){
 const data=new Map([['ut_elite_receipt_checkpoint_v1',payload]]);let writes=0;
 Object.assign(globalThis,{localStorage:{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{writes++;data.set(k,v);},removeItem:(k:string)=>data.delete(k)}});
 const start=performance.now();api.checkpointEliteEvent(receipt);api.checkpointEliteEvent({...receipt,phase:'pricing'});const proposalPathMs=performance.now()-start;
 api.checkpointEliteEvent({...receipt,phase:'buying',purchaseSubmitted:true});
 return {proposalPathMs,totalCheckpointMs:performance.now()-start,writes};
}
const median=(a:number[])=>a.sort((x,y)=>x-y)[Math.floor(a.length/2)];
async function main(){const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');try{
 await writeFile(file,execFileSync('git',['show',`${reference}:src/lib/elite/checkpoint.ts`]));
 const baseline=await import('../'+file) as typeof current;
 const before:ReturnType<typeof measure>[]=[],after:ReturnType<typeof measure>[]=[];for(let i=0;i<60;i++){const b=measure(baseline),a=measure(current);if(i>=10){before.push(b);after.push(a);}}
 const summarise=(rows:typeof before)=>({preProposalMedianMs:median(rows.map(r=>r.proposalPathMs)),throughBuyingMarkerMedianMs:median(rows.map(r=>r.totalCheckpointMs)),writesPerEntry:rows[0].writes});
 const result={synthetic:true,storageAdapter:'in-memory, actual JSON CPU; not browser disk or broker latency',baselineCommit:reference,retainedTrades:100,payloadBytes:Buffer.byteLength(payload),samples:50,before:summarise(before),after:summarise(after)};
 console.log(JSON.stringify(result,null,2));await writeFile('/home/user/execution-hotpath-benchmark.json',JSON.stringify(result,null,2));
 }finally{await unlink(file).catch(()=>{});if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else Reflect.deleteProperty(globalThis,'localStorage');}}
void main().catch(e=>{console.error(e);process.exitCode=1;});
