import type { NextConfig } from 'next';

/**
 * Next 16 ships with `cacheComponents` (and `partialPrefetching`) enabled by the scaffold.
 *
 * Both are deliberately DISABLED here. Under cacheComponents a route may not declare
 * `dynamic = 'force-dynamic'` or `runtime = 'nodejs'`, and dynamism is inferred instead. This app's
 * API routes are exactly the cases where inference is the wrong tool:
 *
 *  - `/api/deriv/oauth/start` mints a fresh CSRF state and PKCE verifier per request. It writes
 *    those to the RESPONSE cookies rather than reading request cookies, so nothing signals
 *    "dynamic" to an inference pass. If that route were ever prerendered or cached, every user
 *    would share one state/verifier pair — a real CSRF and code-injection hole.
 *  - `/api/deriv/oauth/callback`, `/session`, `/socket` and `/token` all read an encrypted httpOnly
 *    cookie and call Deriv. Their responses are per-user and must never be cached or reused.
 *  - `/api/health` reports whether server secrets are configured, which must reflect the live
 *    environment rather than a build-time snapshot.
 *
 * Explicit `dynamic = 'force-dynamic'` + `runtime = 'nodejs'` on each route gives that guarantee
 * in a way a reader can see. The trade-off is opting out of partial prefetching, which is
 * irrelevant for a dense, stateful dashboard with no marketing pages to prefetch.
 */
const nextConfig: NextConfig = {
  cacheComponents: false,
  partialPrefetching: false,
  reactStrictMode: true,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
