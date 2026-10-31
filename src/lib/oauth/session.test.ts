import { describe, expect, it } from 'vitest';
import { decryptSession, encryptSession, publicSession, type StoredSession } from './session';


describe('needsOptionsAccount flag', () => {
  it('survives encrypt/decrypt and reaches the public session', () => {
    const s: StoredSession = {
      kind: 'oauth',
      loginid: '',
      currency: 'USD',
      balance: 0,
      isVirtual: true,
      scopes: ['trade'],
      expiresAt: null,
      needsOptionsAccount: true,
      accessToken: 't'.repeat(24),
    };
    const back = decryptSession(encryptSession(s));
    expect(back?.needsOptionsAccount).toBe(true);
    expect(publicSession(back as StoredSession).needsOptionsAccount).toBe(true);
    // and the token never leaks into the public shape
    expect(JSON.stringify(publicSession(back as StoredSession))).not.toContain('t'.repeat(24));
  });
});
