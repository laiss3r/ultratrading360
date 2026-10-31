/**
 * Interpretation of Deriv's answer to an unauthenticated registration probe.
 *
 * Deriv validates the redirect_uri of an authorization request before showing
 * any UI when the request carries `prompt=none`: a URI that IS registered is
 * bounced straight back to itself with `error=login_required` (no session),
 * while a URI that is NOT registered is sent to Deriv's own error page with
 * `invalid_request` and a redirect_uri note. That difference lets this app
 * check — without anyone's Deriv session — whether the redirect URI it sends
 * is actually on the app's registered list.
 */
export interface ProbeVerdict {
  /** true = registered, false = not registered, null = could not judge */
  registered: boolean | null;
  detail: string;
}

export function interpretProbeRedirect(location: string, redirectUri: string): ProbeVerdict {
  if (!location) {
    return { registered: null, detail: 'Deriv answered without a redirect, so registration could not be judged.' };
  }
  if (redirectUri && (location === redirectUri || location.startsWith(`${redirectUri}?`) || location.startsWith(`${redirectUri}#`))) {
    return {
      registered: true,
      detail: 'Deriv bounced the no-UI probe straight back to this URI, which it only does for registered redirect URIs.',
    };
  }
  if (location.includes('invalid_request') && location.includes('redirect_uri')) {
    return {
      registered: false,
      detail:
        'Deriv rejected the no-UI probe with a redirect_uri mismatch: this URI is NOT in the app\'s registered redirect-URL list. Add it in the Deriv dashboard (or switch the app to the OAuth type, which is what carries redirect URLs).',
    };
  }
  return { registered: null, detail: `Deriv redirected somewhere unexpected (${location.slice(0, 120)}); registration state unknown.` };
}
