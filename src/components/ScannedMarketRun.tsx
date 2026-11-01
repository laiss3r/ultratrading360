'use client';
import {useRef} from 'react';
import {useApp} from '@/state/store';
import {CONTRACT_LABELS,type OverlordConfig} from '@/lib/overlord';
import {isAvailable,type DiscoveryRow} from '@/lib/overlord/discovery';
import {scannedRunConfig,scannedRunStrategy} from '@/lib/overlord/scanned-run';
import type {ActiveSymbol} from '@/lib/deriv/types';
import {RunButton} from './Workspace';
export function ScannedMarketRun({row,config,markets,disabled,expired,onPrepared}:{row:DiscoveryRow;config:OverlordConfig;markets:ActiveSymbol[];disabled:boolean;expired:boolean;onPrepared?:(config:OverlordConfig)=>void}){
 const prepared=useRef<DiscoveryRow|null>(null);
 const checkIdle=()=>{const s=useApp.getState();if(s.bot?.hasPendingOrder()||['starting','running','paused','stopping'].includes(s.botState))throw new Error('Stop the active bot and wait for settlement before running another market.');};
 const prepare=async()=>{
  checkIdle();if(!markets.some(m=>m.underlying_symbol===row.symbol&&isAvailable(m)))throw new Error('This market is not currently listed as open by Deriv.');
  const initial=useApp.getState(),account=initial.session?.loginid;
  // Construct directly from the clicked row. Never wait for React to apply a selection.
  const strategy=scannedRunStrategy(row,config,initial.session?.currency??'USD',initial.settings.limits);
  await initial.selectSymbol(row.symbol);checkIdle();
  const state=useApp.getState();if(state.session?.loginid!==account)throw new Error('Account changed. Review this market and Run again.');
  scannedRunConfig(row,config);
  const saved=await state.saveStrategy(strategy);if(!saved.ok)throw new Error(saved.message);
  checkIdle();prepared.current=row;useApp.getState().setActiveStrategy(strategy.id);onPrepared?.(scannedRunConfig(row,config));return strategy.id;
 };
 const beforeRun=()=>{
  checkIdle();if(!prepared.current)throw new Error('Prepare this market again.');
  scannedRunConfig(prepared.current,config);
  if(useApp.getState().activeSymbol!==prepared.current.symbol)throw new Error('Market selection changed. Close this confirmation and Run the intended market again.');
 };
 const best=row.analysis?.best;
 return <div className="scanned-market-run" data-run-contract={best?.contractType} data-run-barrier={best?.barrier} data-run-duration={row.analysis?.duration}><RunButton prepare={prepare} beforeRun={beforeRun} disabled={disabled||expired||row.phase!=='ready'}>Run market</RunButton>{best&&<small>{CONTRACT_LABELS[best.contractType]}{best.barrier===undefined?'':` ${best.barrier}`} · {row.analysis?.duration} tick{row.analysis?.duration===1?'':'s'}</small>}</div>;
}
