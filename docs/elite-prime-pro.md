# Elite Prime Pro — implementation and verification

Date: 2026-11-02 (Africa/Nairobi). Separate `/elite` workspace; Bot Builder, Overlord, account selection and existing navigation are retained.

## Research and scope decisions

- Inspected the supplied screenshots and current reference runtime at https://360tradinghub.co.ke/static/js/async/476.ed653109.js, not just its marketing copy. Reference conditions consume chronological, disjoint windows: the second condition follows the first rather than sharing the same ticks. The reference limits the execution loop to one outstanding contract; the user explicitly selected genuine concurrent contracts instead.
- Implemented at most five rules, three conditions per rule, digit/move windows 1–10, 100-outcome observed percentages and 1,000-observation digit bars. Ties select the lowest digit. Flat prices satisfy neither Rise nor Fall. Percentage/bar displays are descriptive observed frequencies, not estimated win probabilities.
- The documented lifecycle separates proposal, purchase, and authenticated contract monitoring; broker capability discovery is a market-data operation. This shaped discovery-before-start and contract-specific settlement tracking. [4](https://developers.deriv.com/docs/workflows/) [2](https://developers.deriv.com/docs/trading/)
- The community's API issue demonstrates a mutable staking loop and contract update listener pitfalls. New requests are built for each lane/attempt instead of reusing a request with a stale stake; subscriptions remain contract-specific. The community example is not authority for current API fields. [3](https://github.com/deriv-com/deriv-api/issues/135)
- Did not copy unverified Higher/Lower/RunHigh/RunLow names or market-specific barriers. The eight implemented contracts are Even, Odd, Over, Under, Matches, Differs, Rise and Fall. Actual `contracts_for` responses govern availability, tick duration and digit barriers.

## Default configuration

Stake 1 in the selected account currency; target profit 100; stop loss 100; maximum entries 50; concurrent contracts 2; maximum open exposure 10. Martingale is **off** by default (configurable multiplier 2.1 and four escalation steps). Recovery is off by default. Analyse-before-every-entry is default. Optional continuous-after-non-win resumes that lane on a fresh tick, without claiming a fresh condition match. Positive settlements return it to scanning.

Initial market selection is discovered open one-second Volatility indices, not a hard-coded list. All-market and individual selection include available Volatility/Step indices returned by the API. Configuration, including market selection, is editable and locally saved; no credentials are saved with it.

## Architecture and safety

- One `EliteBot` coordinates independent rule/market lanes and one shared `RiskManager`. Slots and stake exposure are reserved synchronously before pricing yields. Concurrent contracts, gross open exposure, session entries, equity, global and frozen strategy limits are enforced together.
- Each market starts from actual paginated history and a live stream. History cannot purchase. A new live condition, current account/permission, source tick revision, signal freshness and valid broker proposal are rechecked immediately before purchase. A gap over five seconds halts sequential-pattern execution until an explicit restart.
- Recovery and martingale state are independent per lane. At most one pending purchase per lane; a round-robin cursor avoids permanently favouring the first rule.
- Stop blocks new purchases but does not cancel accepted contracts or declare them settled. Unknown submitted outcomes remain locked and are never retried. Account switching, resetting risk/session, clearing history and starting another bot cannot bypass unresolved Elite contracts.
- Shared Summary/Transactions/Journal list all simultaneous accepted opens and their rule identities. Paid stake includes accepted open purchases once. Potential payout is not counted as settled payout. Currency and account identity follow the authenticated channel.
- Refresh never resumes execution. A small synchronous receipt checkpoint bridges the interval before IndexedDB commits; it contains contract metadata and actual recent terminal records, never credentials. Pre-purchase checkpoint failures cancel before buy. Known IDs can reconcile read-only against the selected account's actual terminal contract; no-ID buys remain unresolved. Reconciliation requires identity and actual terminal stake/profit, and cannot infer a result from disappearance or time elapsed.
- Run and Reset controls remain disabled until the durable client store is restored. Receipt checkpoint writes and persisted broker-result reconciliation were verified with immediate navigation/reload.

## Verification completed

1. **625 tests, 53 test files — all pass.** Includes 20 evaluator/config tests, 15 concurrent coordinator tests, four reconciliation tests, six receipt-checkpoint tests, concurrent-console tests and refreshed pending-state store guards. TypeScript, ESLint (zero warnings), `git diff --check` and a clean production build pass.
2. **74 controlled Elite browser assertions:** 37 with a synthetic Demo account and 37 with a synthetic Real account, through a production-built app against isolated test transports. Covers five-rule/three-condition caps, both simultaneous purchases, shared exposure/concurrency/entry caps, exact confirmed account, account-switch lock, lane attribution, paid-stake/payout/profit accounting, Stop, immediate refresh, durable financial lock, actual fixture terminal reconciliation and absence of duplicate buys.
3. **96 controlled Overlord session regression assertions:** 48 Demo and 48 Real, including mobile Summary/Transactions/Journal at 320×568 through desktop. Existing tools retain their shared session behavior.
4. **16 genuine public local-production-build checks:** actual market discovery, history, live subscriptions for all eight discovered one-second markets, five observed digits/moves per market, ten observed-frequency bins, responsive widths 320/360/390/768/1280, contract capabilities, exact confirmation, preserved navigation and zero private authentication/buy messages. Real `contracts_for` responses returned 1–10 tick support for the eight implemented contract types on all eight selected markets, with Over 0–8 and Under 1–9.
5. Browser screenshots were inspected; no page overflow or runtime errors. Synthetic fixtures were stopped before the clean genuine-data build and are not included in production configuration.

### What has not been verified

No genuine private account purchase was placed. Synthetic Real/Demo attribution tests do **not** prove a successful private order or recovery of the user's particular account. No claim of predictive edge or guaranteed profit is made. Production rollout status is recorded separately after the push/deployment attempt; a local build and HTTP 200 alone are not a production deployment.

## Reproduction

- `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- `tools/elite-flow.mjs`: controlled UI integration only, isolated broker test transport required; `TEST_MODE=real` exercises synthetic Real attribution. Never point it at the production brokerage.
- `tools/elite-public-flow.mjs`: genuine public read-only checks; `BASE` selects the app origin. Never authenticates, confirms execution or purchases. Supports deployed production smoke checks.
