# Overlord Pro: researched implementation

**1 November 2026, Nairobi.** Target: add the reference behaviour without changing the approved UltraTrading360 shell, navigation, account/security flow or design system.

## Research

Reviewed the supplied Overlord Pro V2.3 screenshots and the public application at https://360tradinghub.co.ke/ . Its Overlord implementation is in https://360tradinghub.co.ke/static/js/async/476.ed653109.js . This is behavioural research, not an endorsement of its trading claims or a copy of its interface.

The public implementation compares historical outcome frequencies across volatility markets and selects the lowest observed occurrence of the chosen contract. It separates secondary-contract recovery from stake multiplication, offers alternate/switch-on-loss/return-after-recovery modes, and expires a market suggestion. Its confidence display uses `15*Math.random()+80`, rather than a measured forecast. Its expiry code uses 60 seconds even though adjacent copy describes two minutes. We deliberately did **not** reproduce either misleading presentation.

Deriv's own Martingale guide discusses starting stake, multiplication, profit/loss thresholds and the rapid increase in risk: [1](https://deriv.com/blog/posts/martingale-strategy-in-deriv-bot). Our cap policy is deliberately stricter than copying a reference bot's stake behaviour: global limits cannot be loosened by a saved setup.

## Behaviour delivered

| Reference feature | UltraTrading360 behaviour |
| --- | --- |
| Contract / prediction / market | Eight existing genuine contract types: Even, Odd, Over, Under, Matches, Differs, Rise, Fall. Validates meaningful digit barriers and 1–10-tick duration. RUNHIGH/RUNLOW are not supported or silently substituted. |
| Find Market | Requests 300 real public historical ticks per selected open volatility market; three concurrent requests, at most 20 markets, cancellation and progress. Rejects insufficient/invalid/unordered history; requires at least 100 ticks. |
| Ranked result | Lowest observed occurrence first, matching the researched contrarian ordering. Non-overlapping duration-sized samples; actual hit/sample counts, observed frequency, Wilson interval and uniform-digit baseline where relevant. No invented confidence or recommendation of a guaranteed market. |
| Suggestion expiry | Visible 60-second expiry. Changing contract, duration or prediction invalidates observations. Expired observations cannot be applied from the result table. |
| Run Bot | Saves a genuine strategy, then opens the existing account confirmation. Neither save nor confirmation bypasses global execution permission, Real acknowledgement, account/socket identity or currency verification. |
| Recovery contract | Independent toggle and validated secondary contract/prediction. After a nonpositive settlement, return-after-recovery stays on the recovery leg until its first positive settlement, then returns to base. This is **not** a promise that all accumulated losses have been recovered. Switch-on-loss toggles legs after each nonpositive settlement. Alternate changes legs every selected 1–5 settled contracts. |
| Martingale | Off by default; selected multiplier (2.1 default), bounded escalation steps (1–10), and global stake/exposure enforcement. Positive settlements reset the loss streak. At the configured step limit the progression stops escalating; applicable global risk limits still decide whether another entry is allowed. |
| Target / stop / entry cap | Per-bot profit target, loss stop and maximum entries intersect with stricter global limits. Immediate post-settlement checks stop further entries when reached. Stops cannot eliminate the loss of an already-purchased contract. |
| Session / ledger | Existing session monitor and broker-result ledger, plus a compact Overlord session summary using actual risk state. No fabricated trades, balances or P/L. |

A low historical occurrence does **not** make an independent outcome due. Intervals are descriptive, not next-trade probability or expected profitability. Simultaneously scanning markets also introduces selection bias. Martingale and changing contracts do not create a demonstrated edge.

## Execution issues corrected during integration

- The provider previously defaulted a verified execution back to one tick and USD. It now carries the actual immutable priced request through a private, single-use context, preserving account currency, duration, contract and barrier.
- Pricing is verified again, with the approved ask as the maximum. Stop and risk permission are checked again immediately before the final buy, **after** this second proposal.
- The final risk check excludes its own reserved exposure, avoiding accidental double counting; a definitive pre-buy cancellation releases that reservation without inventing a trade.
- Orders are sequential through settlement. A pending order prevents replacing the bot or switching its account. Execution/settlement uncertainty halts automation; there is no automatic purchase retry.
- Settlement processing accepts a terminal first subscription frame, clears its timer and forgets the settled named subscription so it is not replayed on reconnect.
- The store retains the actual new risk-manager instance used by the bot, rather than showing a previous instance in live controls.

## Evidence

- **401 passing tests, 35 files**; typecheck, ESLint, production build and `git diff --check` passed.
- Added targeted scanner/configuration, recovery rotation, progression/engine, currency/duration, last-moment cancellation, reservation, terminal settlement, subscription replay and UI confirmation/validation tests.
- **13 synthetic end-to-end browser checks**: the genuine application engine logged in to the explicitly synthetic upstream, enabled Demo permission, scanned, requested confirmation before any buy, then purchased EVEN/OVER/OVER with stakes 1/2.10/4.41 and duration 3. Two fixture losses and one fixture win produced net +1.09; the target halted the bot and no fourth buy occurred. The actual application ledger contained the fixture settlement records. Mobile width 390px: no horizontal page overflow or uncaught browser errors.
- Separately, a clean build used **real unauthenticated Deriv public history**: the scanner returned **13 volatility market observations**. Mobile width 390px: no horizontal page overflow and zero uncaught browser errors.
- The clean production browser bundle was checked for local fixture URLs; none were present. Fixtures are opt-in tools, not application fallbacks, and contain no real account credentials.

The synthetic run validates application integration, **not real-money broker acceptance**. No user's live order was placed and no claim is made that the user's previously missing Real account has been resolved by this feature. Interactive consent, the user's actual account permissions and live buys still require independent acceptance testing. Start on Demo.

## Operational limits

Automation remains browser-local: keep the tab open. Saved settings do not automatically resume trading on reload. Network errors, broker rejection or unknown order outcomes halt rather than fabricate a settlement or retry a buy. Review the broker account before manually restarting after an uncertain outcome. This feature is not a persistent server-side trading service; the Django backend remains undeployed.

Implementation: `src/lib/overlord.ts`, `src/lib/engine/rotation.ts`, `src/app/overlord/page.tsx`, and the existing engine/provider/risk/account-store integration. Reproducible synthetic harness: `tools/overlord-flow.mjs`, with setup in `tools/README.md`. The approved global styles, app shell and authentication API routes were not redesigned.
