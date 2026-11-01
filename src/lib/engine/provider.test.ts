import { afterEach, describe, expect, it, vi } from 'vitest';
import { DerivProvider } from './provider';

import {DerivClient} from '../deriv/client';
afterEach(()=>vi.restoreAllMocks());
const SYM = 'R_100';

describe('DerivProvider refuses to fabricate', () => {
  it('throws instead of reporting a trade when the socket is not connected', async () => {
    const p = new DerivProvider('deriv_demo');
    expect(p.isConnected()).toBe(false);
    await expect(
      p.execute({ stake: 1, payout: 1.96, askPrice: 1, contractType: 'DIGITODD', symbol: SYM, source: 'deriv_live' }, { authorized: true }),
    ).rejects.toThrow(/not connected|dropped|refusing/i);
  });

  it('labels its own source as deriv_live so provenance is unambiguous', () => {
    const p = new DerivProvider('deriv_demo');
    expect(p.source).toBe('deriv_live');
    expect(p.mode).toBe('deriv_demo');
  });
});


describe('authenticated balance verification',()=>{
 it.each([100,'100.00',0,'0.00'])('accepts a finite broker balance %s without fabricating a value',async(balance)=>{
  vi.spyOn(DerivClient.prototype,'subscribe').mockResolvedValue({balance:{balance,currency:'USD',loginid:'DOT1'}} as never);
  const callback=vi.fn();await new DerivProvider('deriv_demo').streamBalance(callback,{loginid:'DOT1',currency:'USD'});expect(callback).toHaveBeenCalledWith(Number(balance),'USD');
 });
 it.each([null,'',false,'NaN',-1,Infinity])('rejects invalid amount %s',async(balance)=>{
  vi.spyOn(DerivClient.prototype,'subscribe').mockResolvedValue({balance:{balance,currency:'USD'}} as never);const callback=vi.fn();await expect(new DerivProvider('deriv_demo').streamBalance(callback)).rejects.toThrow('invalid');expect(callback).not.toHaveBeenCalled();
 });
 it.each([{loginid:'OTHER',currency:'USD'},{loginid:'DOT1',currency:'EUR'}])('rejects a mismatched identity or currency',async(identity)=>{
  vi.spyOn(DerivClient.prototype,'subscribe').mockResolvedValue({balance:{balance:'100.00',...identity}} as never);await expect(new DerivProvider('deriv_demo').streamBalance(vi.fn(),{loginid:'DOT1',currency:'USD'})).rejects.toThrow('does not match');
 });
 it('revokes a verified socket on malformed replay rather than retaining trading authority',async()=>{
  let frame!:(m:never)=>void;vi.spyOn(DerivClient.prototype,'subscribe').mockImplementation(async(_r,cb)=>{frame=cb;return {balance:{balance:'1.00',currency:'USD'}} as never;});const close=vi.spyOn(DerivClient.prototype,'close').mockImplementation(()=>{});const cb=vi.fn();await new DerivProvider('deriv_demo').streamBalance(cb);frame({balance:{balance:'bad',currency:'USD'}} as never);expect(close).toHaveBeenCalledOnce();expect(cb).toHaveBeenCalledTimes(1);
 });
});
