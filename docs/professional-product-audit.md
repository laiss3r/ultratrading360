# UltraTrading — professional product audit and first improvement package

**Date:** 3 November 2026  
**Baseline:** `02dd74bc7f2faf66a156056704c820f47bb6a9e0`  
**Scope:** Next.js application only; approved navigation, account workflow and direct Run retained. No profitability guarantee and no genuine private trades performed.

## Outcome

This package prioritises financial correctness and useful decision-making over adding more indicators or stake escalation. It is a first verified improvement package, **not a claim that every product gap is finished**. See Publishing status below before assuming the changes are live.

### Implemented

1. **Persistent account-day loss accounting.** A separate IndexedDB ledger records terminal contract profit contributions by account, Demo/Real mode, currency and settlement UTC day. Repeated/reconciled contracts are idempotent. New runs restore the account's recorded daily P/L; session-view resets, session-risk resets, account rebasing and removable history clearing do not erase the ledger. Malformed risk storage blocks execution rather than silently resetting protection. Settlement persistence failure stops the bot and blocks further execution.
2. **Permission-safe risk editing.** Saving numeric limits merges against current execution/Real-consent flags, not flags captured when the form opened. An emergency Stop cannot be undone by an old form. Non-finite amounts, fractional entry limits and invalid drawdown percentages are rejected. The Risk screen exposes recorded daily net, configured loss limit, headroom and coverage limitations.
3. **More accurate performance calculations.** Drawdowns follow settlement chronology even for newest-first input. Worst percentage drawdown is maximised independently of worst absolute drawdown. Outcomes and streaks use actual profit signs; zero net is neutral and breaks streaks. Runtime trade logs also label zero-net outcomes explicitly.
4. **Professional History reporting.** Account/mode/currency isolation, UTC period filters, profit/loss/zero/error filters and strategy/market/contract search. Reports expose net P/L, mean net per contract (observed expectancy), profit factor, win/loss/zero counts, net relative to paid stake and per-strategy breakdowns. Net/stake is explicitly not account-balance return. Small samples and payout asymmetry are disclosed.
5. **Complete matching-record export.** History reads the full persisted browser ledger instead of silently reporting only the 5,000-record memory window. Only the newest 100 matching rows render, but totals and CSV include every loaded matching record. Refresh explicitly re-reads browser storage; the report combines that snapshot with live in-memory records. CSV includes currency, gross payout, errors and recorded execution timing. Fixed an additional defect where the old CSV sanitizer removed minus signs from negative amounts. Formula-like string cells are prefixed without deleting their content.
6. **Honest balance presentation.** A known-unknown account balance displays an em dash rather than a misleading zero.

### Preserved

- Genuine broker data only in the application; synthetic inputs exist only in isolated tests.
- Fresh proposal validation, selected-account verification, pre-buy permission checks, durable buying/receipt checkpoint, pending-outcome locks and read-only reconciliation.
- No authentication wall added and no execution-confirmation modal reintroduced.
- No automatic Run after login, refresh, signal scan or market selection.
- Existing one-minute honest signal result and independent market selection; thresholds were not weakened to manufacture qualification.
- Existing execution hot-path optimisation; no speculative quote reuse or bypass of the financial checkpoint.

## Validation evidence

| Check | Result |
|---|---|
| Unit/component/API tests | **725 passed, 58 files** |
| TypeScript | Passed |
| ESLint | Passed, no warnings |
| Next.js production build with genuine broker endpoints | Passed |
| Whitespace/diff integrity | Passed |
| Shared-session browser workflows, isolated Demo/Real fixtures | **48 + 48 checks passed** |
| Elite concurrency/reconciliation browser workflows, isolated Demo/Real fixtures | **39 + 39 checks passed** |
| New reporting/risk browser workflow | **18 checks passed**, including 5,005-record export, CSV signs/formula escaping, stale-form Stop, real IndexedDB history deletion and refresh |
| Genuine public Elite browser workflow | **16 checks passed**; observed markets/ticks/capabilities, no private authentication or purchases |
| Genuine public Overlord discovery browser workflow | **19 checks passed**; discovery/application/cancellation, no purchases |

**Total browser checks: 227 (192 isolated synthetic + 35 genuine public/read-only).** Synthetic Demo/Real labels describe account fixtures, not real private trading verification. Full-session synthetic checks preceded the last History-only refresh-control addition; the new 18-check report/risk workflow and clean build were rerun after it.

The new browser fixture is `tools/professional-flow.mjs`. It is loopback-only and refuses a non-fixture API configuration. It seeds an invented ledger only inside its isolated browser context. Fixture servers were stopped and the application was rebuilt with genuine broker endpoints afterward.

Raw validation logs are in the workspace as `professional-tests.log`, `professional-lint.log`, `professional-typecheck.log`, `professional-production-build.log`, `professional-session-{demo,real}.log`, `professional-elite-{demo,real}.log`, `professional-browser.log` and `professional-public-{elite,overlord}.log`.

## Coverage boundaries — important

- Daily risk is **browser-local app-recorded settled net P/L**, not a broker/account-global loss cap. Other devices, other tabs' unsynchronised running engines and trades outside this app are not comprehensively covered.
- UTC day follows the device clock. Automatic date/time should be enabled. Clearing all site data removes local protection; changing devices does not transfer it.
- Accepted concurrent contracts can settle beyond the configured daily-loss threshold. This package does not promise loss-at-risk reservation across all accounts or devices.
- History is not a broker statement. It depends on recorded, account-attributed, currency-attributed app contracts. An unreadable full ledger produces a visible partial-data warning. Refresh re-reads storage; an extremely long-lived page can otherwise outlast its initial storage snapshot and capped live-memory window.
- No statistical or engineering test demonstrates future profitability. Observed expectancy and profit factor are descriptive, not predictive. Recovery staking changes exposure, not the probability of the next tick.
- Genuine interactive private-account OAuth/OTP recovery, private purchase/fill latency and real-money settlement remain unverified in this work. Public data tests do not substitute for those checks.

## Prioritised remaining work

| Priority | Area | Next acceptance criteria |
|---|---|---|
| P0 | Cross-tab execution ownership | One account owner across tabs; durable ownership through pending contracts; crash/refresh takeover reconciles before entry; no duplicate buys. Current per-tab bot checks must not be described as a global account lock. |
| P0 | Durable account-wide risk | If account-global/cross-device limits are required, provision a managed durable store behind Next.js API routes, trusted broker-time accounting and atomic exposure/loss reservations. Preserve Next.js-only deployment; no Django deployment implied. |
| P0 | Recovery and broker statement parity | Read-only authenticated statement/backfill, actual private OTP refresh/reconnect tests and settlement reconciliation across a forced disconnect. Never request replacement tokens in chat or perform unsolicited live purchases. |
| P1 | Strategy evidence | Forward, out-of-sample evaluation with actual purchase-time payouts, costs/quote expiry, rejected setups and failed orders recorded. Define pass/fail criteria before looking at outcomes; no post-hoc threshold tuning or high-win-rate profitability claims. |
| P1 | Operational health | User-visible stream freshness, local storage/quota status, reconnect and reconciliation health, privacy-safe latency/error diagnostics. No secrets or raw tokens in telemetry. |
| P1 | Large-ledger operations | Indexed range queries/paging, bounded risk-ledger compaction with preserved current-day protection, archive import/validation and explicit migration failure recovery. The 5,005-record browser check is not a million-record scalability claim. |
| P2 | Reporting depth | Market aggregation panel, comparable time-window analysis and equity charts only where an actual reconciled starting balance is known. Avoid fictional bankroll curves or mixing currencies. |
| P2 | Accessibility and guidance | Keyboard/screen-reader audit of every execution state, clearer payout break-even/recovery-risk education, and per-screen empty/error/retry guidance. Preserve mobile design. |

## Publishing status

Vercel remains connected. Its production target was verified as the existing stable baseline `02dd74b`. GitHub connector lookup reported unsupported; this workspace has no retained repository write credentials. Exposed historical tokens were not recovered or reused. A verified local commit and patch are the appropriate handoff if the normal Git push cannot authenticate. **Do not redeploy the old remote branch and describe it as this package.**

The running workspace preview uses genuine public broker endpoints. Private authentication is not provisioned in that local preview; use the existing live application for its configured account login. This package must be published before its new protections can be assumed on the live site.
