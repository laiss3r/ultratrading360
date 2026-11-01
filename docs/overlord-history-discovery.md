# Overlord Pro — historical discovery

## Scope
Only Overlord Pro switches to the new `OverlordDiscovery` component and `lib/overlord/discovery.ts`. Signal Tools retains `LiveSignals` unchanged. Trading permissions, account discovery, execution, statistical live-entry policy, risk settings and other tools are unchanged. The only shared-provider addition is a read-only `contractsFor` accessor.

## Fetching and performance
- Find market opens its own public, read-only connection, requests the full API symbol list and queues every returned Volatility market immediately. It never subscribes to ticks or places orders.
- Four bounded workers prefetch history and contract specifications. History transport retains shared rate pacing/backoff; it is **not** an unbounded simultaneous request flood.
- Fixed default: **1,000 genuine historical ticks per market**, one actual API page. The previous 5,000-tick live seed required six history requests per market and subsequent live validation; that entry-validation pipeline is no longer used for descriptive discovery.
- 1,000 observations give roughly a ±3 percentage point sampling interval near 50% under independent sampling. This does not guarantee accuracy, independence or a trading advantage. For D-tick contracts, use non-overlapping terminal observations (floor(ticks / D)); UI displays the actual sample.
- Fresh history/specifications are cached in memory for 60 seconds. Changing duration reanalyses the same data, not a new download. Force Refresh history and automatic 60-second refresh fetch a new batch. Stop aborts work, closes the public connection and discards displayed results. Unmount also cleans up.
- Each market has a 45-second deadline, cancellation-aware callbacks and explicit error state. Initial connection and API listing also have bounded waits. One unavailable market does not suppress other results.

## Coverage and API names
No 20-market cap and no fixed volatility-number list. Selection uses the API display-name family (`Volatility`, including future named variations) with legacy `R_*S` / `1HZ*VS` fallbacks. Exact returned names are displayed. Closed/suspended rows stay visible with reasons; they are not represented as analysed. Contract types, barrier ranges and tick-duration restrictions are read from actual `contracts_for` responses.

The public API returned 13 currently available Volatility markets during validation, all 13 analysed successfully. None of that listing had an S suffix; no S market is invented. Unit coverage includes named/future S variants, legacy S suffixes and more than 20 markets, ensuring they are included when the API lists them.

## Analysis and ranking
- Re-derive each last digit from the actual historical quote at its `pip_size` precision, including trailing zeros. Invalid/mixed data is rejected.
- Evaluate Even and Odd plus every valid API-supported Over (0–8) and Under (1–9) barrier. Strict inequalities exclude the barrier digit. Usually 20 contract/barrier candidates per market.
- Probability displayed = historical hits / actual sampled outcomes. No random confidence, fixed demo values, fabricated prices or new-live-outcome countdown.
- Rank raw observed probabilities across all successful markets. Also show the largest observed lift over the contract's own uniform-digit baseline. Easy barriers normally have high raw hit rates and different payouts; a 90% historical estimate is **not** a 90% guaranteed next-trade accuracy or profitable edge.
- Show counts, actual sample, data timestamp, precision-derived recent digits, baseline and approximate Wilson interval. Multiple-comparison/independence limitations are explicit. Partial scans and failed markets are labelled; no claim that missing results were analysed.
- Applying an estimate only changes the market/contract/barrier setup. It does not place an order or bypass the bot's independent live evidence, payout, selected-account permission or risk checks.

## Verification
- TypeScript, ESLint, production build and 557 tests across 48 files passed before publication.
- 39 new analysis/controller/component cases cover all four families and strict boundaries, real precision/trailing zeros, every supported barrier, durations, >20/S market coverage, partial/closed/error results, cache reuse/expiry, cancellation, deadlines, stale/future history and applying setup without execution.
- Genuine public read-only scan: 13/13 returned Volatility markets analysed with exactly 1,000 ticks each, first computed result ~0.6s and total ~17.1s in one measured run; timings depend on broker/network/load. No ticks stream or buy was sent by discovery.
- Genuine browser checks cover all returned markets, counts/probabilities, full names/1s, no manual sample/checklist, independent historical transport, no live stream/buy from discovery, cache-based duration changes, setup application, Stop/restart, responsive layout at 320/360/390/1280px and unchanged Signal Tools.
- Browser verification found a close/reopen race during duration changes. Fixed by keeping the history connection alive across duration reanalysis and allocating a fresh discovery instance after Stop/error. The browser flow now explicitly regression-tests restart.

Reproduce with `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`; run `tools/overlord-public-history.ts` through a TypeScript runner for actual public API analysis, and `node tools/overlord-history-browser.mjs` with the built app running (or `BASE=https://ultratrading360.vercel.app` after deployment). Browser automation needs Playwright. Fixtures are isolated tools only, never production.
