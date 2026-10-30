'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Banner, Button, Card } from '@/components/ui';
import { useApp } from '@/state/store';

/**
 * OAuth landing page.
 *
 * Deriv redirects the browser here with ?code=...&state=... . The actual token exchange happens
 * in the server route (POST /api/deriv/oauth/callback), which validates `state` against a signed
 * httpOnly cookie and swaps the code using the PKCE verifier. This component only forwards the
 * parameters and reports the outcome — it never sees the access token.
 */
function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const s = useApp();
  // The outcome of the server-side exchange. `null` until it resolves.
  const [exchange, setExchange] = useState<{
    status: 'ok' | 'error';
    message: string;
    detail: string | null;
  } | null>(null);
  const fired = useRef(false);

  const error = params.get('error');
  const errorDescription = params.get('error_description');
  const code = params.get('code');
  const state = params.get('state');

  // URL-level failures are DERIVED during render, not written to state from an effect. The query
  // string is already known synchronously, so an effect here would only add a first render that
  // claims "working" before correcting itself.
  const urlFailure = error
    ? { message: `Deriv returned an error: ${error}`, detail: errorDescription ?? null }
    : !code || !state
      ? {
          message: 'The callback URL is missing its code or state parameter.',
          detail: 'Start the sign-in again from the Connect page.',
        }
      : null;

  useEffect(() => {
    if (urlFailure !== null || error || !code || !state) return;
    if (fired.current) return;
    fired.current = true;

    (async () => {
      try {
        const r = await fetch('/api/deriv/oauth/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // The state/verifier cookies are attached automatically; they are httpOnly and signed.
          credentials: 'same-origin',
          body: JSON.stringify({ code, state }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) {
          setExchange({
            status: 'error',
            message: j.message ?? `Sign-in failed (HTTP ${r.status}).`,
            detail: j.error ?? null,
          });
          s.pushLog('error', `OAuth callback failed: ${j.message ?? r.status}`);
          return;
        }
        setExchange({
          status: 'ok',
          message: `Signed in as ${j.session?.loginid ?? 'your Deriv account'}.`,
          detail: null,
        });
        s.pushLog('ok', 'OAuth sign-in completed. Token stored server-side in an encrypted httpOnly cookie.');
        await s.refreshSession(false);
        setTimeout(() => router.replace('/connect'), 1400);
      } catch (e) {
        setExchange({
          status: 'error',
          message: 'Could not reach the sign-in endpoint.',
          detail: (e as Error).message,
        });
        s.pushLog('error', `OAuth callback transport error: ${(e as Error).message}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, code, state, router, s]);

  const status = urlFailure ? 'error' : exchange?.status ?? 'working';
  const message = urlFailure?.message ?? exchange?.message ?? 'Completing Deriv sign-in…';
  const detail = urlFailure?.detail ?? exchange?.detail ?? null;

  const Icon = status === 'ok' ? CheckCircle2 : status === 'error' ? XCircle : Loader2;

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4">
      <Card className="w-full max-w-[520px]" title="Deriv sign-in">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Icon className={`h-9 w-9 ${status === 'ok' ? 'text-profit' : status === 'error' ? 'text-loss' : 'animate-spin text-brand'}`} />
          <p className="text-sm font-medium text-ink">{message}</p>
          {detail && <p className="num max-w-[420px] text-[11px] leading-relaxed break-words text-ink-3">{detail}</p>}
          {status === 'working' && <p className="text-[11px] text-ink-4">Exchanging the authorization code server-side…</p>}
          {status === 'error' && (
            <div className="mt-2 w-full space-y-2">
              <Banner tone="warn">
                Nothing was stored. Your browser was redirected back safely; no token exists from this attempt.
              </Banner>
              <div className="flex justify-center gap-2">
                <Button variant="primary" onClick={() => router.replace('/connect')}>Back to Connect</Button>
                <Button variant="ghost" onClick={() => router.replace('/')}>Dashboard</Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-ink-3">Loading…</div>}>
      <CallbackInner />
    </Suspense>
  );
}
