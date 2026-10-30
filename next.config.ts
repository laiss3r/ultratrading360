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
  /**
   * Dev-only. Next 16 treats a request whose origin differs from the dev server's
   * advertised host as cross-origin and blocks its dev resources (the HMR socket and
   * the client bootstrap) — which makes the page render server HTML and never hydrate,
   * with no error anywhere but the server log. Automating the UI against
   * http://127.0.0.1:3000 while the server advertises localhost hits exactly that.
   * Listing the loopback forms here keeps local verification possible. It has no
   * effect on a production build.
   */
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
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
