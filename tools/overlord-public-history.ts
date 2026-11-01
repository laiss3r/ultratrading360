/** Genuine public read-only validation. No account, credentials, stream subscription or buy. */
import WebSocket from 'ws';
import {writeFile} from 'node:fs/promises';
import {DerivProvider} from '../src/lib/engine/provider';
import {HistoricalDiscovery,type DiscoveryRow,type DiscoveryProvider} from '../src/lib/overlord/discovery';
async function main(){
 Object.assign(globalThis,{WebSocket});
 const provider=new DerivProvider('deriv_demo'),discovery=new HistoricalDiscovery(provider as DiscoveryProvider),controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),90000);const started=Date.now();let rows:DiscoveryRow[]=[],firstMs:number|undefined;let apiCount=0;
 try{
  await discovery.scan(1,{signal:controller.signal,onMarkets:markets=>{apiCount=markets.length;},onUpdate:r=>{rows=r;if(firstMs===undefined&&rows.some(r=>r.phase==='ready'))firstMs=Date.now()-started;}});
  const ready=rows.filter(r=>r.phase==='ready');if(!ready.length)throw new Error('No actual history analyses completed.');
  for(const row of ready){const a=row.analysis!;if(a.sample!==a.counts.reduce((a,b)=>a+b,0))throw new Error('Histogram sample mismatch');for(const o of a.opportunities){if(o.probability!==o.hits/o.sample)throw new Error('Probability does not match actual count');}}
  const report={readOnly:true,buySent:false,streamOpened:false,apiVolatilityMarkets:apiCount,total:rows.length,analysed:ready.length,failed:rows.filter(r=>r.phase==='error').map(r=>({name:r.name,error:r.error})),unavailable:rows.filter(r=>r.phase==='unavailable').length,firstResultMs:firstMs,totalMs:Date.now()-started,rows};
  await writeFile('/home/user/overlord-public-history.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,rows:ready.map(r=>({name:r.name,ticks:r.analysis!.ticks,best:r.analysis!.best}))},null,2));if(report.failed.length||rows.length!==apiCount)process.exitCode=1;
 }finally{clearTimeout(timeout);controller.abort();discovery.close();}
}
void main().catch(e=>{console.error(e.message);process.exitCode=1;});
