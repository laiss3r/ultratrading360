'use client';
import {useEffect,useState} from 'react';
import {DerivProvider,type Quote} from '../engine/provider';
import type {ActiveSymbol} from '../deriv/types';
import {isAvailable,volatilityMarkets} from '../overlord/discovery';
export interface EliteFrame {symbol:string;quotes:Quote[];lastLive?:number;error?:string;phase:'loading'|'ready'|'error'}
export function eliteMarkets(all:ActiveSymbol[]){const volatility=new Set(volatilityMarkets(all).map(s=>s.underlying_symbol));return all.filter(s=>isAvailable(s)&&(volatility.has(s.underlying_symbol)||/step.*index/i.test(s.underlying_symbol_name))).sort((a,b)=>a.underlying_symbol_name.localeCompare(b.underlying_symbol_name,undefined,{numeric:true}));}
export function useEliteMonitor(selected:string[]){
 const [markets,setMarkets]=useState<ActiveSymbol[]>([]),[error,setError]=useState(''),[frames,setFrames]=useState<EliteFrame[]>([]),[clock,setClock]=useState(0),[revision,setRevision]=useState(0);
 const selectedKey=JSON.stringify(selected);
 useEffect(()=>{let disposed=false;const p=new DerivProvider('deriv_demo');void (async()=>{try{await p.connect();const list=await p.activeSymbols('all');if(!disposed){setMarkets(eliteMarkets(list));setError('');}}catch(e){if(!disposed)setError((e as Error).message);}finally{p.disconnect();}})();return()=>{disposed=true;p.disconnect();};},[revision]);
 useEffect(()=>{
  const symbols=JSON.parse(selectedKey) as string[],p=new DerivProvider('deriv_demo'),controller=new AbortController(),disposers:(()=>void)[]=[],data=new Map<string,EliteFrame>();let disposed=false;
  const publish=()=>{if(!disposed){setFrames(symbols.map(symbol=>data.get(symbol)??{symbol,quotes:[],phase:'loading'}));setClock(Date.now());}};
  const timer=setInterval(publish,500);
  void (async()=>{try{
   await p.connect();if(disposed)return;let next=0;
   await Promise.all(Array.from({length:Math.min(3,symbols.length)},async()=>{while(next<symbols.length&&!disposed){const symbol=symbols[next++];data.set(symbol,{symbol,quotes:[],phase:'loading'});
    try{const quotes=await p.history(symbol,1000,controller.signal);if(disposed)return;data.set(symbol,{symbol,quotes,phase:'ready'});const stop=await p.stream(symbol,q=>{if(disposed||q.source!=='deriv_live'||Date.now()-q.epoch*1000>5000||q.epoch*1000>Date.now()+2000)return;const frame=data.get(symbol)!;const last=frame.quotes.at(-1);if(last&&q.epoch<last.epoch)return;const quotes=last?.epoch===q.epoch&&last.price===q.price?frame.quotes:[...frame.quotes,q].slice(-1000);data.set(symbol,{symbol,quotes,phase:'ready',lastLive:q.epoch*1000});});if(disposed){stop();return;}disposers.push(stop);}
    catch(e){if(!disposed)data.set(symbol,{symbol,quotes:[],phase:'error',error:(e as Error).message});}
   }}));publish();
  }catch(e){if(!disposed){setError((e as Error).message);publish();}}})();
  return()=>{disposed=true;controller.abort();clearInterval(timer);disposers.forEach(stop=>stop());p.disconnect();};
 },[selectedKey,revision]);
 return {markets,error,frames:frames.filter(f=>selected.includes(f.symbol)),clock,retry:()=>setRevision(r=>r+1)};
}
