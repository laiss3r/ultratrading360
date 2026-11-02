# Session consistency repair — 2026-11-02

The supplied live screenshots show four settled contracts, then a fifth accepted open contract, then its loss. The accounting itself reconciles: 7.57 payout −5.10 settled stake = +2.47 realised profit; adding an open 1.00 purchase raises paid stake to6.10 without changing settled P/L; when that contract loses, realised profit is +1.47. However, the previous presentation hid these distinctions, carried scroll offsets across tabs, and used an independently capped lifecycle journal for financial rows.

## Changes

- Summary, Transactions, accounting and the financial Journal use one deduplicated terminal contract ledger. Lifecycle messages are activity logs, not a second source of P/L. A missing/delayed/capped settlement log no longer hides a real terminal result. Duplicate checkpoint/IndexedDB/reconciled records contribute only once per account/environment/contract.
- Journal result rows use actual recorded contract identity, stake, profit, payout and terminal timestamp, sorted newest first. No generated trades/results or inferred outcomes; lifecycle-only unmatched profit messages are not extra financial results.
- Tab/run changes remount the scrollable pane at the newest record. Browser scroll anchoring is disabled so prepended live rows cannot retain a hidden top offset from another tab.
- Summary now says **Contract profit/loss**, not the session-wide Total profit/loss. Persistent accounting shows settled/open counts and each stake amount, explaining that aggregate P/L uses settled payout minus settled stake.
- Prior-history mode explicitly says totals/summary remain scoped to the current run. Pending messaging distinguishes accepted contracts awaiting settlement from an entry still being checked/submitted or an unresolved broker outcome.
- A previous win/loss colour and completed lifecycle no longer bleed into a new proposal/pricing attempt. Stop, reset/account locks, execution permissions, live-signal gates and risk limits are unchanged.

## Verification

Six pure ledger tests cover the exact +2.47 screenshot arithmetic, missing lifecycle rows, duplicate financial events, stale event profits, failed entries and account/environment isolation. Five additional component tests cover tab scroll identity, contract-versus-session labels, every-tab settled/open breakdown, financial rows without lifecycle persistence, and resetting outcome/lifecycle display on a new pricing attempt.

Controlled production-build browser flows passed 39 Demo +39 Real Elite assertions (including ledger sums and tab scroll resets) and48+48 shared-session/Overlord assertions (exports, account isolation, Stop, refresh, Builder/saved bots and 320×568 through1280×844 layout). These are explicitly synthetic transport tests, not private Deriv purchases. Fixture processes were stopped before the clean genuine-data build. Exact final unit/build and production rollout evidence is recorded in the workspace release status.
