# Overlord Pro: qualified live signals and execution audit

**1 November 2026, Nairobi.** Preserves the approved UltraTrading360 design, navigation and genuine account/authentication flow. User decision: **wait for qualified signals on either selected Demo or Real account**. This is not a Demo-only engine. No profitability or accuracy guarantee is made.

## Research and rejected claims

Reviewed the supplied Overlord V2.3 screenshots and https://360tradinghub.co.ke/ . Its public bundle at https://360tradinghub.co.ke/static/js/async/476.ed653109.js ranks low historical occurrence and displays `15*Math.random()+80` as confidence. Neither that ordering nor invented confidence is used here. A rare independent outcome is not "due".

Deriv's Martingale explanation warns of rapidly increasing losses: https://deriv.com/blog/posts/martingale-strategy-in-deriv-bot . Contract switching and stake escalation do not establish an edge.

Execution timing was checked against https://dsmarttrader.deriv.com/trading and the community discussion https://community.deriv.com/t/options-to-trade-on-deriv-reset-call-reset-put-high-tick-low-tick-and-asians/42287 . Rise/Fall use a future entry tick, not the already-observed signal tick. Network/broker latency can still change the eventual entry. The authoritative monetary/spot schemas were reviewed at:

- https://developers.deriv.com/schemas/proposal_open_contract_response.schema.json
- https://developers.deriv.com/schemas/buy_response.schema.json

## Delivered workflow

1. Choose an actual broker market, contract/prediction, 1–10-tick duration and stake. Eight supported types: Even, Odd, Over, Under, Matches, Differs, Rise, Fall. Unsupported contract names are not silently substituted.
2. **Find market** starts a cancellable live scan with actual loading progress, status per market, held-out counts, new live outcomes and explicitly labelled evidence bounds. Up to 20 open volatility markets; three history requests concurrently. Market choice is enabled only for a currently qualified result.
3. **Run bot** saves the configuration and opens account/stake confirmation. A running bot may remain waiting indefinitely. No qualified evidence means no order. Primary and recovery contracts have separate live qualification.
4. A qualified signal still needs two fresh actual broker proposals, payout-margin checks and final signal/risk/account/currency/permission checks immediately before buy. No automatic retry after uncertain execution.
5. **Summary / Transactions / Journal** expose pending/accepted/settled lifecycle, broker IDs, current values, entry/exit spots, actual paid stake, gross returns and net P/L. Journal filters/download and account-specific prior sessions are available.
6. **Stop** blocks future purchases without discarding an accepted contract's settlement. Pending execution locks reset, bot replacement and account switching. Refresh never resumes trading automatically.
7. **Reset session view** clears displayed totals, not audit history or risk history. Transactions/journal persist locally, scoped to the actual selected account and environment. Journal storage is bounded to 500 events.

Recovery and Martingale remain separate optional controls. Return-after-recovery means return after a positive recovery settlement, not proof that cumulative losses were recovered. Switch-on-loss and bounded alternation are supported. Positive settlement resets the escalation streak; zero net is a non-win for progression but not a statistical win/loss. Stricter global risk limits always prevail.

## Fixed qualification policy

- Request 5,000 real history ticks through broker-epoch pagination (the public API was observed silently capping individual responses at 1,000); require at least 1,200 valid ordered ticks.
- Causal binary suffix candidates of length 1–3. Select on training only (at least 100 matching observations), validate chronologically on held-out history (at least 80), then require at least 30 **new live** matching outcomes. Retain the latest 300 matching forward outcomes.
- Non-overlapping labels, with historical and forward grids aligned. Rise/Fall labels use future entry at `i+1`, exit at `i+duration+1`; digit labels use exit `i+duration`.
- Require at least 2 percentage points over the relevant baseline. An adjusted Wilson-style lower bound uses z=3.75 (approximate allowance for 14 patterns × 20 markets). Lower bound × actual gross payout / ask − 1 must be at least 0.02.
- Five-second tick freshness, 15-minute model lifetime. A feed gap greater than 1.5 times the median positive historical interval resets validation; duplicate epoch/price frames are ignored. Stopped or stale scans cannot apply a qualified selection.

**These are conservative engineering gates, not a proven predictive edge.** Dependence, repeated monitoring, market selection, model drift and execution latency limit statistical interpretation. No next-trade accuracy percentage or guaranteed profitability is displayed. Strict gates may produce no trades on genuine random markets; that is intentional, not a reason to manufacture entries.

## Broker compatibility and accounting corrections

- Strict finite numeric parsing accepts decimal strings but does not convert null, empty strings or booleans into zero money. Current `entry_spot` / `exit_spot` and legacy spot aliases are supported. Wrong-contract updates are ignored; cancelled contracts are terminal. Broker settlement timestamps are retained.
- Actual gross return is paid stake plus finite realized broker profit. Potential payout is never counted as realized return on losses, partial sales or refunds. Zero net is shown separately.
- Priced immutable requests retain currency, duration, barrier and contract through a single-use execution context. Stop/permission/signal checks run after repricing and again after the buying callback.
- History reads share pacing and bounded exponential rate-limit backoff; Stop scan aborts queued reads/backoff. This never retries purchases. Multi-market loading can take minutes under broker limits; unavailable markets show their actual broker error and cannot qualify. A fresh newest page is fetched after backward pagination so old-page loading does not stale the seed.
- Independent chart/bot subscription keys and current-ID cleanup prevent a scanner or chart from unsubscribing another consumer. Completed POC subscriptions are forgotten rather than replayed.
- Selecting genuine Real synchronizes the persisted environment but never silently enables execution. Disabling permission stops new entries while preserving pending settlement; changing Real acknowledgement does not tear down a pending contract socket.

## Verification

- TypeScript, ESLint, full unit suite: **460 passing** including current-subscription-ID reconnect, history pagination and cancellation/backoff regressions; production build passed.
- Mobile full-stack browser fixtures: **27 Demo + 27 Real checks passed**. Verified qualification waits, actual chosen socket, decimal-string POC money/current spots, 1 → 2.10 → 4.41 accepted stakes, exact 7.51 paid / 8.60 returned / +1.09 net fixture accounting, target halt, export/account isolation, refresh/reset persistence, and Stop retaining an already-open contract until settlement.
- Fixture money/results above are **explicitly synthetic test expectations**, not advertised strategy performance. All fixtures are opt-in developer tools; no fixture feeds, simulated trades or fabricated balances are shipped in production.
- Existing Real-first account regression: **12 synthetic checks passed**, including stale preference, refresh, account switching and mobile overflow.
- Genuine unauthenticated public-feed check passed for selected R_10 and R_25: paginated history seeded real held-out samples, new live outcomes advanced, cancellation worked, and mobile had no overflow/runtime errors. Broad scanning also exposed broker `ticks_history_expensive` rate limits; these are now paced/backed off and reported rather than bypassed. Seven public workspace routes passed mobile overflow checks.
- No live authenticated funds/orders were used for these tests. Genuine-account profitability has not been established.

### Reproduce synthetic integration

Build with `NEXT_PUBLIC_DERIV_API_BASE=http://127.0.0.1:4517` and `NEXT_PUBLIC_DERIV_WS_PUBLIC=ws://127.0.0.1:4519`. Start `tools/derivstub.mjs` with `STUB_TRADING=1 STUB_PATTERNS=1 STUB_REAL_FUNDS=1 STUB_SETTLE_MS=1800`. Run Next with the same endpoint environment and an ephemeral test-only session-cookie key, then run `TEST_MODE=demo node tools/overlord-flow.mjs` and `TEST_MODE=real node tools/overlord-flow.mjs`. Set `PLAYWRIGHT_MODULE` to your installed Playwright entry point outside this sandbox. Never deploy a fixture build. Restore a clean normal production build afterward.
