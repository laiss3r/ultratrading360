'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink, KeyRound, LogOut, ShieldCheck, Unplug } from 'lucide-react';
import { Badge, Banner, Button, Card, Field, Toggle } from '@/components/ui';
import { useApp } from '@/state/store';
import { ago, MODE_LABEL } from '@/lib/format';

/**
 * Connect page.
 *
 * Two genuine Deriv auth paths, both validated server-side:
 *  1. OAuth 2.0 authorization code + PKCE (requires DERIV_OAUTH_CLIENT_ID to be configured).
 *  2. Personal Access Token pasted by the user (validated with a real authorize call).
 *
 * This app NEVER asks for your Deriv password, and it never accepts a token on the strength of
 * it being non-empty — a token is only considered valid once Deriv itself returns the account
 * list for it.
 */
export default function ConnectPage() {
  const s = useApp();
  const [token, setToken] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [probe, setProbe] = useState<{ registered: boolean | null; detail: string } | null>(null);

  // Live, session-free answer to "is the redirect URI we send actually on this
  // app's registered list?" — the single most common cause of Deriv bouncing a
  // login attempt, and invisible from the browser until now.
  useEffect(() => {
    if (!s.oauthConfigured) return;
    let alive = true;
    void fetch('/api/deriv/oauth/check')
      .then((r) => r.json())
      .then((j: { registered: boolean | null; detail: string }) => {
        if (alive) setProbe({ registered: j.registered, detail: j.detail });
      })
      .catch(() => {
        if (alive) setProbe({ registered: null, detail: 'Probe request failed.' });
      });
    return () => {
      alive = false;
    };
  }, [s.oauthConfigured]);

  async function submitPat() {
    setResult(null);
    const t = token.trim();
    if (t.length < 8) {
      setResult({ ok: false, message: 'That is too short to be a Deriv API token. Paste the full token from app.deriv.com.' });
      return;
    }
    const r = await s.connectWithPat(t);
    setResult(r);
    if (r.ok) setToken(''); // never keep the raw token in component state after success
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-3 p-4">
      {s.session?.needsOptionsAccount && (
        <Card
          title="One step left: create your Options trading account"
          subtitle="Your Deriv sign-in succeeded, but the new Deriv platform keeps Options trading accounts separate from classic Deriv loginids — your profile has none yet."
          right={<Badge tone="warn">ACTION NEEDED</Badge>}
        >
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-general">
              Creating a <strong>demo</strong> Options account is free, instant and reversible, and it is what this app
              trades on in demo mode. A <strong>real</strong> Options account is never created automatically; requesting
              one here sends Deriv your explicit request and Deriv&apos;s own funding rules then apply.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={s.busy === 'create-options'}
                onClick={() =>
                  void s.createOptionsAccount('demo').then((r) => setResult({ ok: r.ok, message: r.message }))
                }
              >
                Create free demo Options account
              </Button>
              <Button
                variant="outline"
                disabled={s.busy === 'create-options'}
                onClick={() =>
                  void s.createOptionsAccount('real').then((r) => setResult({ ok: r.ok, message: r.message }))
                }
                title="Sends an explicit real-account request to Deriv; Deriv requires a funded wallet"
              >
                Request real Options account
              </Button>
            </div>
            {result && (
              <Banner tone={result.ok ? 'success' : 'warn'}>
                {result.message}
              </Banner>
            )}
          </div>
        </Card>
      )}

      <Banner tone="info">
        <strong className="font-bold">Market data needs no credentials.</strong> Tick streams, digit extraction, proposals and
        statistics already work without connecting anything. You only need to connect to place demo or real orders.
      </Banner>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* ------------------------------------------------------ OAuth */}
        <Card
          title="OAuth 2.0 login"
          subtitle="Authorization-code flow with PKCE (S256). Recommended: you never paste a secret into this site."
          right={s.oauthConfigured ? <Badge tone="profit">CONFIGURED</Badge> : <Badge tone="warn">NOT CONFIGURED</Badge>}
        >
          <div className="space-y-3">
            {s.oauthConfigured ? (
              <>
                <div className="rounded border border-line bg-section-1 p-2.5">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="dt-section-title">Redirect URI this site sends to Deriv</div>
                    <Badge tone={probe?.registered === true ? 'profit' : probe?.registered === false ? 'loss' : 'warn'}>
                      {probe == null
                        ? 'CHECKING…'
                        : probe.registered === true
                          ? 'REGISTERED ON DERIV'
                          : probe.registered === false
                            ? 'NOT REGISTERED ON DERIV'
                            : 'CHECK INCONCLUSIVE'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="num min-w-0 flex-1 break-all text-xxs leading-snug text-prominent">
                      {s.redirectUri || '—'}
                    </code>
                    <CopyRedirectUri value={s.redirectUri} />
                  </div>
                  {probe?.registered === false && (
                    <Banner tone="warn">
                      <strong className="font-bold">Live check: Deriv does not have this URI registered.</strong> {probe.detail}{' '}
                      Until it is added — developers.deriv.com → your app → redirect URLs, and make sure the app is the{' '}
                      <em>OAuth</em> type, because PAT-type apps carry no redirect URLs — &ldquo;Continue with Deriv&rdquo; cannot
                      succeed. The Personal Access Token path below works right now, with no registration at all.
                    </Banner>
                  )}
                  <p className="mt-1.5 text-xxs leading-relaxed text-less-prominent">
                    OAuth 2.0 matches this string exactly — scheme, host, path and trailing slash all count. If pressing
                    &ldquo;Continue with Deriv&rdquo; lands on <code className="num">home.deriv.com/dashboard/error</code> with{' '}
                    <code className="num">error=invalid_request</code> and a note that the <code className="num">redirect_uri</code>{' '}
                    does not match, then Deriv accepted the client id but your app&apos;s redirect-URL list holds a different
                    string. Fix: copy the URL above, open{' '}
                    <a className="text-blue underline" href="https://developers.deriv.com/dashboard/" target="_blank" rel="noreferrer">
                      developers.deriv.com/dashboard
                    </a>
                    , edit your application, paste it into the redirect URLs (keep any localhost entry you use for
                    development), save, wait a minute, then press Continue again.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="primary" size="lg" className="flex-1" disabled={s.busy === 'oauth'} onClick={() => void s.startOAuth(false)}>
                    <ExternalLink className="h-4 w-4" /> Continue with Deriv
                  </Button>
                  <Button variant="outline" size="lg" disabled={s.busy === 'oauth'} onClick={() => void s.startOAuth(true)} title="Opens the Deriv registration prompt for new users">
                    Sign up
                  </Button>
                </div>
                <p className="text-xxs leading-relaxed text-less-prominent">
                  You are redirected to <code className="num">auth.deriv.com/oauth2/auth</code>. Deriv returns a one-time code to{' '}
                  <code className="num">{s.redirectUri || 'the callback route'}</code>; a server-side route exchanges it for a token using
                  the PKCE verifier. The token is stored in an encrypted <code className="num">httpOnly</code> cookie and is never exposed to
                  page JavaScript, never written to IndexedDB, and never sent to the browser.
                </p>
              </>
            ) : (
              <>
                <Banner tone="warn">
                  <strong className="font-bold">OAuth is not available yet.</strong> The server has no{' '}
                  <code className="num">DERIV_OAUTH_CLIENT_ID</code>. Deriv issues OAuth client IDs by registering an application — an app ID
                  alone is not a client ID, and this cannot be worked around from the client.
                </Banner>
                <ol className="space-y-1.5 pl-4 text-xs leading-relaxed text-general list-decimal">
                  <li>
                    Go to <a className="text-blue underline" href="https://developers.deriv.com/dashboard/" target="_blank" rel="noreferrer">developers.deriv.com/dashboard</a> and register an application.
                  </li>
                  <li>
                    Set the redirect URI to exactly <code className="num text-blue">https://ultratrading360.vercel.app/callback</code> (and{' '}
                    <code className="num">http://localhost:3000/callback</code> for local development). Matching is exact — scheme, host and
                    trailing slash all count.
                  </li>
                  <li>
                    Request scopes <code className="num">trade account_manage application_read</code>.
                  </li>
                  <li>
                    In the Vercel project <em>ultratrading360</em> → Settings → Environment Variables, add{' '}
                    <code className="num">DERIV_OAUTH_CLIENT_ID</code>, <code className="num">DERIV_REDIRECT_URI</code> and a strong{' '}
                    <code className="num">DERIV_SESSION_SECRET</code> (16+ characters). Redeploy.
                  </li>
                </ol>
              </>
            )}
          </div>
        </Card>

        {/* -------------------------------------------------------- PAT */}
        <Card
          title="Personal Access Token"
          subtitle="Paste a scoped Deriv API token. Validated against the live API before it is accepted."
          right={<Badge tone="neutral">PAT</Badge>}
        >
          <div className="space-y-3">
            <Field
              label="Deriv API token"
              hint={
                <>
                  Create one at{' '}
                  <a className="text-blue underline" href="https://app.deriv.com/account/api-token" target="_blank" rel="noreferrer">
                    app.deriv.com/account/api-token
                  </a>{' '}
                  with <strong>Read</strong> + <strong>Trade</strong> scopes. Grant <strong>Admin</strong> only if you need payments.
                </>
              }
            >
              <div className="flex gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void submitPat()}
                  placeholder="Paste your Deriv API token"
                  className="num flex-1"
                />
                <Button variant="primary" disabled={s.busy === 'pat' || !token.trim()} onClick={() => void submitPat()}>
                  <KeyRound className="h-3.5 w-3.5" /> {s.busy === 'pat' ? 'Validating…' : 'Connect'}
                </Button>
              </div>
            </Field>

            {result && <Banner tone={result.ok ? 'success' : 'danger'}>{result.message}</Banner>}

            <Banner tone="warn">
              <strong className="font-bold">This app never asks for your Deriv password</strong> — only for an API token, which is what
              Deriv’s own documentation prescribes for third-party applications. A non-empty token is not treated as valid: the server calls
              Deriv’s authorize endpoint and only accepts the credentials Deriv itself confirms, together with the account list they control.
              Tokens are held in an encrypted httpOnly cookie; they are not written to IndexedDB or to any log, and they are never returned to
              the browser.
            </Banner>

            <p className="text-xxs leading-relaxed text-less-prominent">
              PAT requests carry the required <code className="num">Deriv-App-ID</code> header (<code className="num">{s.appId}</code>). Deriv
              rejects PAT calls without it. OAuth bearer tokens do not need that header.
            </p>
          </div>
        </Card>
      </div>

      {/* --------------------------------------------------- session */}
      <Card title="Active session" subtitle="What the server currently holds, with the token itself redacted.">
        {s.session ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <KV label="Login ID" value={s.session.loginid} />
              <KV label="Kind" value={s.session.kind.toUpperCase()} />
              <KV label="Currency" value={s.session.currency} />
              <KV label="Balance" value={s.session.balance.toFixed(2)} />
              <KV label="Account type" value={s.session.isVirtual ? 'Demo/virtual' : 'REAL MONEY'} tone={s.session.isVirtual ? undefined : 'loss'} />
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <KV label="Token" value="held server-side, never exposed" />
              <KV label="Expires" value={s.session.expiresAt ? ago(s.session.expiresAt) : 'no expiry reported'} />
              <KV label="Scopes" value={s.session.scopes?.join(', ') || 'not reported'} />
              <KV label="Storage" value="encrypted httpOnly cookie" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void s.refreshSession(true)}>
                <ShieldCheck className="h-3.5 w-3.5" /> Re-validate with Deriv
              </Button>
              <Button variant="danger" onClick={() => void s.disconnect()}>
                <Unplug className="h-3.5 w-3.5" /> Disconnect
              </Button>
              <Link href="https://app.deriv.com/account/api-token" target="_blank">
                <Button variant="ghost">
                  <ExternalLink className="h-3.5 w-3.5" /> Manage tokens at Deriv
                </Button>
              </Link>
            </div>
            <Banner tone="info">
              Disconnect clears the encrypted session cookie in this browser. Deriv’s OAuth tokens have <strong>no refresh token and no
              revocation endpoint</strong>, so clearing the cookie does not invalidate the credential server-side — revoke an API token at{' '}
              <a className="text-blue underline" href="https://app.deriv.com/account/api-token" target="_blank" rel="noreferrer">app.deriv.com/account/api-token</a>{' '}
              if you want it permanently dead.
            </Banner>

            {s.accounts.length > 0 && (
              <div>
                <div className="mb-1.5 text-xxs font-medium tracking-wide text-general">Accounts this token controls</div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {s.accounts.map((a) => (
                    <div key={a.loginid} className="flex items-center justify-between rounded border border-line bg-section-1 px-3 py-2">
                      <div>
                        <div className="num text-xs font-bold text-prominent">{a.loginid}</div>
                        <div className="num text-xxs text-less-prominent">
                          {a.balance.toFixed(2)} {a.currency}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={a.isVirtual ? 'info' : 'loss'}>{a.isVirtual ? 'DEMO' : 'REAL'}</Badge>
                        <Button size="sm" variant="outline" disabled={!a.isVirtual && !s.settings.realTradingAcknowledged} onClick={() => void s.selectAccount(a.loginid)}>
                          Use
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <Banner tone="info">
            <span className="flex items-center gap-2">
              <LogOut className="h-3.5 w-3.5 shrink-0" />
              No account connected. Market data is streaming from Deriv&apos;s public socket; to place orders on{' '}
              <strong>{MODE_LABEL[s.settings.mode]}</strong> connect with an API token or OAuth above.
            </span>
          </Banner>
        )}
      </Card>

      <Card title="Real-money acknowledgement" subtitle="Separate from connecting. Connecting a real account does NOT enable trading on it.">
        <div className="space-y-3">
          <Toggle
            tone="danger"
            checked={s.settings.realTradingAcknowledged}
            disabled={!s.session || s.session.isVirtual}
            onChange={async (v) => {
              if (!v) {
                await s.setSettings({ realTradingAcknowledged: false, acknowledgedAccountLoginid: null, limits: { ...s.settings.limits, realTradingAcknowledged: false } });
                s.pushLog('warn', 'Real-money acknowledgement withdrawn.');
                return;
              }
              const confirmed = window.confirm(
                'You are about to allow REAL MONEY orders on a live Deriv account.\n\n' +
                  'This is not a simulation. Losses are real and immediate.\n\n' +
                  'Type OK only if you understand this.',
              );
              if (!confirmed) return;
              await s.setSettings({
                realTradingAcknowledged: true,
                acknowledgedAccountLoginid: s.session?.loginid ?? null,
                limits: { ...s.settings.limits, realTradingAcknowledged: true },
              });
              s.pushLog('warn', `REAL-money trading acknowledged for ${s.session?.loginid}.`);
            }}
            label="I understand this places real-money orders"
            hint={
              s.session
                ? s.session.isVirtual
                  ? 'Unavailable: the connected account is a demo/virtual account.'
                  : `Applies to ${s.settings.acknowledgedAccountLoginid ?? s.session.loginid}. The risk manager re-checks this on every single order.`
                : 'Connect a real Deriv account first.'
            }
          />
          {s.settings.realTradingAcknowledged && (
            <Banner tone="danger">
              <span className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Real-money trading is <strong>ACKNOWLEDGED</strong> for{' '}
                  <code className="num">{s.settings.acknowledgedAccountLoginid}</code>. Switching the mode selector to REAL is now unlocked.
                  Every order still passes the risk manager, and a proposal is verified against its quoted price before purchase.
                </span>
              </span>
            </Banner>
          )}
        </div>
      </Card>
    </div>
  );
}

function KV({ label, value, tone }: { label: string; value: string; tone?: 'loss' }) {
  return (
    <div className="rounded border border-line bg-section-1 px-3 py-2">
      <div className="text-xxs tracking-wider text-less-prominent uppercase">{label}</div>
      <div className={`num mt-0.5 truncate text-xs font-medium ${tone === 'loss' ? 'text-loss' : 'text-prominent'}`} title={value}>
        {value}
      </div>
    </div>
  );
}

/**
 * One-tap copy of the exact redirect URI, because the single most common OAuth
 * failure on Deriv is a registered redirect URL that differs from the one the
 * client sends by a slash or a path segment — and retyping it invites exactly
 * that mistake.
 */
function CopyRedirectUri({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!value}
      title="Copy the redirect URI so you can paste it into your Deriv app registration"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}
