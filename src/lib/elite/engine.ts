import type {Strategy} from '../engine/strategies';
import type {BotEvents,BotState,TradeRecord} from '../engine/bot';
import type {ExecutionEvent,ExecutionPhase} from '../engine/execution';
import type {MarketProvider,Quote,SettledContract} from '../engine/provider';
import {RiskManager} from '../engine/risk';
import {OrderCancelledError} from '../deriv/trading';
import {ContractService} from '../deriv/contracts';
import type {ContractSpec,ActiveSymbol} from '../deriv/types';
import {nextContract,type ContractLeg} from '../engine/rotation';
import {matchesElite,ruleHistory,validateElite,type EliteRule} from './config';
interface Lane {key:string;rule:EliteRule;index:number;market:string;busy:boolean;uncertain:boolean;reserved:number;history:TradeRecord[];event?:ExecutionEvent;lastKey?:string;steps:number}
export interface EliteProvider extends MarketProvider {activeSymbols?:(mode?:'basic'|'all')=>Promise<ActiveSymbol[]>;contractsFor?:(symbol:string)=>Promise<(ContractSpec&{last_digit_range?:number[]})[]>}
const key=(q:Quote)=>`${q.epoch}:${q.price}`;
export class EliteBot {
 state:BotState='idle';readonly runId=`elite_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;
 readonly strategy:Strategy;
 private lanes:Lane[]=[];private series=new Map<string,Quote[]>();private latest=new Map<string,Quote>();private seen=new Map<string,string>();private disposers:(()=>void)[]=[];
 private abort=new AbortController();private health?:ReturnType<typeof setInterval>;private sequence=0;private eventIndex=0;private detail='';private terminal:BotState='stopped';private cursor=new Map<string,number>();
 constructor(strategy:Strategy,private provider:EliteProvider,public risk:RiskManager,private events:BotEvents={},private startingBalance=0,private context:{accountLoginid?:string;canExecute?:()=>boolean}={}){this.strategy=structuredClone(strategy);}
 private get config(){return this.strategy.elite!;}
 private change(state:BotState,detail=''){this.state=state;this.detail=detail;this.events.onStateChange?.(state,detail);}
 private emit(lane:Lane|undefined,phase:ExecutionPhase,detail:string,patch:Partial<ExecutionEvent>={},fresh=false){
  const event:ExecutionEvent={...(!fresh?lane?.event:undefined),id:`${this.runId}:${++this.eventIndex}`,runId:this.runId,at:Date.now(),operationId:lane?.key??'monitor',strategyId:this.strategy.id,strategyName:lane?`Elite Prime Pro · Strategy ${lane.index+1}`:this.strategy.name,tool:'elite',phase,detail,accountLoginid:this.context.accountLoginid,mode:this.provider.mode,currency:this.strategy.currency,symbol:lane?.market??this.strategy.market,contractType:(!fresh?lane?.event?.contractType:undefined)??lane?.rule.contractType??this.strategy.contractType,duration:(!fresh?lane?.event?.duration:undefined)??lane?.rule.duration??this.strategy.duration,durationUnit:'t',...patch};
  if(lane)lane.event=event;this.events.onExecution?.(event);
 }
 getState(){return {state:this.state,detail:this.detail};}
 getOpenExecutions(){return this.lanes.filter(l=>l.event?.contractId&&(l.busy||l.uncertain)).map(l=>({...l.event!}));}
 hasPendingOrder(){return this.lanes.some(l=>l.busy||l.uncertain);}
 getTrades(){return this.lanes.flatMap(l=>l.history).sort((a,b)=>b.closedAt-a.closedAt);}
 getBalance(){return this.risk.getSnapshot().equity;}
 getStartingBalance(){return this.startingBalance;}
 private outstanding(){return this.lanes.filter(l=>l.busy||l.uncertain).length;}
 private dispose(){this.abort.abort();clearInterval(this.health);for(const d of this.disposers.splice(0)){try{d();}catch{/* best-effort unsubscribe */}}}
 stop(reason='Stopped by user',terminal:BotState='stopped'){
  this.terminal=terminal;this.dispose();this.change(this.hasPendingOrder()?'stopping':terminal,reason);
  for(const lane of this.lanes)if(lane.busy||lane.uncertain)this.emit(lane,lane.uncertain?'halted':'stopping',`${reason} No new buys; accepted contracts still settle.`,{outcomeUnresolved:lane.uncertain});
  if(!this.hasPendingOrder())this.emit(undefined,terminal==='halted'?'halted':'stopped',reason);
 }
 pause(){if(this.state==='running'){this.change('paused','Entries paused; existing contracts continue to settle.');this.emit(undefined,'waiting',this.detail);}}
 resume(){if(this.state==='paused'&&this.provider.isConnected()&&(this.context.canExecute?.()??true)){this.change('running','Resumed; awaiting fresh matching live ticks.');this.emit(undefined,'waiting',this.detail);}}
 destroy(){this.stop('Destroyed');/* Shared authenticated provider belongs to the account, not this tool. */}
 private isStarting(){return this.state==='starting';}
 async start(){
  if(this.state!=='idle')return;
  const errors=validateElite(this.config);if(errors.length)throw Error(errors.join(' '));
  this.change('starting','Loading selected markets and validating broker contracts.');this.emit(undefined,'preparing',this.detail);
  this.lanes=this.config.markets.flatMap(market=>this.config.rules.map((rule,index)=>({key:`${rule.id}:${market}`,rule,index,market,busy:false,uncertain:false,reserved:0,history:[],steps:0})));
  const historySize=Math.max(6,...this.config.rules.map(ruleHistory));
  try{
   if(!this.provider.isConnected())throw Error('The authenticated trading channel is not connected.');
   const listed=await this.provider.activeSymbols?.('all');if(listed&&this.config.markets.some(symbol=>!listed.some(m=>m.underlying_symbol===symbol&&m.exchange_is_open!==0&&m.is_trading_suspended!==1)))throw Error('A selected market is no longer open or returned by Deriv. Review the selection.');
   let next=0;const worker=async()=>{while(next<this.config.markets.length&&this.isStarting()){
    const symbol=this.config.markets[next++],specs=await this.provider.contractsFor?.(symbol);
    if(specs){for(const lane of this.lanes.filter(l=>l.market===symbol)){const legs=[{...lane.rule},...(this.config.recoveryEnabled?[{...this.config.recovery.recovery,duration:this.config.recoveryDuration}]:[])];for(const leg of legs){const supported=specs.some(s=>s.contract_type===leg.contractType&&/t$/.test(s.min_contract_duration??'')&&/t$/.test(s.max_contract_duration??'')&&leg.duration>=parseInt(s.min_contract_duration??'')&&leg.duration<=parseInt(s.max_contract_duration??'')&&(!ContractService.requiresBarrier(leg.contractType)||!Array.isArray(s.last_digit_range)||s.last_digit_range.includes(leg.barrier!)));if(!supported)throw Error(`${symbol}: ${leg.contractType} / ${leg.duration} ticks is not listed by Deriv for this setup.`);}}}
    const hist=await this.provider.history(symbol,historySize,this.abort.signal);if(!this.isStarting())return;
    if(hist.length<historySize||hist.some(q=>q.symbol!==symbol))throw Error(`${symbol}: not enough correctly attributed broker history for the configured conditions.`);
    this.series.set(symbol,hist.slice(-3101));this.seen.set(symbol,key(hist.at(-1)!));
    const dispose=await this.provider.stream(symbol,q=>this.tick(q));if(!this.isStarting()){dispose();return;}this.disposers.push(dispose);
   }};
   await Promise.all(Array.from({length:Math.min(3,this.config.markets.length)},worker));

   if(!this.isStarting())return;
   this.change('running','Monitoring all selected markets. Waiting for configured live conditions.');this.emit(undefined,'waiting',this.detail);
   this.health=setInterval(()=>{if(['running','paused'].includes(this.state)&&!this.provider.isConnected())this.stop('Trading connection lost. No automatic execution restart.','halted');},1000);
  }catch(error){if(this.abort.signal.aborted)return;this.stop((error as Error).message,'error');throw error;}
 }
 private tick(q:Quote){
  if(!['starting','running','paused'].includes(this.state)||!this.series.has(q.symbol)||q.source!=='deriv_live'||!Number.isFinite(q.price)||!Number.isInteger(q.digit)||q.digit<0||q.digit>9)return;
  const now=Date.now();if(now-q.epoch*1000>5000||q.epoch*1000>now+2000||this.seen.get(q.symbol)===key(q))return;
  const previous=this.latest.get(q.symbol)??this.series.get(q.symbol)?.at(-1);
  if(previous&&q.epoch<previous.epoch)return;
  if(previous&&q.epoch-previous.epoch>5){this.stop(`${q.symbol}: tick gap invalidated sequential conditions. Restart explicitly to reload broker history.`,'halted');return;}
  this.seen.set(q.symbol,key(q));this.latest.set(q.symbol,q);const hist=this.series.get(q.symbol)!;hist.push(q);if(hist.length>3101)hist.shift();this.events.onQuote?.(q);
  if(this.state!=='running')return;
  if(!this.provider.isConnected()||!(this.context.canExecute?.()??true)){this.stop('Account, connection or trading permission changed.','halted');return;}
  const available=this.lanes.filter(l=>l.market===q.symbol),offset=this.cursor.get(q.symbol)??0;
  for(let n=0;n<available.length;n++){
   const lane=available[(offset+n)%available.length];
   if(lane.busy||lane.uncertain||lane.lastKey===key(q))continue;
   const continuation=this.config.tradingMode==='continuous'&&!!lane.history.length&&lane.history.at(-1)!.profit<=0;
   if(!continuation&&!matchesElite(lane.rule,hist))continue;
   if(this.outstanding()>=this.config.maxConcurrent)return;
   if(this.risk.getSnapshot().tradesThisSession+this.outstanding()>=Math.min(this.risk.limits.maxTrades,this.config.maxEntries)){if(!this.hasPendingOrder())this.stop('Maximum session entries reached.','halted');return;}
   const requested=this.config.stake*(this.config.martingale?Math.pow(this.config.multiplier,Math.min(lane.steps,this.config.stepLimit)):1);
   const decision=this.risk.evaluate(requested,this.provider.mode);this.events.onRisk?.(decision);
   if(decision.halt){this.stop(decision.reasons.join(' '),'halted');return;}if(!decision.allowed)continue;
   if(decision.stake>this.risk.getSnapshot().equity-this.risk.getSnapshot().openExposure)continue;
   // Reservation happens synchronously BEFORE pricing yields: competing lanes see the occupied slot and money.
   lane.busy=true;lane.lastKey=key(q);lane.reserved=decision.stake;this.risk.openExposure(decision.stake);this.cursor.set(q.symbol,(lane.index+1)%available.length);
   const leg=nextContract(lane.rule,this.config.recoveryEnabled?this.config.recovery:undefined,lane.history),duration=leg===lane.rule?lane.rule.duration:this.config.recoveryDuration;
   void this.execute(lane,q,leg,duration,decision.reasons,continuation);
  }
 }
 private canBuy(lane:Lane,q:Quote){
  const d=this.risk.evaluateReserved(lane.reserved,this.provider.mode),current=this.latest.get(lane.market);
  return this.risk.getSnapshot().tradesThisSession+this.outstanding()<=Math.min(this.risk.limits.maxTrades,this.config.maxEntries)&&this.state==='running'&&this.provider.isConnected()&&(this.context.canExecute?.()??true)&&d.allowed&&Math.abs(d.stake-lane.reserved)<1e-8&&!!current&&key(current)===key(q)&&Date.now()-current.epoch*1000<=5000;
 }
 private async execute(lane:Lane,q:Quote,leg:ContractLeg,duration:number,reasons:string[],continuation:boolean){
  const attempt=++this.sequence;let buySent=false;
  this.emit(lane,'qualified',`${continuation?'Continuous-after-loss entry':'Configured conditions matched'}: Strategy ${lane.index+1} on ${lane.market}.`,{contractType:leg.contractType,barrier:ContractService.requiresBarrier(leg.contractType)?leg.barrier:undefined,duration,purchaseSubmitted:false},true);
  try{
   this.emit(lane,'pricing','Requesting an actual broker proposal.',{stake:lane.reserved});
   const priced=await this.provider.price({symbol:lane.market,contractType:leg.contractType,barrier:ContractService.requiresBarrier(leg.contractType)?String(leg.barrier):undefined,stake:lane.reserved,duration,durationUnit:'t',currency:this.strategy.currency});
   if(!this.canBuy(lane,q))throw new OrderCancelledError();
   if(!Number.isFinite(priced.askPrice)||!Number.isFinite(priced.payout)||priced.askPrice<=0||priced.payout<=priced.askPrice||Math.abs(priced.stake-lane.reserved)>1e-8||priced.askPrice>lane.reserved+1e-8)throw Error('Broker quote is invalid or exceeds the reserved stake.');
   const settled=await this.provider.execute(priced,{authorized:true,shouldExecute:fresh=>this.canBuy(lane,q)&&(!fresh||(Number.isFinite(fresh.askPrice)&&Number.isFinite(fresh.payout)&&fresh.askPrice<=lane.reserved&&fresh.payout>fresh.askPrice)),onUpdate:update=>{if(update.phase==='buying')buySent=true;this.emit(lane,update.phase,update.phase==='buying'?'Submitting a verified broker proposal.':'Broker confirmed contract; waiting for actual settlement.',{...Object.fromEntries(Object.entries(update).filter(([,value])=>value!==undefined)),purchaseSubmitted:buySent});}});
   this.settle(lane,settled,attempt,reasons);
  }catch(error){
   if(error instanceof OrderCancelledError){this.risk.releaseReservation(lane.reserved);lane.reserved=0;this.emit(lane,'waiting','Entry cancelled before purchase: signal, permission, Stop or risk changed.',{purchaseSubmitted:false});}
   else if(buySent||lane.event?.contractId){lane.uncertain=true;this.emit(lane,'halted',`Broker outcome unresolved: ${(error as Error).message}. Verify the contract before any restart.`,{outcomeUnresolved:true});this.stop('A broker outcome is unresolved; no new orders are allowed.','halted');this.events.onError?.(error as Error);}
   else {this.risk.releaseReservation(lane.reserved);lane.reserved=0;this.emit(lane,'error',(error as Error).message);this.stop((error as Error).message,'error');this.events.onError?.(error as Error);}
  }finally{
   lane.busy=false;
   if(this.lanes.some(l=>l.uncertain)&&!this.lanes.some(l=>l.busy))this.change('halted','Broker outcome unresolved. Reconcile before restarting.');
   if(!this.hasPendingOrder()&&this.state==='stopping')this.change(this.terminal,this.detail);
   if(this.state==='running'){const d=this.risk.evaluate(this.config.stake,this.provider.mode);if(d.halt)this.stop(d.reasons.join(' '),'halted');}
  }
 }
 private settle(lane:Lane,s:SettledContract,attempt:number,reasons:string[]=[]){
  if(!s.contractId||![s.stake,s.profit,s.payout].every(Number.isFinite)||s.stake<=0||s.stake>lane.reserved+1e-8||s.payout<0||Math.abs(s.payout-s.stake-s.profit)>.02)throw Error('Broker settlement is incomplete or inconsistent.');
  if(lane.reserved>s.stake)this.risk.releaseReservation(lane.reserved-s.stake);this.risk.closeExposure(s.stake,s.profit);lane.reserved=0;lane.uncertain=false;
  const e=lane.event!,record:TradeRecord={id:`${this.runId}:${lane.key}:${attempt}`,idempotencyKey:`${this.runId}:${lane.key}:${attempt}`,runId:this.runId,accountLoginid:this.context.accountLoginid,strategyId:this.strategy.id,strategyVersion:this.strategy.version,strategyName:e.strategyName??this.strategy.name,symbol:lane.market,contractType:e.contractType,barrier:e.barrier===undefined?undefined:String(e.barrier),currency:this.strategy.currency,duration:e.duration,durationUnit:'t',contractId:s.contractId,stake:s.stake,payout:s.payout,profit:s.profit,won:s.profit>0,openedAt:s.openedAt??e.dateStart??e.at,closedAt:s.closedAt??Date.now(),entryDigit:s.entryDigit,exitDigit:s.exitDigit,entryPrice:s.entryPrice,exitPrice:s.exitPrice,pipSize:s.pipSize,potentialPayout:s.potentialPayout,longcode:s.longcode,buyTransactionId:s.buyTransactionId,sellTransactionId:s.sellTransactionId,dateExpiry:s.dateExpiry,mode:this.provider.mode,source:'deriv_live',riskReasons:reasons,gateReasons:['Configured Elite conditions matched a fresh broker tick; account, exposure and broker quote verified.']};
  lane.history.push(record);lane.steps=s.profit>0?0:lane.steps+1;this.events.onTrade?.(record);this.emit(lane,'settled',`Contract settled: ${s.profit>0?'profit':s.profit<0?'loss':'zero net'} ${s.profit.toFixed(2)} ${this.strategy.currency}.`,{contractId:s.contractId,profit:s.profit,contractValue:s.payout,entryPrice:s.entryPrice,exitPrice:s.exitPrice,outcomeUnresolved:false});
 }
 /** Read-only reconciliation supplies an actual terminal broker result, never an invented outcome. */
 reconcileContract(contractId:number,settled:SettledContract){const lane=this.lanes.find(l=>l.uncertain&&l.event?.contractId===contractId);if(!lane)return false;this.settle(lane,settled,++this.sequence);if(!this.hasPendingOrder())this.change(this.terminal,'Broker reconciliation complete. Restart still requires explicit confirmation.');return true;}
}
