# Integration fixtures (test-only; never production fallback)

`derivstub.mjs` serves synthetic REST / classic WS / market WS endpoints exclusively
for application integration testing. It is not imported by application code.
Never set the following fixture endpoints in Vercel.

1. `npm ci`; install Playwright separately (`npm install --no-save playwright` and
   `npx playwright install chromium` in a disposable test checkout).
2. `node tools/derivstub.mjs` in a separate terminal.
3. Build with
   `NEXT_PUBLIC_DERIV_API_BASE=http://127.0.0.1:4517 NEXT_PUBLIC_DERIV_WS_PUBLIC=ws://127.0.0.1:4519/public npm run build`.
   NEXT_PUBLIC settings are embedded at build time, not merely runtime.
4. Start with the same public variables plus
   `DERIV_SESSION_SECRET=local-e2e-secret-only DERIV_OAUTH_CLIENT_ID=stubclient DERIV_REDIRECT_URI=http://localhost:3000/callback DERIV_LEGACY_WS_HOSTS=ws://127.0.0.1:4518 npm start`.
5. `BASE=http://localhost:3000 node tools/authflow.mjs`.

The fixture's PAT login tests the app's PAT route, not Deriv's interactive OAuth
consent or token issuance. Browser network toggles verify session preservation;
client unit tests verify OTP URL renewal and subscription callback rebinding.
The 17-check run used the non-flaky fixture. Transient failures and revocation are
separately tested at the session API handler with injected network/HTTP failures.
Enabling `STUB_FLAKY=1` also makes login itself intermittently fail; it must not be
used to imply login is reliable when Deriv is unavailable.

No fixture values represent the user's real balances, account IDs, or credentials.
