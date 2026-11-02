# Direct Run and reference session layout

2026-11-02. Implements the user's four supplied screenshots as the visual reference, without browser chrome, Telegram/Support, fake balances or copied trade results.

## Behavior

- Removed the confirmation modal from all shared Run controls: Overlord, scanned-market Run, Elite and saved/Builder bots now prepare and start from the original explicit click.
- Run enables execution for this browser using the existing authenticated-account authorization path. Logging in or viewing a page never starts automation. First-time Real-money consent stays inline and is bound to the selected account; an acknowledged account requires no extra step.
- Synchronous click guards prevent duplicate preparation; store/engine checks still reject simultaneous bots, pending outcomes, stale scanned results, changed accounts, changed markets, revoked permissions and unsafe purchases. Refresh never resumes trading.
- Reduced pricing latency by forwarding the provider's immutable, single-use broker proposal when it is at most one second old, rather than performing the same request twice. Older proposals are repriced. Proposal price/payout limits and final live-signal/permission/risk checks still run. No live-signal qualification or account verification was removed. This removes one network round trip on the fresh path; no unsupported millisecond speed claim is made.

## Session presentation

White full-width canvas; centered collapse control and top Reset; Summary/Transactions/Journal with blue active underline; market and contract glyphs; soft win/loss contract backgrounds; compact facts and tick progress; expandable genuine broker details; reference-style three-column transaction table and View Detail control; alternating profit/loss journal rows with GMT timestamps and lifecycle filters; grey three-by-two totals; attached blue Run/Stop and outcome/lifecycle strip. Existing account header remains genuine and accessible. Concurrent Elite contracts remain independently scrollable and counted once.

Totals retain real accounting: paid stake includes accepted open contracts; gross payout and profit count actual terminal results. A live contract's potential payout is not a settled return. Unknown outcomes retain reconciliation and reset/account-switch locks.

## Verification

- 630 tests across 53 files passed; TypeScript, zero-warning ESLint, diff checks and production build passed.
- 72 production-built controlled Elite assertions (36 synthetic Demo, 36 synthetic Real), including direct Run, concurrency/exposure/entry caps, Stop, refresh and read-only reconciliation.
- 96 controlled shared-session/Overlord regression assertions (48 synthetic Demo, 48 synthetic Real), including actual fixture-account socket attribution, martingale calculations, exports, account isolation, Builder and saved bot Run, and viewport checks from 320x568 through 1280x844.
- Reviewed actual generated mobile Summary and Transactions screenshots against the supplied template.
- These are isolated integration fixtures, not proof of a private Deriv purchase. No genuine Demo or Real order placed.
- Clean genuine-data build and deployed public checks are recorded in the workspace release status after rollout. Fixture processes must remain stopped before genuine-data verification/deployment.
