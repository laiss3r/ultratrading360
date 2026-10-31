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

## Demo-only listing regression

For the reported missing-Real scenario, start the fixture with
`STUB_DEMO_ONLY=1 STUB_CLASSIC_NO_BALANCES=1 node tools/derivstub.mjs`.
Use the same fixture build/start configuration above and run
`node tools/account-discovery-flow.mjs` (same optional `PLAYWRIGHT_MODULE`).
The 11-check run starts from an existing Demo-only session, verifies automatic
additional discovery and actual all-account balances, then checks Real selection,
reload/navigation persistence, refresh retention and independent trading rejection.
No live account or live trade is used.

## Overlord sequential execution fixture (TEST ONLY)

`tools/overlord-flow.mjs` exercises the real browser engine against the opt-in
synthetic upstream, **never live funds**. Start `tools/derivstub.mjs` with
`STUB_TRADING=1 STUB_DEMO_ONLY=1`; build/start Next with the fixture public WS and
REST overrides documented above. The test server additionally needs
`DERIV_LEGACY_WS_HOSTS=ws://127.0.0.1:4518` and a local-only session secret.
Run `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/overlord-flow.mjs`.
It resets the fixture-only ledger, logs in with a dummy value, enables the local
Demo permission, scans, explicitly confirms, and verifies three settled requests:
stakes 1/2.10/4.41, contracts EVEN/OVER/OVER, duration 3 and a 1.09 profit halt.
The fixture has private-loopback `/__fixture/trades` and `/__fixture/reset` endpoints
only when STUB_TRADING is enabled. Stop both servers and make a **clean build
without the fixture overrides** before production deployment.
