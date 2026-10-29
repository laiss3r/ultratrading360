import { NextResponse } from 'next/server';
import { DERIV_API_BASE, DERIV_APP_ID, DERIV_WS_PUBLIC } from '@/lib/deriv/config';
import { sessionSecretConfigured } from '@/lib/oauth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Liveness + configuration report. Contains no secrets. */
export async function GET() {
  let derivHealth: { ok: boolean; status?: string; version?: string; error?: string } = { ok: false };
  try {
    const r = await fetch(`${DERIV_API_BASE}/health`, { cache: 'no-store' });
    const j = (await r.json()) as { status?: string; version?: string };
    derivHealth = { ok: r.ok, status: j.status, version: j.version };
  } catch (e) {
    derivHealth = { ok: false, error: (e as Error).message };
  }
  return NextResponse.json({
    service: 'ultratrading360',
    time: new Date().toISOString(),
    derivApi: derivHealth,
    config: {
      appId: DERIV_APP_ID,
      wsPublic: DERIV_WS_PUBLIC,
      apiBase: DERIV_API_BASE,
      oauthConfigured: !!process.env.DERIV_OAUTH_CLIENT_ID?.trim(),
      sessionSecretConfigured: sessionSecretConfigured(),
    },
  });
}
