import type {ContractType} from '../deriv/contracts';
import {ContractService} from '../deriv/contracts';
import type {Quote} from '../engine/provider';
import {validateLeg,type ContractRotation} from '../engine/rotation';
import {createStrategy,type Strategy} from '../engine/strategies';
import type {RiskLimits} from '../engine/risk';
export type DigitPredicate='ODD'|'EVEN'|'OVER'|'UNDER'|'EQUAL'|'RISE'|'FALL';
export type Comparison='>'|'<'|'=';
export type EliteCondition={id:string;type:'digits';lookback:number;predicate:DigitPredicate;digit:number}|{id:string;type:'percentage';predicate:DigitPredicate;digit:number;operator:Comparison;value:number}|{id:string;type:'bar';bar:'most'|'least';operator:Comparison;digit:number};
export interface EliteRule {id:string;conditions:EliteCondition[];contractType:ContractType;barrier:number;duration:number}
export interface EliteConfig {version:1;rules:EliteRule[];markets:string[];stake:number;targetProfit:number;stopLoss:number;maxEntries:number;maxConcurrent:number;maxOpenExposure:number;martingale:boolean;multiplier:number;stepLimit:number;tradingMode:'analyze'|'continuous';recoveryEnabled:boolean;recovery:ContractRotation;recoveryDuration:number}
export const eliteId=()=>`ep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;
export const defaultCondition=():EliteCondition=>({id:eliteId(),type:'digits',lookback:4,predicate:'ODD',digit:4});
export const defaultRule=():EliteRule=>({id:eliteId(),conditions:[defaultCondition()],contractType:'DIGITEVEN',barrier:4,duration:1});
export const defaultElite=():EliteConfig=>({version:1,rules:[defaultRule()],markets:[],stake:1,targetProfit:100,stopLoss:100,maxEntries:50,maxConcurrent:2,maxOpenExposure:10,martingale:false,multiplier:2.1,stepLimit:4,tradingMode:'analyze',recoveryEnabled:false,recovery:{mode:'return-after-recovery',recovery:{contractType:'DIGITODD'},alternateTimes:1},recoveryDuration:1});
const predicates:DigitPredicate[]=['ODD','EVEN','OVER','UNDER','EQUAL','RISE','FALL'];
export const conditionSize=(c:EliteCondition)=>c.type==='digits'?c.lookback:c.type==='percentage'?100:1000;
export const ruleHistory=(rule:EliteRule)=>rule.conditions.reduce((n,c)=>n+conditionSize(c),0)+1;
const compare=(a:number,op:Comparison,b:number)=>op==='>'?a>b:op==='<'?a<b:a===b;
function digitMatches(d:number,p:DigitPredicate,digit:number){return p==='ODD'?d%2!==0:p==='EVEN'?d%2===0:p==='OVER'?d>digit:p==='UNDER'?d<digit:p==='EQUAL'?d===digit:false;}
/** Multiple conditions match consecutive non-overlapping blocks, oldest to newest. */
export function matchesElite(rule:EliteRule,quotes:Quote[]):boolean{
 const total=ruleHistory(rule)-1;if(quotes.length<total+1)return false;
 const input=quotes.slice(-(total+1));let offset=0;
 for(const c of rule.conditions){const n=conditionSize(c),block=input.slice(offset+1,offset+1+n),before=input.slice(offset,offset+n);offset+=n;
  if(block.some(q=>!Number.isFinite(q.price)||!Number.isInteger(q.digit)||q.digit<0||q.digit>9))return false;
  if(c.type==='bar'){const counts=Array(10).fill(0) as number[];block.forEach(q=>counts[q.digit]++);const selected=counts.indexOf(c.bar==='most'?Math.max(...counts):Math.min(...counts));if(!compare(selected,c.operator,c.digit))return false;}
  else {const hits=block.filter((q,i)=>c.predicate==='RISE'?q.price>before[i].price:c.predicate==='FALL'?q.price<before[i].price:digitMatches(q.digit,c.predicate,c.digit)).length;
   if(c.type==='digits'?hits!==n:!compare(hits,c.operator,c.value))return false;
  }
 }
 return true;
}
export function validateElite(c:EliteConfig):string[]{
 const errors:string[]=[];
 if(!c||typeof c!=='object')return ['Invalid Elite configuration.'];
 if(c.version!==1)errors.push('Unsupported Elite configuration version.');
 if(!Array.isArray(c.rules)||c.rules.length<1||c.rules.length>5)return ['Configure one to five strategies.'];
 if(!Array.isArray(c.markets)||!c.markets.length||c.markets.some(m=>typeof m!=='string'||!m.trim())||new Set(c.markets).size!==c.markets.length)errors.push('Choose unique broker-returned markets.');
 if(c.rules.some(r=>!r||typeof r!=='object'||typeof r.id!=='string'||!r.id.trim()))return [...errors,'Invalid strategy definition.'];
 if(typeof c.martingale!=='boolean'||typeof c.recoveryEnabled!=='boolean')errors.push('Recovery and martingale switches must be boolean.');
 if(new Set(c.rules.map(r=>r.id)).size!==c.rules.length)errors.push('Strategy identifiers must be unique.');
 for(const [key,value] of Object.entries({stake:c.stake,targetProfit:c.targetProfit,stopLoss:c.stopLoss,maxOpenExposure:c.maxOpenExposure}))if(!Number.isFinite(value)||value<=0)errors.push(`${key} must be finite and positive.`);
 if(!Number.isInteger(c.maxEntries)||c.maxEntries<1||c.maxEntries>10000)errors.push('Maximum entries must be 1–10,000.');
 if(!Number.isInteger(c.maxConcurrent)||c.maxConcurrent<1||c.maxConcurrent>10)errors.push('Concurrent contracts must be 1–10.');
 if(c.stake>c.maxOpenExposure)errors.push('Open exposure must cover at least one base stake.');
 if(!['analyze','continuous'].includes(c.tradingMode))errors.push('Invalid trading mode.');
 if(!Number.isFinite(c.multiplier)||c.multiplier<=1||c.multiplier>10)errors.push('Martingale multiplier must be above 1 and at most 10.');
 if(!Number.isInteger(c.stepLimit)||c.stepLimit<1||c.stepLimit>10)errors.push('Escalation steps must be 1–10.');
 for(const [i,rule] of c.rules.entries()){
  errors.push(...validateLeg(rule).map(e=>`Strategy ${i+1}: ${e}`));
  if(!Number.isInteger(rule.duration)||rule.duration<1||rule.duration>10)errors.push(`Strategy ${i+1}: duration must be 1–10 ticks.`);
  if(!Array.isArray(rule.conditions)||rule.conditions.length<1||rule.conditions.length>3){errors.push(`Strategy ${i+1}: use one to three sequential conditions.`);continue;}
  if(rule.conditions.some(x=>!x||typeof x!=='object'||typeof x.id!=='string'||!x.id.trim())||new Set(rule.conditions.map(x=>x?.id)).size!==rule.conditions.length){errors.push('Condition identifiers must be unique and non-empty.');continue;}
  for(const x of rule.conditions){
   if(!['digits','percentage','bar'].includes(x.type)){errors.push('Unknown condition type.');continue;}
   if(x.type==='digits'&&(!Number.isInteger(x.lookback)||x.lookback<1||x.lookback>10))errors.push('Last-digit/move lookback must be 1–10.');
   if(x.type!=='bar'&&!predicates.includes(x.predicate))errors.push('Invalid digit/move condition.');
   if(!Number.isInteger(x.digit)||x.digit<0||x.digit>9)errors.push('Condition digit must be 0–9.');
   if(x.type!=='digits'&&!['>','<','='].includes(x.operator))errors.push('Invalid comparison.');
   if(x.type==='percentage'&&(!Number.isFinite(x.value)||x.value<0||x.value>100))errors.push('Observed percentage must be 0–100.');
   if(x.type==='bar'&&!['most','least'].includes(x.bar))errors.push('Invalid digit bar.');
  }
 }
 if(c.recoveryEnabled&&(!c.recovery||typeof c.recovery!=='object'||!c.recovery.recovery||typeof c.recovery.recovery!=='object'))return [...errors,'Invalid recovery definition.'];
 if(c.recoveryEnabled){errors.push(...validateLeg(c.recovery.recovery));if(!['return-after-recovery','switch-on-loss','alternate'].includes(c.recovery.mode))errors.push('Invalid recovery mode.');if(!Number.isInteger(c.recovery.alternateTimes)||c.recovery.alternateTimes<1||c.recovery.alternateTimes>5)errors.push('Alternate interval must be 1–5.');if(!Number.isInteger(c.recoveryDuration)||c.recoveryDuration<1||c.recoveryDuration>10)errors.push('Recovery duration must be 1–10 ticks.');}
 return errors;
}
export function eliteStrategy(config:EliteConfig,currency:string,global:RiskLimits):Strategy{
 const errors=validateElite(config);if(errors.length)throw Error(errors.join(' '));
 if(config.stake<global.minStake||config.stake>global.maxStake)throw Error(`Stake must respect the global range ${global.minStake}–${global.maxStake}.`);
 const frozen=structuredClone(config),first=frozen.rules[0];
 return createStrategy({name:'Elite Prime Pro',market:frozen.markets[0],contractType:first.contractType,barrier:ContractService.requiresBarrier(first.contractType)?first.barrier:undefined,duration:first.duration,durationUnit:'t',stake:frozen.stake,currency,entry:{id:'elite-root',op:'AND',children:[{id:'elite-managed',kind:'always'}]},maxTrades:frozen.maxEntries,maxExposure:global.maxSessionExposure,limits:{...global,maxTrades:Math.min(global.maxTrades,frozen.maxEntries),maxOpenExposure:Math.min(global.maxOpenExposure,frozen.maxOpenExposure),maxSessionLoss:Math.min(global.maxSessionLoss,frozen.stopLoss),maxSessionProfit:global.maxSessionProfit>0?Math.min(global.maxSessionProfit,frozen.targetProfit):frozen.targetProfit},elite:frozen});
}
export function conditionDescription(c:EliteCondition){const p=c.type!=='bar'?c.predicate:'';const predicate=p==='OVER'?`over ${c.type!=='bar'?c.digit:''}`:p==='UNDER'?`under ${c.type!=='bar'?c.digit:''}`:p==='EQUAL'?`equal to ${c.type!=='bar'?c.digit:''}`:p.toLowerCase();return c.type==='digits'?`last ${c.lookback} ${['RISE','FALL'].includes(p)?'moves':'digits'} are ${predicate}`:c.type==='percentage'?`${predicate} frequency in 100 outcomes ${c.operator} ${c.value}%`:`${c.bar}-frequent digit in 1,000 ticks ${c.operator} ${c.digit}`;}
