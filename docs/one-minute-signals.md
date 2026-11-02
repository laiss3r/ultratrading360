# One-minute Signals results

## Behaviour

The user asked for a scan of at most one minute and delegated the choice of logic. The implementation bounds analysis rather than inventing an edge or relaxing qualification:

- Each scan has a **60,000 ms monotonic budget**, including broker-clock verification, queued history, read backoff, training and new outcomes. At the deadline, publish a final result, abort history, cancel retries and release scanner streams. Late responses cannot change the result or reopen resources.
- Each card reports **Qualified**, **No qualified setup**, or **Incomplete — data deadline reached**. `No qualified setup` requires completed evidence that fails the bound. Incomplete history, forward samples or stale/disconnected evidence must not be misreported as a rejected fully tested model.
- Retain timestamped results with a **Scan again** action. Qualified snapshots still expire after five seconds; the UI ages them after completion instead of leaving them green/actionable indefinitely.
- **Use market is independent of qualification.** It selects an actual listed market; it does not buy, start a bot, grant account permission, certify an edge or bypass payout/risk checks. It respects the caller's disabled state and connection state.
- Every market card shows the actual blocking reason. Forward counts now say `Forward sample: N / 30 minimum observations · H matched`, avoiding the earlier ambiguous H/N wording. Meeting the sample count alone is not a qualified signal.
- Existing 5,000-tick target, chronological training/held-out rules, forward requirements, conservative bound and all trading execution safeguards are unchanged. With 13 markets, some histories may legitimately be incomplete at the deadline. A minute is a maximum analysis budget, not a promise that the broker returns all data or a profitable trade exists.

Browsers can suspend background tabs or block the main thread. The deadline is enforced when JavaScript runs; freshness/elapsed guards reject post-budget updates on resume. It is not a hard real-time operating-system guarantee.

## Validation

- **675 tests / 55 files PASS**, TypeScript, ESLint, production Next.js build and diff checks pass.
- New tests: full deadline cleanup and late-response rejection; deadline covers stalled clock verification; fully observed failed evidence returns no setup; market selection without qualification; retained results and rescan; expiry of qualified snapshots.
- Actual public broker test, local genuine-config build, 13 markets, device clock +2 minutes: first model 16.27 s; retained final results appeared at **60.15 s** including browser delivery overhead; four full models, nine incomplete; 44 actual history responses and 675 raw tick frames; no broker errors. **16 browser checks PASS**, including 320/390/1280 layouts, Stop/restart and no private auth/proposal/order. This observation does not guarantee future network speed or successful qualification.
- Broker/account execution code is unchanged in this release. No genuine private orders placed.
- Reproduce using `CLOCK_OFFSET=120000 node tools/signals-public-flow.mjs`. Unlike the earlier historical recovery test, this version expects retained results at the deadline rather than waiting several minutes for 13 full models.

The prior history/clock investigation is recorded in `signals-history-recovery.md`. This document supersedes its continuous-until-complete scan behaviour.
