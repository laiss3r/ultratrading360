# Contract execution and reference-style session panel

## Report and changes

The reference screenshots show a Summary / Transactions / Journal layout, persistent six-part totals, live contract status and Stop. UltraTrading's own screenshots also show clipped confirmation content and an unverified trading-channel error. Reference balances/results are not evidence about this app or the user's account.

The existing authenticated balance handler ignored decimal-string amounts. It now accepts finite numeric or decimal-string balances, including zero, rejects malformed values, checks currency and optional returned loginid against the selected account, and explicitly fails initial verification rather than silently ignoring its receipt. Malformed/mismatched replays close the channel and revoke verification. This is a demonstrated code defect, not proof of the precise cause in the user's private session.

The app now verifies a candidate authenticated channel before replacing the working market provider. Wrong-account OTP responses and failed balance verification preserve the old market feed. Actual broker errors remain visible. Demo messages do not ask for irrelevant Real acknowledgement. Explicit account confirmation, account-specific Real consent, fresh evidence, broker payout checks and risk caps remain mandatory.

Session tabs now share persistent totals (paid stake, settled gross return, purchased runs, lost, won, net P/L). Transactions use the reference's three-column anatomy, expandable broker details, and run/account-scoped CSV. Journal retains phase, account, timestamp, filters and download. The Run/Stop/status dock shows observed lifecycle stages only, not invented time-based progress. Stop prevents future buys, never claims to cancel an accepted contract. Mobile confirmation and long values are constrained to the viewport.

## Verification boundaries

- 518 automated tests across 46 files passed; TypeScript, ESLint and production build passed.
- 18 narrow-screen checks passed at 320/360/390px: modal values and controls fit, complete page has no horizontal overflow, and totals remain visible on all three tabs.
- Isolated browser execution transport uses invented accounts, balances, ticks and deterministic outcomes ONLY in `tools/derivstub.mjs`; it is not imported or configured in production. `STUB_STRING_BALANCE=1` specifically exercises decimal-string account verification.
- Full controlled Demo and Real-routing tests exercise proposal -> buy -> open contract -> settlement, account routing, progression, target-profit and loss-limit stop, manual Stop, reset locks, account-switch locks, refresh/persistence and downloads. Logs are outside the repo; these are not genuine broker orders.
- A separate, unauthenticated genuine public Deriv proposal for DIGITEVEN / R_10 / 1 tick / USD 1 returned ask 1 and payout 1.95. No buy was sent. Public pricing is not private trading proof.

**No authenticated user session is available in this workspace. A genuine purchase or recovery of the user's private account cannot be asserted from these checks.** Do not request a token in chat or turn off safety gates to fabricate proof. The user's connected browser must receive its own valid OTP account channel; the existing explicit Confirm & run then starts the signal-gated bot. Actual buying and settlement must be confirmed by that broker's contract ID and statement.

Reference schemas reviewed: https://developers.deriv.com/schemas/balance_response.schema.json and https://developers.deriv.com/schemas/buy_response.schema.json. The legacy balance schema specifies a number, so decimal-string handling is compatibility hardening, not a claim that this schema requires strings.

## Reproduction (isolated fixtures)

1. Production build: `npm ci && npm run build`.
2. Test broker: `STUB_TRADING=1 STUB_PATTERNS=1 STUB_REAL_FUNDS=1 STUB_SETTLE_MS=1800 STUB_STRING_BALANCE=1 node tools/derivstub.mjs`.
3. Test app only: `NODE_OPTIONS='--require ./tools/auth-transport-hook.cjs' npm run start -- --hostname 0.0.0.0 --port 3002`.
4. `APP_URL=http://127.0.0.1:3002 TEST_MODE=demo node tools/overlord-flow.mjs`; repeat with `TEST_MODE=real` sequentially (the fixture ledger is shared).
5. `node tools/confirmation-mobile-flow.mjs`.
6. Stop all fixture processes before finishing. Never run the transport hook in production.
