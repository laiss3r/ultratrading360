# Frontend replacement — 31 October 2026

## Scope and preservation

The previous non-API pages and components were archived and replaced with a new frontend.
This is not a further account-switch styling patch. Existing API routes, secure authentication
configuration, trading/risk libraries and Git history were retained. The deployment architecture
remains Next.js only; the historical Django backend is not deployed.

Baseline: `13597e2cee10115f38bd66f22219f75013c533b2`.

Before deletion, `git archive HEAD src/app src/components src/state` produced:

- Workspace archive: `/home/user/archives/frontend-before-rebuild-13597e2.tar.gz`
- SHA-256: `c4f5742d7b1c9a7ba923487a0d47066deec8a511ffcd46f51d7cf1c93974fe1a`

`git diff --name-only -- src/app/api` was empty after the replacement.

## Research used before implementation

- [360 Trading Hub](https://360tradinghub.co.ke/): inspected in Chromium at desktop/mobile sizes.
  Reference account header, navy/gold tool navigation, dashboard shortcuts and shared session rail
  informed the anatomy. Intrusive popups, branding, marketing claims and code were not copied.
- [Official Deriv bot template](https://github.com/deriv-com/trading-bot-template), including its
  [WebSocket integration guide](https://github.com/deriv-com/trading-bot-template/blob/master/user-guide/05-websocket-integration.md):
  separate public and account-scoped sockets; regenerate OTP connections after account changes/reconnects.
- [Community runtime proposal](https://github.com/butcheralcohol-tech/butcher-trader/issues/23):
  explicit controls, order limits, settlement reconciliation and idempotency were relevant design
  principles, not evidence that the proposed implementation is production-ready.
- [Community parity bot](https://github.com/mwanzajerry14-bit/Deriv-bot): transparent digit gates,
  cooldown and caps, without claiming a predictive edge.
- [Community digit trader](https://github.com/ogilatomas/Prince-Gila-Digit-trade-bot): frequency/parity
  controls. Its scanner README does not establish a working digit-purchase implementation.

## Replacement delivered

- New responsive light/dark shell, shared account header, scrolling tool navigation, session rail
  and mobile bottom navigation.
- Dashboard, Bot Builder, Overlord Pro, Signal Tools, Trading Chart, Trade History, Risk & Settings,
  Account Centre and OAuth callback.
- Native form-based strategy editing with validation/versioning and JSON import/export; no Blockly.
- Six editable pattern templates, disabled execution and flat stake by default.
- Genuine historical/live tick chart and measured statistics, not generated chart prices or predictions.
- Genuine local contract ledger and CSV export; no seeded trades, profits or balances.
- Shared run confirmation and stop/pause controls connected to the retained automation engine.

## Account and execution safeguards

- The account menu lists only returned/discovered accounts. A zero Real balance is selectable and
  is never treated as absence of an account or permission to execute.
- PAT initialization now respects the returned selected account's actual environment rather than
  unconditionally choosing Demo; it clears an earlier login's Real acknowledgement.
- Account selection resets mismatched acknowledgement. Real execution and socket renewal require
  acknowledgement tied to the selected account ID.
- A bot cannot start using only a public market channel or another account's trading channel.
  The trading identity is established by the selected account's balance subscription and cleared
  when its socket disconnects.
- Modern Options-only listings do not open the legacy balance watcher unnecessarily.
- Callback preserves the existing PKCE exchange/session rescue and avoids redundant classic
  discovery when Options accounts were already returned.
- No automatic Real account creation was added. No real secrets were committed or put into public
  environment variables. The existing short-lived classic browser handoff remains an explicit
  exception to server-only token handling; it does not persist tokens in browser storage.

## Executed validation

| Check | Result |
|---|---|
| TypeScript | Passed |
| ESLint | Passed |
| Unit/API/client/UI tests | **351 passed / 29 files** |
| Production build, no fixture environment | Passed |
| `git diff --check` | Passed |
| Preserved API route diff | Empty |
| Desktop 1440×1000 / mobile 390×844 | Visited all main pages; no uncaught errors or horizontal overflow |
| Actual public Deriv data | Observed real quotes/chart in the production-mode local preview |
| Synthetic authenticated browser workflow | **32 checks passed**, no orders placed |
| Production static bundle | No fixture upstream URLs found |

The 32-check run used the real application backend/UI with deliberately synthetic Deriv upstreams:
PAT form, official `data` account array, zero-balance Real selection, seven-section navigation,
reload, offline/online/focus preservation, account refresh/switch, socket account isolation, missing
acknowledgement rejection, builder save, run confirmation/cancel and dark-theme persistence.
The fixtures were stopped and the application rebuilt without fixture variables afterward.

Replacement UI/template tests were added after deleting the former frontend tests. The earlier
325-test intermediate result did not represent equivalent UI coverage; the final total is 351.

Workspace evidence:

- `/home/user/rebuild-tests.log`
- `/home/user/rebuild-build.log`
- `/home/user/rebuild-authflow.log`
- `/home/user/rebuild-research/reference-desktop.png` and `reference-mobile.png`
- `/home/user/rebuild-research/new-desktop.png` and `new-mobile.png` — genuine public feed
- `/home/user/rebuild-research/synthetic-mobile-dark.png` — synthetic test session, NOT actual balances

## Limits of evidence

No live authenticated user account was accessed. The user's actual Demo/Real list, balances,
interactive OAuth consent, genuine OTP issuance and live order settlement were not verified in
this rebuild. No live trades were placed. Synthetic tests are not live authenticated acceptance.
Trade history/settings remain browser-local, not a complete cross-device broker statement.
OAuth session lifetime is bounded; indefinite login is not promised.

## Publication status

The tested replacement is available in the workspace preview and is preserved in a local Git
commit. **It has not been pushed or deployed to production.** No GitHub write credential or
credential helper exists in this execution environment, and the GitHub connector reports
`unsupported`. No replacement secret was requested or reconstructed from old exposed credentials.

The existing production site at https://ultratrading360.vercel.app is unchanged from baseline
`13597e2`. Publishing must use an authenticated Git push of the new commit and then the existing
Vercel project, rather than redeploying the old remote commit or changing authentication settings.
