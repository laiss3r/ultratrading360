import {overlordStrategy,type OverlordConfig} from '@/lib/overlord';
import {DISCOVERY_POLICY,type DiscoveryRow} from './discovery';
import type {RiskLimits} from '@/lib/engine/risk';
/** Pin a result to its own market, contract/barrier and analysed duration. Never infer a trade. */
export function scannedRunConfig(row:DiscoveryRow,config:OverlordConfig,now=Date.now()):OverlordConfig{
 const analysis=row.analysis;
 if(row.phase!=='ready'||!analysis||!analysis.best)throw new Error('Wait for this market to finish historical analysis.');
 if(!Number.isFinite(analysis.to)||now-analysis.to*1000>=DISCOVERY_POLICY.cacheMs||analysis.to*1000>now+2000)throw new Error('This market result has expired. Refresh history before running.');
 if(analysis.duration!==config.duration)throw new Error('Duration changed. Wait for a fresh analysis for the selected duration.');
 return {...config,contractType:analysis.best.contractType,barrier:analysis.best.barrier??config.barrier,duration:analysis.duration};
}
export function scannedRunStrategy(row:DiscoveryRow,config:OverlordConfig,currency:string,limits:RiskLimits,now=Date.now()){
 return overlordStrategy(scannedRunConfig(row,config,now),row.symbol,currency,limits);
}
