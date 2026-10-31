# UltraTrading360

A Next.js Deriv trading workspace with a form-based Bot Builder, editable strategy templates,
observed market statistics, live tick charts, genuine trade records and enforced execution limits.

## Frontend rebuild — 31 October 2026

The former pages and components have been replaced, not merely restyled. The reference was
[360 Trading Hub](https://360tradinghub.co.ke/); branding, code and profitability claims were not copied.
The existing Next.js API routes, PKCE configuration, encrypted session handling and trading engine
remain in place. Git history is retained.

| Page | Function |
|---|---|
| Dashboard | Shared account identity, genuine market feed, shortcuts and session controls |
| Bot Builder | Native form editor; validated, versioned strategies; JSON import/export |
| Overlord Pro | Six editable pattern templates; flat stake and disabled execution by default |
| Signal Tools | Frequencies and statistical diagnostics computed from observed Deriv ticks |
| Trading Chart | Responsive SVG chart of received historical/live quotes |
| Trade History | Genuine recorded contracts and CSV export; no seeded profit figures |
| Risk & Settings | Trading permission, account-specific Real acknowledgement, execution limits and themes |
| Account centre | OAuth/PAT connection and genuine server-backed account selection |
| Callback | Existing PKCE exchange and session restoration without a second login wall |

There is no simulation provider or fallback price feed in the application. Historical statistical
libraries remain available internally, but the rebuilt interface does not manufacture trades,
balances, profits or predictions. Past digit frequencies do not predict the next tick.

## Safety and account identity

- All tools use one shared authenticated account. Real selection is allowed independently of
  permission to execute orders, including when its actual balance is zero.
- The selected account must have a verified, account-scoped trading channel before a bot can start.
- Trading is disabled by default. Real execution also requires acknowledgement tied to the
  selected account ID. Switching to another identity does not transfer that acknowledgement.
- Every run has a confirmation showing the account, stake and contract. Limits are checked by
  the existing engine before buying; stopping cannot undo an already accepted contract.
- Balances and account lists come from Deriv. Missing accounts are not fabricated. Account creation
  is not part of the new frontend, and no Real account is automatically created.
- Credentials are stored server-side in an encrypted HttpOnly cookie, not IndexedDB or public
  environment variables. The preserved legacy discovery bridge can expose a token briefly to
  browser memory through a short-lived one-shot handoff; it must never be persisted or logged.

## Architecture

```text
src/app/           New pages; existing app/api/deriv routes are preserved
src/components/    New shell, account menu, chart/session widgets and UI primitives
src/state/         Shared account, market and automation orchestration
src/lib/deriv/     REST accounts, request-correlated WebSockets, OTP, proposal and buy verification
src/lib/engine/    Strategy validation, conditions, risk manager and actual contract lifecycle
src/lib/stats/     Observed-sample statistical functions
src/lib/oauth/     PKCE and encrypted HttpOnly session
src/lib/persistence/ Browser-local strategies/settings/trade records, never tokens
backend/           Historical Django code; intentionally NOT deployed
```

The production architecture is **Next.js only**. A browser-local trade ledger is not a complete
broker statement and is not synced between devices.

## Develop and verify

```sh
npm ci
npm run dev -- --hostname 0.0.0.0
npm run typecheck
npm run lint
npm test
npm run build
npm start -- --hostname 0.0.0.0
```

Use the existing `.env.example` for configuration guidance. Keep all real credentials out of
Git and `NEXT_PUBLIC_*`. The registered OAuth callback must match the production domain exactly;
localhost can render public market data but cannot impersonate that registered OAuth callback.

Current rebuild evidence: **351 tests / 29 files**, successful typecheck, lint and production build.
The synthetic authenticated browser workflow is in `tools/authflow.mjs`; see `tools/README.md`.
It does not prove that an actual user's Deriv account, interactive OAuth consent or live contract
execution works. No live orders were placed during the rebuild.

For research, archive checksum, browser evidence and publication status, see
[`docs/frontend-rebuild.md`](docs/frontend-rebuild.md).
