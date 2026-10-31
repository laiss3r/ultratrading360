# UltraTrading360 — authentication and account-state investigation

Date: 31 October 2026

## Status and evidence boundary

**Underlying defects identified and fixes implemented locally. Not deployed. Live authenticated acceptance remains unverified.**

This report supersedes earlier claims that the dropdown, classic balances, and login/logout issues were fully verified in production. A passing public-page sweep is not an authenticated acceptance test. The previous production release remains `78dba45`; the changes described here are newer local work.

GitHub push preflight failed: `could not read Username for 'https://github.com'`. No usable GitHub credential is available in the current workspace; the GitHub connector returned unsupported. The Vercel connector is enabled, but redeploying the unchanged Git branch would not deploy these local modifications. No misleading redeploy was triggered.

No real-account orders were placed. No user token, authorization code, or live authenticated browser session was available for the requested live acceptance run. Do not paste these into chat.

## 1. Research and reference limitations

### 360 Trading Hub

- The specifically requested `https://360tradinghub.co.uk/` could not be reached from this environment with either the HTTP fetch tool or curl. This does **not** establish that the domain is invalid, offline for everyone, or equivalent to another site.
- Earlier investigation of `360tradinghub.co.ke` saved public JavaScript under `/home/user/probes/hub/`. That code creates a classic Deriv `websockets/v3` connection, sends `authorize`, and consumes `account_list`. This is evidence about that site's public client code, not access to its private backend, security implementation, database, or authenticated traffic.
- No private backend implementation of the requested `.co.uk` platform was inspected. Exact parity with its authentication, storage, permissions, or recovery design cannot be asserted.

### Official current Deriv documentation

1. [API overview](https://developers.deriv.com/docs/intro/api-overview/): REST for account management and OTP issuance; separate public, Demo and Real WebSocket endpoints. Public sockets cannot supply account balances or account-scoped trading authority.
2. [Options setup](https://developers.deriv.com/docs/options/): listing and OTP endpoints require the `trade` scope; creating accounts requires `account_manage`. PAT authentication additionally requires `Deriv-App-ID`.
3. [WebSocket authentication](https://developers.deriv.com/docs/options/websocket/): OTPs are single-use and valid for 120 seconds. A reconnect must obtain a fresh URL; replaying the original authenticated URL is incorrect.
4. [OAuth](https://developers.deriv.com/docs/intro/oauth/): authorization code + state + PKCE S256; exact registered redirect URI; legacy `app_id` is distinct from the new OAuth client registration. Successful OAuth identity authentication does not guarantee that an arbitrary legacy login ID is an Options OTP account.
5. [Complete workflows](https://developers.deriv.com/docs/workflows/): server-side credential storage, optional refresh tokens, and short-lived access tokens. **An unlimited session cannot be promised from an expiring access token.** Existing exchange code does not retain/use refresh tokens; implementing refresh-token rotation remains outstanding if this app registration actually receives them. Otherwise expiry must result in an explicit reconnect requirement.
6. [Legacy account REST API](https://developers.deriv.com/docs/options-legacy/legacy-accounts/) and [legacy API overview](https://developers.deriv.com/docs/options-legacy/): read-only legacy data for migrated profiles; `loginids` map; migration status must be complete, otherwise 409. This is a relevant server-side alternative to investigate before expanding browser-token handoffs. It is not a universal classic trading endpoint, and was not silently substituted for the new Options listing.

### Open-source comparison

- [sirvimbi/Deriv-Engine PR #35](https://github.com/sirvimbi/Deriv-Engine/pull/35), merged 28 September 2026: directly relevant implementation describing a mode selector that did not replace its account-scoped socket. It introduces explicit account switching, new OTP acquisition, real-account confirmation, running-bot guards, and account-identity verification. The PR text and merge were fetched; its claims are not independent production verification.
- [Official deriv-api SDK documentation](https://deriv-com.github.io/deriv-api/): useful classic-client patterns for balance subscriptions and subscription revival. Its published documentation is older; classic `authorize` examples must not be assumed compatible with the current OTP Options socket.
- [NeurotradeAI PR #30](https://github.com/pathtomillions001-bot/NeurotradeAI-8-Bk2/pull/30), September 2026: search surfaced relevant persistence and per-account connection pooling work. Numeric rate-limit claims from a community PR are not treated as authoritative global Deriv limits.
- Search also returned `derivexyz/derive-ts`. This is a different exchange/project and was excluded. A newer package publication date alone is not evidence of maintenance quality or API compatibility.

## 2. Existing architecture inspected

- Next.js App Router frontend and API route handlers; no deployed Django process.
- Zustand application-wide state in `src/state/store.ts`.
- Shared `AppShell`, header and bottom navigation. Navigation uses Next `Link`; the earlier assertion that these were plain full-page anchors was incorrect.
- IndexedDB for local settings, strategies and trade history. It is not an authentication database.
- AES-GCM encrypted `ut_session`, HttpOnly/Secure/SameSite=Lax, for token and session metadata. No persistent server-side session database or token revocation index exists in the deployed Next-only architecture.
- OAuth callback server exchange and PAT connection route.
- REST account listing and OTP route; public/authenticated market providers; correlated WebSocket requests and subscription replay.
- A browser-side classic account discovery handoff and account-adoption route. These rows are browser-supplied metadata, **not independently verified proof of account ownership or trading permission**. The OTP endpoint must independently authenticate account access at Deriv.
- The retained Django backend is deliberately outside the deployed request path. No database migration was needed for the local Next-only fixes.

## 3. Root causes found in source

| Defect | Actual source behavior | Consequence |
|---|---|---|
| Cosmetic account selection | `selectAccount` changed provider mode but did not update the server session login ID | Header/account identity and backend continued to disagree; reload reverted selection |
| Wrong socket identity | `attachTradingSocket` selected the first matching Demo/Real row | Selecting a second account of the same type could trade through a different account |
| Cross-account balance contamination | Session revalidation fell back to `accounts[0]` while retaining the old login ID | Another account's balance/currency could be displayed under the selected identity |
| Demo/Real classification contamination | Revalidation used `current.is_virtual === 1 || session.isVirtual`; socket gating also used session fallbacks | A previous Demo flag could survive a Real account change |
| Transient failures treated as logout | Refresh cleared session on unsuccessful validation rather than distinguishing revocation from upstream/network failures | A valid local session disappeared during failure/reload/revalidation |
| Missing durable selection | Active-account choice was not server-backed | Reload/new-page initialization did not restore the intended account |
| Discovery replaced rows | Adopt/list paths replaced available rows rather than merging by account ID | Options or classic rows disappeared after synchronization |
| One-use OTP reused | Automatic socket reconnect reused a consumed URL | Authenticated network recovery failed even if public market data recovered |
| Subscription replay lost callbacks | Replay generated new request IDs but handlers remained keyed to old IDs | A reconnected socket could be open without delivering updates to application consumers |
| Stale local preferences | Explicit disconnect did not clear the selected-account preference | A later login could inherit an old local selection |

Navigation itself does not explicitly call logout. Full reload/tab restoration and refresh error handling are confirmed architectural failure paths; reproducing the user's exact mobile-navigation timing against their real session remains pending.

## 4. Changes implemented locally

### Session lifecycle

- Boot reads encrypted session and cached account rows without an upstream Deriv validation call.
- Background revalidation runs on a five-minute interval, visibility restoration and browser `online` events.
- `no_accounts` and transient upstream failures preserve authentication; transient state schedules a retry.
- Invalid/revoked credentials and expired/unreadable sessions still terminate authentication. A valid UI is not allowed to keep trading after a definitive authentication failure.
- Non-auth JSON/HTTP failures no longer clear the client session merely because `authenticated` is absent.
- Logout clears the local selected-account preference.

### Account selection and identity

- Added `POST /api/deriv/session/select`: selects only a row already stored in the authenticated session and reissues the encrypted cookie with that login ID.
- Expired sessions are rejected by the new endpoints.
- Client selection updates identity, mode and preference; account changes disconnect the previous provider. Concurrent account operations and active/starting/stopping bots block switching.
- Both account rows and the Demo/Real mode controls now use server-backed selection instead of a mode-only cosmetic change.
- Viewing a Real account is separate from permission to place Real orders.
- The selected login ID, not the first account of a type, is used for OTP requests.
- Other tabs listen for preference changes and reload shared cookie account identity.
- Revalidation updates balance only when the returned row matches the selected login ID. Missing matches preserve last-known metadata rather than borrowing a different account's balance.

### Balances and sockets

- Options and browser-discovered rows merge by login ID.
- Added an explicit balance-sync action through a renewed short-lived handoff; it does not persist the access token in localStorage.
- Added authenticated balance subscriptions, with callbacks scoped to the currently selected login ID and provider instance; stale callbacks from the old provider cannot overwrite the new account.
- Added a URL factory for fresh OTP URLs on authenticated reconnection.
- Corrected subscription-handler mapping on reconnect.
- Connection errors reject initialization promises instead of leaving them pending.
- A closed/abandoned provider does not open a late-arriving OTP connection.
- Backend socket issuance rejects target/session mismatches and independently re-reads Deriv's account listing before applying Demo/Real trading gates. Browser-discovered metadata is never used as trading authority.
- Classic rows not exposed as current Options accounts are explicitly view-only in the OTP path, not silently mapped to the DOT demo account.

### Security and remaining design limitations

- No real credential was added to source, NEXT_PUBLIC configuration, logs or files.
- Test credentials/IDs/balances are clearly synthetic fixtures and are not application fallbacks.
- Browser classic discovery still exposes the access token briefly to page JavaScript. That is a security trade-off, not equivalent to keeping tokens exclusively server-side. The newer legacy REST route should be evaluated with the actual profile before removing this workaround.
- Cookie-only session storage has no durable server-side revocation index; encrypting browser-reported rows does not validate their truth.
- Automatic OAuth refresh-token retention/rotation is not implemented in this patch.
- Large account lists can approach cookie-size limits; a production session store would remove that constraint but is not introduced as an unrequested rewrite.
- Full transactional rollback on failed authenticated switching, cross-tab in-flight trade coordination, complete balance-freshness UX, and settlement-aware switching require additional work before a production-quality completion claim.

## 5. Verification completed

### Automated source and handler tests

- TypeScript: no errors.
- ESLint for `src`: no errors or warnings at the latest check.
- Vitest: **324 passed, 23 files**.
- Production-mode Next build: passed with fixture-specific build variables for local E2E. Those variables must never be used for deployment.

New regressions exercise network/HTTP/no-accounts preservation; revoked/expired session rejection; no-network cookie boot; account-balance isolation; fresh OTP creation after disconnect; callback rebinding after replay; late OTP cancellation; and connection-error rejection.

### Browser + real application backend, synthetic Deriv edge

`tools/derivstub.mjs` supplies isolated test responses. It is not imported by the app and does not run in production. `tools/authflow.mjs` drives a 390px browser through the actual Next API handlers and shared state.

Latest-source production-mode local build and browser run: **17 passed, 0 failed**. It checks:

1. PAT login route accepts fixture response and mints the app session.
2. Dashboard initializes signed in.
3. Options account rows and balances appear.
4. Classic discovery/adoption returns fixture Demo/Real balances.
5. Selected Demo login ID updates.
6. Builder navigation retains session.
7. Chart navigation retains session.
8. Signals navigation retains session.
9. Full page reload retains session.
10. Selected account survives reload.
11. Offline state retains session.
12. Online restoration retains session.
13. Server-side Real selection persists Real ID, zero balance and nonvirtual classification.
14. Real socket issuance without acknowledgement is rejected.
15. Mismatched socket account is rejected.
16. Unknown selection is rejected.
17. Repeated reloads retain session.

The run used a non-flaky fixture. Transient network/HTTP failure behavior is covered separately by handler regression tests; repeated reloads alone do not prove recovery from upstream HTTP 500s. The test uses the PAT path, not interactive live OAuth consent. Presence of a signed-in header is not proof of authenticated trading connectivity. The workflow does not place orders, verify live settlements, or independently prove account ownership at Deriv.

## 6. Acceptance still outstanding

| Requested acceptance | Current evidence |
|---|---|
| Real Deriv OAuth login + correct account initialization | Existing integration inspected; no live session available this round |
| User's actual Demo/Real list and balances | Not verified with their credential |
| Server-backed selection and persistence | Verified with application backend + fixture |
| Authenticated Demo/Real socket and balance stream against Deriv | Not verified live |
| Home/Builder/Chart/Signals navigation and reload | Verified in local fixture-driven browser workflow |
| Offline/online recovery | Local session preservation and socket lifecycle regressions; no live long-duration outage run |
| Expired-token handling | Expiry/revocation regression tests pass; optional refresh-token support remains outstanding |
| Production deployment | Blocked by unavailable GitHub push authentication; no new production deployment |

## 7. Handoff

The source changes and test harness are preserved in `/home/user/ultratrading`. A patch accompanies this report so the work can be reviewed/applied without sharing credentials. Restore repository publishing through a secure authenticated mechanism, not pasted tokens. After deployment, run the live acceptance sequence using the user's browser or a secure delegated test session; do not mark completion based on public-page/UI tests.

Standing security actions: revoke the previously exposed GitHub PAT and old public-repository Deriv token; do not send replacement credentials or single-use authorization codes in chat.
