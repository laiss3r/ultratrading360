/** CONTROLLED SYNTHETIC benchmark only. No credentials, socket, proposals or orders.
 * Run with: /home/user/pwtest/node_modules/.bin/tsx tools/execution-latency-bench.ts
 * Compares actual source at the previous release with this working tree. */
import {writeFile,unlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {EliteBot} from '../src/lib/elite/engine';
import {defaultElite,eliteStrategy} from '../src/lib/elite/config';
import {DEFAULT_RISK_LIMITS,RiskManager} from '../src/lib/engine/risk';
import type {MarketProvider} from '../src/lib/engine/provider';
import type {TradeRecord} from '../src/lib/engine/bot';
import * as checkpoint from '../src/lib/elite/checkpoint';
import {sessionJournal} from '../src/lib/engine/session-ledger';
const reference='37897793f5a229a62cbf69b54312288e4eec3597';
const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
function trade(i:number):TradeRecord{return {id:`t${i}`,runId:'elite_bench',accountLoginid:'SYNTHETIC_BENCH',mode:'deriv_demo',source:'deriv_live',contractId:i,strategyId:'s',strategyName:'SYNTHETIC ONLY',strategyVersion:1,idempotencyKey:`i${i}`,currency:'USD',symbol:'R_10',contractType:'DIGITEVEN',stake:1,profit:-1,payout:0,won:false,openedAt:i,closedAt:i+1,riskReasons:[],gateReasons:[]};}
async function main(){
 const files=['src/lib/elite/.engine-baseline.ts','src/lib/elite/.checkpoint-baseline.ts','src/lib/engine/.ledger-baseline.ts'];
 try{
  for(const [i,path] of ['src/lib/elite/engine.ts','src/lib/elite/checkpoint.ts','src/lib/engine/session-ledger.ts'].entries())await writeFile(files[i],execFileSync('git',['show',`${reference}:${path}`]));
  const oldEngine=await import('../'+files[0]) as {EliteBot:typeof EliteBot},oldCheckpoint=await import('../'+files[1]) as typeof checkpoint,oldLedger=await import('../'+files[2]) as {sessionJournal:typeof sessionJournal};
  async function startup(Bot:typeof EliteBot){const limits={...DEFAULT_RISK_LIMITS,tradingEnabled:true},strategy=eliteStrategy({...defaultElite(),markets:['R_10']},'USD',limits);const p:MarketProvider={mode:'deriv_demo',source:'deriv_live',isConnected:()=>true,connect:async()=>{},disconnect:()=>{},history:async(symbol,n)=>{await delay(90);return Array.from({length:n},(_,i)=>({symbol,price:100.01,digit:1,pipSize:2,epoch:Math.floor(Date.now()/1000)-n+i+1,source:'deriv_history' as const}));},stream:async()=>()=>{},price:async()=>{throw Error('Benchmark cannot price');},execute:async()=>{throw Error('Benchmark cannot buy');}};Object.assign(p,{contractsFor:async()=>{await delay(60);return [{contract_type:'DIGITEVEN',min_contract_duration:'1t',max_contract_duration:'10t'}];}});const b=new Bot(strategy,p,new RiskManager(strategy.limits,undefined,1000));const t=performance.now();try{await b.start();return performance.now()-t;}finally{b.stop();}}
  function receiptBench(api:typeof checkpoint){const data=new Map<string,string>();let writes=0;Object.assign(globalThis,{localStorage:{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{writes++;data.set(k,v);},removeItem:(k:string)=>data.delete(k)}});for(let i=1;i<=100;i++)api.checkpointEliteTrade(trade(i));writes=0;const event={id:'receipt',runId:'elite_bench',operationId:'rule:R_10',tool:'elite' as const,accountLoginid:'SYNTHETIC_BENCH',mode:'deriv_demo' as const,at:1,phase:'open' as const,detail:'SYNTHETIC receipt',symbol:'R_10',contractType:'DIGITEVEN' as const,duration:1,durationUnit:'t',currency:'USD',contractId:999,stake:1,purchaseSubmitted:true};const t=performance.now();for(let i=0;i<1000;i++)api.checkpointEliteEvent({...event,id:`tick${i}`,currentSpot:100+i/100,recordedTicks:i,profit:i/100});return {ms:performance.now()-t,writes};}
  const records=Array.from({length:5000},(_,i)=>trade(i+1));const events=records.slice(-500).map(t=>({id:t.id,runId:t.runId!,at:t.closedAt,phase:'settled' as const,detail:'SYNTHETIC result',accountLoginid:t.accountLoginid,mode:t.mode,currency:'USD',symbol:t.symbol,contractType:'DIGITEVEN' as const,duration:1,durationUnit:'t',contractId:t.contractId,profit:t.profit}));
  const validEvents=events as Parameters<typeof sessionJournal>[1];
  function median(fn:typeof sessionJournal){const samples=[];for(let i=0;i<7;i++){const t=performance.now();fn(records,validEvents);samples.push(performance.now()-t);}return samples.sort((a,b)=>a-b)[3];}
  const startupBefore=await startup(oldEngine.EliteBot),startupAfter=await startup(EliteBot),receiptBefore=receiptBench(oldCheckpoint),receiptAfter=receiptBench(checkpoint),ledgerBefore=median(oldLedger.sessionJournal),ledgerAfter=median(sessionJournal);
  const report={synthetic:true,baselineCommit:reference,conditions:{capabilityDelayMs:60,historyDelayMs:90,receiptProgressFrames:1000,retainedTrades:100,historyRows:5000,lifecycleRows:500},startupMs:{before:startupBefore,after:startupAfter},receiptUpdates:{before:receiptBefore,after:receiptAfter},ledgerMedianMs:{before:ledgerBefore,after:ledgerAfter}};
  console.log(JSON.stringify(report,null,2));await writeFile('/home/user/execution-latency-benchmark.json',JSON.stringify(report,null,2));
 }finally{for(const p of files)await unlink(p).catch(()=>{});}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
