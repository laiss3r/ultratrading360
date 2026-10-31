import { describe, expect, it } from 'vitest';
import { interpretProbeRedirect } from './probe';

const URI = 'https://ultratrading360.vercel.app/callback';

describe('redirect-URI registration probe', () => {
  it('reads a bounce back to ourselves as REGISTERED', () => {
    const v = interpretProbeRedirect(`${URI}?error=login_required&state=registration-probe`, URI);
    expect(v.registered).toBe(true);
    expect(v.detail).toMatch(/registered redirect URIs/);
  });

  it('reads Deriv\'s invalid_request redirect_uri page as NOT REGISTERED', () => {
    const loc =
      'https://home.deriv.com/dashboard/error?error=invalid_request&error_description=The+request+is+missing+a+required+parameter%2C+includes+an+invalid+parameter+value%2C+includes+a+parameter+more+than+once%2C+or+is+otherwise+malformed.+The+%27redirect_uri%27+parameter+does+not+match+any+of+the+OAuth+2.0+Client%27s+pre-registered+redirect+urls.';
    const v = interpretProbeRedirect(loc, URI);
    expect(v.registered).toBe(false);
    expect(v.detail).toMatch(/NOT in the app/);
  });

  it('does not guess when there is no redirect or an unknown one', () => {
    expect(interpretProbeRedirect('', URI).registered).toBeNull();
    expect(interpretProbeRedirect('https://home.deriv.com/dashboard/login?session_absent=1', URI).registered).toBeNull();
  });

  it('does not treat a different URI bouncing back as registration', () => {
    const v = interpretProbeRedirect('https://evil.example.com/callback?error=login_required', URI);
    expect(v.registered).not.toBe(true);
  });
});
