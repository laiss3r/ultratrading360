import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DerivProvider, SimulationProvider, type Quote } from './provider';

const SYM = 'R_100';

async function sim(seed: string) {
  const p = new SimulationProvider({ seed });
  await p.connect();
  return p;
}

describe('SimulationProvider reproducibility', () => {
  it('produces a byte-identical series for the same seed', async () => {
    const a = await sim('repro-seed');
    const b = await sim('repro-seed');
    const ha = await a.history(SYM, 400);
    const hb = await b.history(SYM, 400);
    expect(ha.length).toBe(400);
    expect(ha.map((q) => q.price)).toEqual(hb.map((q) => q.price));
    expect(ha.map((q) => q.digit)).toEqual(hb.map((q) => q.digit));
    expect(ha.map((q) => q.epoch)).toEqual(hb.map((q) => q.epoch));
  });

  it('produces a DIFFERENT series for a different seed', async () => {
    const a = await sim('seed-one');
    const b = await sim('seed-two');
    const ha = await a.history(SYM, 200);
    const hb = await b.history(SYM, 200);
    expect(ha.map((q) => q.price)).not.toEqual(hb.map((q) => q.price));
  });

  it('keeps each symbol independent under one session seed', async () => {
    const p = await sim('one-seed');
    const r100 = await p.history('R_100', 150);
    const hz = await p.history('1HZ100V', 150);
    expect(r100.map((q) => q.price)).not.toEqual(hz.map((q) => q.price));
    // Independent, but each still individually reproducible.
    const p2 = await sim('one-seed');
    expect((await p2.history('1HZ100V', 150)).map((q) => q.price)).toEqual(hz.map((q) => q.price));
  });

  it('replaying history twice from a fresh provider is stable (no hidden global state)', async () => {
    const p = await sim('stable');
    const first = await p.history(SYM, 50);
    const q = await sim('stable');
    const second = await q.history(SYM, 50);
    expect(first.map((x) => x.digit)).toEqual(second.map((x) => x.digit));
  });
});

describe('SimulationProvider digit extraction', () => {
  it('labels every quote with its source and the instrument pip size', async () => {
    const p = await sim('prov');
    const h = await p.history(SYM, 50);
    for (const q of h) {
      expect(q.source).toBe('simulation');
      expect(q.symbol).toBe(SYM);
      expect(q.digit).toBeGreaterThanOrEqual(0);
      expect(q.digit).toBeLessThanOrEqual(9);
      expect(q.pipSize).toBeGreaterThanOrEqual(0);
    }
  });

  it('derives the digit from the price using the same pip_size rule as the live path', async () => {
    const { lastDigit } = await import('@/lib/deriv/digits');
    const p = await sim('digits');
    const h = await p.history(SYM, 300);
    for (const q of h) expect(q.digit).toBe(lastDigit(q.price, q.pipSize));
  });

  it('produces all ten digits over a long run (no degenerate generator)', async () => {
    const p = await sim('spread');
    const h = await p.history(SYM, 4000);
    const seen = new Set(h.map((q) => q.digit));
    expect(seen.size).toBe(10);
  });
});

describe('SimulationProvider connection gating', () => {
  it('refuses to SETTLE a trade or open a stream while disconnected rather than faking it', async () => {
    const p = new SimulationProvider({ seed: 'gate' });
    expect(p.isConnected()).toBe(false);
    // These are the two operations that could fabricate a result, so both must refuse.
    await expect(
      p.execute({ stake: 1, payout: 1.96, askPrice: 1, contractType: 'DIGITODD', symbol: SYM, source: 'simulation' }, { authorized: true }),
    ).rejects.toThrow(/not connected/i);
    await expect(p.stream(SYM, () => {})).rejects.toThrow(/not connected/i);
  });

  it('treats history() as a pure seed-driven generator, available even before connect', async () => {
    // Deliberate asymmetry: history() cannot fabricate a TRADE, it only expands the seed, so it
    // is safe to call before connect() (the dashboard primes charts during hydration). The
    // guarantee that matters is that it stays a pure function of the seed.
    const cold = new SimulationProvider({ seed: 'pure' });
    expect(cold.isConnected()).toBe(false);
    const coldHistory = await cold.history(SYM, 100);
    const warm = await sim('pure');
    const warmHistory = await warm.history(SYM, 100);
    expect(coldHistory.map((q) => q.price)).toEqual(warmHistory.map((q) => q.price));
    expect(coldHistory.map((q) => q.digit)).toEqual(warmHistory.map((q) => q.digit));
  });

  it('reports connected state accurately across connect/disconnect', async () => {
    const p = new SimulationProvider({ seed: 'state' });
    expect(p.isConnected()).toBe(false);
    await p.connect();
    expect(p.isConnected()).toBe(true);
    p.disconnect();
    expect(p.isConnected()).toBe(false);
  });

  it('exposes mode and source so the UI can never mislabel simulated results', async () => {
    const p = await sim('meta');
    expect(p.mode).toBe('simulation');
    expect(p.source).toBe('simulation');
  });
});

describe('SimulationProvider pricing and settlement', () => {
  it('prices from the payout table, and profit is exactly payout - stake on a win', async () => {
    const p = await sim('price');
    const priced = await p.price({ symbol: SYM, contractType: 'DIGITODD', stake: 1, duration: 1, durationUnit: 't', currency: 'USD' });
    expect(priced.stake).toBe(1);
    expect(priced.payout).toBeGreaterThan(priced.stake);
    expect(priced.source).toBe('simulation');

    // Settle repeatedly; the arithmetic must hold for every outcome.
    for (let i = 0; i < 60; i++) {
      const s = await p.execute(priced, { authorized: true });
      expect(s.source).toBe('simulation');
      expect(s.stake).toBe(1);
      if (s.won) {
        expect(s.payout).toBe(priced.payout);
        expect(s.profit).toBeCloseTo(priced.payout - priced.stake, 6);
      } else {
        expect(s.payout).toBe(0);
        expect(s.profit).toBeCloseTo(-priced.stake, 6);
      }
      expect(s.entryDigit).toBeGreaterThanOrEqual(0);
      expect(s.exitDigit).toBeGreaterThanOrEqual(0);
    }
  });

  it('settles DIGITODD/DIGITEVEN according to the parity of the exit digit', async () => {
    const p = await sim('parity');
    for (const ct of ['DIGITODD', 'DIGITEVEN'] as const) {
      const priced = await p.price({ symbol: SYM, contractType: ct, stake: 1, duration: 1, durationUnit: 't', currency: 'USD' });
      for (let i = 0; i < 40; i++) {
        const s = await p.execute(priced, { authorized: true });
        const odd = (s.exitDigit ?? 0) % 2 === 1;
        expect(s.won).toBe(ct === 'DIGITODD' ? odd : !odd);
      }
    }
  });

  it('settles DIGITOVER with STRICT inequality: digit equal to the barrier loses', async () => {
    const p = await sim('strict');
    const priced = await p.price({ symbol: SYM, contractType: 'DIGITOVER', stake: 1, duration: 1, durationUnit: 't', barrier: '5', currency: 'USD' });
    let sawEqual = false;
    for (let i = 0; i < 300; i++) {
      const s = await p.execute(priced, { authorized: true });
      const d = s.exitDigit ?? -1;
      if (d === 5) {
        sawEqual = true;
        expect(s.won).toBe(false); // neither over nor under at the barrier
      } else {
        expect(s.won).toBe(d > 5);
      }
    }
    expect(sawEqual).toBe(true); // the barrier case really was exercised
  });

  it('settles DIGITMATCH only on an exact digit', async () => {
    const p = await sim('match');
    const priced = await p.price({ symbol: SYM, contractType: 'DIGITMATCH', stake: 1, duration: 1, durationUnit: 't', barrier: '7', currency: 'USD' });
    for (let i = 0; i < 200; i++) {
      const s = await p.execute(priced, { authorized: true });
      expect(s.won).toBe((s.exitDigit ?? -1) === 7);
    }
  });

  it('accepts a caller-supplied payout override', async () => {
    const p = new SimulationProvider({ seed: 'override', payoutTable: { DIGITODD: 3 } });
    await p.connect();
    const priced = await p.price({ symbol: SYM, contractType: 'DIGITODD', stake: 2, duration: 1, durationUnit: 't', currency: 'USD' });
    expect(priced.payout).toBeCloseTo(6, 6); // 2 stake x 3.0
  });
});

describe('SimulationProvider streaming', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emits quotes on a timer and the disposer really stops them', async () => {
    const p = await sim('stream');
    const got: Quote[] = [];
    const dispose = await p.stream(SYM, (q) => got.push(q));

    await vi.advanceTimersByTimeAsync(5000);
    const afterRun = got.length;
    expect(afterRun).toBeGreaterThan(0);
    for (const q of got) expect(q.source).toBe('simulation');

    dispose();
    await vi.advanceTimersByTimeAsync(10000);
    // No further quotes after disposal: a stopped stream is genuinely stopped.
    expect(got.length).toBe(afterRun);
  });

  it('emits monotonically increasing epochs', async () => {
    const p = await sim('epochs');
    const got: Quote[] = [];
    const dispose = await p.stream(SYM, (q) => got.push(q));
    await vi.advanceTimersByTimeAsync(4000);
    dispose();
    for (let i = 1; i < got.length; i++) expect(got[i].epoch).toBeGreaterThanOrEqual(got[i - 1].epoch);
  });
});

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
