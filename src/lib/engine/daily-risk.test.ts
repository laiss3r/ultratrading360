import {describe,it,expect} from 'vitest';
import {dailyRiskKey,dailyRiskPnl,mergeDailyRisk,validateDailyRiskBook} from './daily-risk';
import type {TradeRecord} from './bot';
const date='2026-11-03',t=(patch:Partial<TradeRecord>={}):TradeRecord=>({id:'t1',contractId:123,accountLoginid:'DOT_TEST',mode:'deriv_demo',currency:'USD',source:'deriv_live',profit:-10,closedAt:Date.parse(date+'T12:00:00Z'),...patch} as TradeRecord);
describe('durable daily loss contributions',()=>{
 it('deduplicates repeated/reconciled broker contracts and does not mutate the prior book',()=>{const one=mergeDailyRisk({},[t()]);const two=mergeDailyRisk(one,[t({id:'reconciled'})]);expect(dailyRiskPnl(two,'DOT_TEST','deriv_demo','USD',date)).toBe(-10);expect(one).toEqual(two);expect(two).not.toBe(one);});
 it('corrects a contract contribution rather than double counting',()=>{const book=mergeDailyRisk(mergeDailyRisk({},[t()]),[t({profit:-5})]);expect(dailyRiskPnl(book,'DOT_TEST','deriv_demo','USD',date)).toBe(-5);});
 it('isolates account, mode, currency and UTC day',()=>{const book=mergeDailyRisk({},[t(),t({accountLoginid:'OTHER',profit:-20}),t({mode:'deriv_real',profit:-30}),t({currency:'EUR',profit:-40}),t({closedAt:Date.parse('2026-11-04T00:00:00Z'),profit:-50})]);expect(Object.keys(book)).toHaveLength(5);expect(dailyRiskPnl(book,'DOT_TEST','deriv_demo','USD',date)).toBe(-10);expect(dailyRiskPnl(book,'DOT_TEST','deriv_demo','USD','2026-11-04')).toBe(-50);});
 it('adds gains and losses, excluding errors and unidentified/corrupt records',()=>{const book=mergeDailyRisk({},[t(),t({contractId:124,profit:3}),t({contractId:125,profit:0}),t({error:'unconfirmed'}),t({accountLoginid:undefined}),t({currency:undefined}),t({profit:NaN}),t({closedAt:Infinity})]);expect(dailyRiskPnl(book,'DOT_TEST','deriv_demo','USD',date)).toBe(-7);});
 it('treats unknown accounts/currencies as no attributed results',()=>{const book=mergeDailyRisk({},[t()]);expect(dailyRiskPnl(book,undefined,'deriv_demo','USD',date)).toBe(0);expect(dailyRiskPnl(book,'DOT_TEST','deriv_demo',undefined,date)).toBe(0);});
 it('restores after serialization and keeps results when display records are empty',()=>{const book=JSON.parse(JSON.stringify(mergeDailyRisk({},[t()])));expect(dailyRiskPnl(mergeDailyRisk(validateDailyRiskBook(book),[]),'DOT_TEST','deriv_demo','USD',date)).toBe(-10);});
 it.each([[],42,{'bad':{}},{[dailyRiskKey('A','deriv_demo','USD',date)]:{x:NaN}},{[dailyRiskKey('A','deriv_demo','USD',date)]:[]}])('fails closed on malformed stored ledger %#',value=>{expect(()=>validateDailyRiskBook(value)).toThrow();});
 it('accepts absent and empty ledgers',()=>{expect(validateDailyRiskBook(undefined)).toEqual({});expect(validateDailyRiskBook({})).toEqual({});});
});
