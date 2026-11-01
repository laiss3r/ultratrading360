import {describe,expect,it} from 'vitest';
import {conditionDescription,defaultElite,defaultRule,eliteStrategy,matchesElite,validateElite,type EliteCondition,type EliteRule,type EliteConfig} from './config';
import {DEFAULT_RISK_LIMITS} from '../engine/risk';
import type {Quote} from '../engine/provider';
const quotes=(digits:number[],prices?:number[]):Quote[]=>digits.map((digit,i)=>({symbol:'R_10',price:prices?.[i]??100+digit/100,digit,epoch:1700000000+i,pipSize:2,source:'deriv_live'}));
const rule=(conditions:EliteCondition[]):EliteRule=>({...defaultRule(),conditions});
const digits=(lookback:number,predicate:'ODD'|'EVEN'|'OVER'|'UNDER'|'EQUAL'|'RISE'|'FALL'='ODD',digit=4):EliteCondition=>({id:Math.random().toString(),type:'digits',lookback,predicate,digit});
describe('Elite exact sequential condition semantics',()=>{
 it('requires all last four digits to match, without inventing missing history',()=>{const r=rule([digits(4)]);expect(matchesElite(r,quotes([0,1,3,5,9]))).toBe(true);expect(matchesElite(r,quotes([0,1,3,2,9]))).toBe(false);expect(matchesElite(r,quotes([1,3,5,9]))).toBe(false);});
 it('compares consecutive blocks, not incompatible conditions over the same final ticks',()=>{const r=rule([digits(2,'ODD'),digits(2,'EVEN')]);expect(matchesElite(r,quotes([0,1,3,2,4]))).toBe(true);expect(matchesElite(r,quotes([0,2,4,1,3]))).toBe(false);});
 it.each([['OVER',4,[5,9],true],['OVER',4,[4,9],false],['UNDER',4,[0,3],true],['UNDER',4,[4,3],false],['EQUAL',4,[4,4],true]] as const)('uses strict %s %i predicates', (predicate,digit,sample,expected)=>{expect(matchesElite(rule([digits(2,predicate,digit)]),quotes([0,...sample]))).toBe(expected);});
 it('derives rises/falls from actual adjacent prices and treats flats as neutral',()=>{const r=rule([digits(2,'RISE')]);expect(matchesElite(r,quotes([1,1,1],[100,101,102]))).toBe(true);expect(matchesElite(r,quotes([1,1,1],[100,100,102]))).toBe(false);});
 it('measures percentages over exactly 100 observations with no warmup shortcut',()=>{const r=rule([{id:'p',type:'percentage',predicate:'EVEN',digit:4,operator:'>',value:60}]);const q=quotes([0,...Array(61).fill(2),...Array(39).fill(1)]);expect(matchesElite(r,q)).toBe(true);expect(matchesElite(r,q.slice(1))).toBe(false);});
 it('digit bars compare the digit number, using a deterministic lowest-digit tie',()=>{const r=rule([{id:'b',type:'bar',bar:'most',digit:0,operator:'='}]);expect(matchesElite(r,quotes([9,...Array.from({length:1000},(_,i)=>i%10)]))).toBe(true);});
 it('keeps numeric values honest when quote data is invalid',()=>{expect(matchesElite(rule([digits(1)]),[{...quotes([1,1])[0]}, {...quotes([1,1])[1],digit:NaN}])).toBe(false);});
});
describe('Elite setup validation and caps',()=>{
 it('requires selected markets, one to five strategies and at most three conditions',()=>{expect(validateElite(defaultElite()).join(' ')).toMatch(/markets/);const c={...defaultElite(),markets:['R_10'],rules:Array.from({length:6},defaultRule)};expect(validateElite(c).join(' ')).toMatch(/five/);});
 it.each([0,11,NaN,1.5])('rejects invalid concurrency %s',maxConcurrent=>{expect(validateElite({...defaultElite(),markets:['R_10'],maxConcurrent}).join(' ')).toMatch(/Concurrent/);});
 it('freezes the selected configuration and tightens rather than enlarges global risk limits',()=>{const config={...defaultElite(),markets:['R_10'],maxEntries:5,maxOpenExposure:99,stopLoss:999,targetProfit:999};const s=eliteStrategy(config,'EUR',{...DEFAULT_RISK_LIMITS,maxOpenExposure:3,maxSessionLoss:10,maxSessionProfit:20});expect(s).toMatchObject({currency:'EUR',maxTrades:5,limits:{maxTrades:5,maxOpenExposure:3,maxSessionLoss:10,maxSessionProfit:20}});config.markets.push('R_25');expect(s.elite!.markets).toEqual(['R_10']);});
 it('rejects impossible barriers and malformed condition thresholds',()=>{const c={...defaultElite(),markets:['R_10']};c.rules[0].contractType='DIGITOVER';c.rules[0].barrier=9;expect(validateElite(c).join(' ')).toContain('cannot win');});
 it('never describes observed percentages as a guaranteed probability',()=>{expect(conditionDescription({id:'x',type:'percentage',predicate:'EVEN',digit:4,value:60,operator:'>'})).toBe('even frequency in 100 outcomes > 60%');});
});
it('rejects malformed saved objects instead of throwing or enabling implicit recovery',()=>{
 for(const value of [null,{version:1,rules:[null]},{...defaultElite(),rules:[{...defaultRule(),conditions:[null]}]},{...defaultElite(),recoveryEnabled:true,recovery:null},{...defaultElite(),martingale:'true'}])expect(validateElite(value as unknown as EliteConfig).length).toBeGreaterThan(0);
});
