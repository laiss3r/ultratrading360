import { describe, expect, it } from 'vitest';
import { DerivProvider } from './provider';

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
