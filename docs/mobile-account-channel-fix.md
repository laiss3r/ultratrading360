# Mobile confirmation and account-channel follow-up

1 November 2026. Follow-up to the user's two deployed Android screenshots.

## Confirmed, not inferred

- Vercel production deployment `dpl_3HdFgAa9GDQZEpMr1fxxEchRJdJ2` was READY/PROMOTED at source `8356d8b`. Thus the screenshots were not dismissed as an old deployment.
- Public runtime configuration correctly reports application/OAuth identifier `34P4UiyGfp4cBEekMAF9S` and the registered production callback.
- The screenshots show a selected Demo account and no verified account trading channel. They do **not** show the returned account list, the user's socket response, or establish whether this was a new authentication versus a restored/manual Demo selection. We cannot claim the user's Real account has been returned or their private socket fixed without that evidence.

## Corrections

- Run confirmation is portalled to `document.body`, outside the mobile session drawer. Bounded viewport/grid sizing, wrapped detail values and responsive buttons prevent horizontal clipping. The compact header also fits 320/360px without causing mobile auto-zoom through document overflow. Theme controls remain in Risk settings on the narrowest screens.
- Account-channel attachment no longer waits for background market rankings. Rankings stop querying a superseded provider.
- Connection errors from the broker/socket API are visible in the session monitor rather than only local logs. A safe **Reconnect trading channel** action does not place an order, change permission, replace an active bot or disconnect an accepted pending contract.
- Late connection responses from a previous account/mode cannot overwrite the current connection's state.
- While viewing Demo, the monitor offers **Switch to Real account** only if Deriv has actually returned a Real row. Otherwise **Check for Real account** reruns existing discovery and displays its result. No fake account, balance or cosmetic Real mode is introduced.
- Real-first new authentication, explicit later switching/persistence and independent execution permission remain unchanged. Existing manually chosen Demo sessions are not silently switched to live money.

## Evidence

- 464 unit/UI tests passed; TypeScript and ESLint passed.
- 12 synthetic Real-first/login/switch/refresh regression checks passed.
- 27 synthetic mobile checks passed at 320, 360 and 390 CSS px with mobile/touch emulation: actual late-discovered Real selection, visible API refusal, reconnect availability, drawer-origin portal, fully visible detail/action bounds, correct account in confirmation and no uncaught errors. No orders placed.
- The synthetic classic Real row is intentionally view-only under the Options OTP path; this verifies that the real backend refusal is displayed, not bypassed or falsely marked Verified.

## Remaining live acceptance

The user must inspect their returned Real row/channel message in the updated live app. If Deriv returns only Demo or rejects the selected account's OTP, the app cannot manufacture a Real account or waive broker authorization. A fresh sign-in requests the existing Real-first policy; a restored cookie correctly preserves an explicit Demo selection. Never share tokens or OAuth codes for diagnosis.
