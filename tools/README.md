# Synthetic integration fixtures — never production fallback

`derivstub.mjs` supplies explicitly synthetic REST, classic WebSocket and market WebSocket
upstreams for integration testing. Application code does not import it. Never configure these
fixture endpoints in production or Vercel.

1. Run `npm ci`. Install Playwright/Chromium in a separate test directory if needed.
2. Start `node tools/derivstub.mjs` in another terminal.
3. Build with:
   ```sh
   NEXT_PUBLIC_DERIV_API_BASE=http://127.0.0.1:4517 \
   NEXT_PUBLIC_DERIV_WS_PUBLIC=ws://127.0.0.1:4519/public npm run build
   ```
4. Start the built app with those same public variables and:
   ```sh
   DERIV_SESSION_SECRET=local-e2e-secret-only \
   DERIV_OAUTH_CLIENT_ID=stubclient \
   DERIV_REDIRECT_URI=http://localhost:3000/callback \
   DERIV_LEGACY_WS_HOSTS=ws://127.0.0.1:4518 npm start
   ```
5. Run `BASE=http://localhost:3000 node tools/authflow.mjs`. Optionally set
   `PLAYWRIGHT_MODULE` to an absolute path to Playwright's `index.mjs` in the test installation.
6. Stop both test processes and **rebuild without every fixture variable** before production use.

The rebuilt workflow completed **32 checks** on 31 October 2026:

- Actual PAT form -> genuine application session API -> encrypted cookie, against a synthetic upstream.
- Official REST `data` array, Demo/Real rows and a zero Real balance.
- Real selection independent of execution permission.
- Seven sections preserve identity during client navigation, with no mobile horizontal overflow.
- Reload, offline/online and focus preserve the selected identity.
- Backend rejects an unacknowledged Real socket, mismatched socket account and unknown account selection.
- Account refresh, switch back to Demo, builder save, run confirmation/cancel and dark-theme persistence.
- No uncaught browser errors; no orders placed.

These checks do NOT validate interactive Deriv OAuth consent, the user's real balances/account list,
actual OTP issuance or live trading. The fixtures contain invented test-only IDs/balances and must
never be described as a live Deriv acceptance test. Transient failures and token revocation are also
covered separately by API/client unit tests.
