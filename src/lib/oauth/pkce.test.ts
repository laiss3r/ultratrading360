import { describe, expect, it } from 'vitest';
import {
  base64UrlEncode, buildAuthorizeUrl, deriveCodeChallenge, generateCodeVerifier, generateState, safeEqual,
} from './pkce';

describe('PKCE (RFC 7636)', () => {
  it('reproduces the RFC 7636 Appendix B test vector exactly', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    await expect(deriveCodeChallenge(verifier)).resolves.toBe(expected);
  });

  it('generates verifiers inside the RFC-mandated 43..128 character range', () => {
    for (const len of [43, 64, 128]) {
      const v = generateCodeVerifier(len);
      expect(v).toHaveLength(len);
      expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/); // unreserved charset only
    }
  });

  it('rejects out-of-range verifier lengths', () => {
    expect(() => generateCodeVerifier(42)).toThrow(RangeError);
    expect(() => generateCodeVerifier(129)).toThrow(RangeError);
  });

  it('never reuses a verifier or state between calls', () => {
    const verifiers = new Set(Array.from({ length: 500 }, () => generateCodeVerifier(64)));
    const states = new Set(Array.from({ length: 500 }, () => generateState(16)));
    expect(verifiers.size).toBe(500);
    expect(states.size).toBe(500);
    for (const s of states) expect(s).toMatch(/^[0-9a-f]{32}$/);
  });

  it('produces base64url output with no +, / or = padding', () => {
    const bytes = new Uint8Array([255, 254, 253, 252, 0, 1, 2]);
    const enc = base64UrlEncode(bytes);
    expect(enc).not.toMatch(/[+/=]/);
  });

  it('builds a Deriv authorization URL with every required parameter', () => {
    const url = buildAuthorizeUrl({
      clientId: 'appXXXXX',
      redirectUri: 'https://ultratrading360.vercel.app/callback',
      scope: ['trade', 'account_manage'],
      state: 'abc123',
      codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://auth.deriv.com/oauth2/auth');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('appXXXXX');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')).toBe('trade account_manage');
    expect(u.searchParams.get('redirect_uri')).toBe('https://ultratrading360.vercel.app/callback');
    expect(u.searchParams.has('prompt')).toBe(false);
  });

  it('adds prompt=registration only for sign-up', () => {
    const url = buildAuthorizeUrl({
      clientId: 'c', redirectUri: 'https://x/cb', scope: ['trade'], state: 's',
      codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', prompt: 'registration',
    });
    expect(new URL(url).searchParams.get('prompt')).toBe('registration');
  });

  it('never includes a client_secret (Deriv is a public PKCE client)', () => {
    const url = buildAuthorizeUrl({
      clientId: 'c', redirectUri: 'https://x/cb', scope: ['trade'], state: 's', codeChallenge: 'x',
    });
    expect(url).not.toMatch(/client_secret/i);
  });
});

describe('safeEqual', () => {
  it('compares equal strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('', '')).toBe(true);
  });
  it('rejects differences and length mismatches', () => {
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
  it('rejects non-strings', () => {
    // @ts-expect-error deliberate bad input
    expect(safeEqual('abc', null)).toBe(false);
    // @ts-expect-error deliberate bad input
    expect(safeEqual(undefined, 'x')).toBe(false);
  });
});
