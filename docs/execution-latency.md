# Execution-speed improvements — 2 November 2026

## Release status

Implemented and validated locally. **Not deployed.** An authenticated GitHub push is blocked: the current workspace has no GitHub push credential (`could not read Username`, terminal prompts disabled). No replacement token was requested or saved. Vercel's production deployment remains `37897793f5a229a62cbf69b54312288e4eec3597`, deployment `dpl_BHDKbJNYa5RMXrzhLfxNz9Cxi9SQ`, READY/PROMOTED. Do not mistake the workspace preview for the production site.

## Changes retained

1. **Elite readiness:** request market capabilities and history concurrently, with the existing maximum of three startup workers. Both responses must succeed and pass validation before that market can stream/enter. Stop during preflight cannot subscribe or buy.
2. **Repeat Run:** skip an unnecessary awaited settings write only when execution is already enabled and, for Real, the selected account already has its own explicit acknowledgement. Account identity, verified channel, pending receipt and final permission checks still run. First-time Real acknowledgement remains inline, never automatic.
3. **Receipt durability:** suppress repeated open-progress saves only when durable receipt fields are unchanged and current storage is byte-identical to the last successful write. Initial receipts, changed receipt identifiers, buying, stopping, unresolved states and settlements retain synchronous persistence. External storage changes, storage replacement and failed writes do not authorize a skip. The fingerprint cache is bounded and reset on explicit checkpoint clearing. Unresolved contracts are never unlocked by timeout.
4. **Session UI:** memoize account/run ledger selection, metrics, financial Journal and unresolved receipt selection against their actual inputs. Quote-only updates still render live prices, but do not recreate unchanged financial arrays/metrics. New trades, lifecycle messages, account/mode switches and reset changes invalidate the relevant caches. A proposed Journal-index rewrite did not improve measured rebuild time and was removed.
5. **Measured timing:** contract details show observed pricing duration, buy request-to-response duration and quote-request-to-receipt duration only when measured. Monotonic `performance.now()` is used. Pricing includes any required refreshed proposal. The final metric begins at the initial proposal request, not at Run or signal qualification; it excludes settlement waiting. Both engines preserve timings in terminal records. Older/reconciled records may legitimately have no timing.

The previous release already reused immutable, single-use broker proposals for at most one second; that protection remains, with fresh repricing when needed. This release does not claim that existing feature as a new improvement.

## Controlled benchmark

Actual source was compared with commit `37897793f5a229a62cbf69b54312288e4eec3597`. These are **synthetic local fixtures**, never genuine account trades. The tool refuses pricing/buying. The startup adapter imposes a 60 ms capabilities delay and a 90 ms history delay. Receipt tests use an in-memory storage adapter and retain 100 synthetic terminal rows. Results from one controlled run:

| Work | Previous source | Updated source |
|---|---:|---:|
| One-market readiness | 152.64 ms | 90.86 ms |
| Writes for 1,000 unchanged open-progress frames | 1,000 | 1 |
| CPU elapsed for those progress frames, in-memory adapter | 242.88 ms | 6.97 ms |
| Journal rebuild median, 5,000 trades / 500 lifecycle rows | 17.34 ms | 20.34 ms |

The last row is explicitly **not a rebuild speedup**. The retained UI improvement is avoiding rebuilds when ledger inputs have not changed. A regression test verifies stable ledger/metric references across 100 quote-only rerenders, then verifies recomputation on settlement.

The startup improvement is about 40% under these fixed test delays, not a forecast for every connection. The storage benchmark measures serialization/control overhead, not a real browser disk-latency guarantee. Raw controlled results are in `execution-latency-benchmark.json` beside this document. Reproduce with `npm exec --yes --package=tsx -- tsx tools/execution-latency-bench.ts` from the repository root; temporary baseline modules are removed in `finally`.

## Verification completed

- **655 tests across 54 files PASS.** Added coverage for timing boundaries, refreshed-price timing, terminal timing preservation, quote-only memoization, Real/Demo permission fast paths, startup overlap, unsupported capabilities, Stop during preflight, redundant checkpoint frames, changed receipts, external storage changes and failed writes.
- TypeScript, ESLint, production Next.js build and `git diff --check` pass.
- Controlled full browser flows: Elite **39 Demo + 39 Real-mode checks**, shared session **48 Demo + 48 Real-mode checks**. These use explicitly synthetic transport, not genuine accounts. They cover concurrent exposure, selected-account routing, Stop, settlements, financial reconciliation, refresh recovery, no auto-resume and mobile layouts.
- The synthetic servers were stopped. The final build uses genuine public Deriv endpoints and app ID `34P4UiyGfp4cBEekMAF9S`.
- On that genuine-config local build: **22 public session/layout checks + 16 genuine public Elite discovery/history/stream checks PASS**, with no private authorization, no buy, and no browser runtime errors.
- Vercel production was independently checked and remains the previous release. No speed-release production verification is claimed.

## Boundaries and rollout

Signal requirements, payout checks, fresh-signal revision checks, account verification, concurrency/exposure limits, recovery rules and reconciliation protections were not relaxed. No private Demo or Real orders were placed. Faster app work does not make an unqualified signal eligible and cannot guarantee faster broker/network acknowledgement or better trading outcomes.

Before a future rollout, push the reviewed local commit through authenticated GitHub access, verify the exact SHA reaches Vercel READY/PROMOTED, then repeat the public read-only checks against production. Users should Stop and allow accepted contracts to settle before reloading; never clear pending financial locks to force a restart.

API flow reference reviewed: https://developers.deriv.com/docs/workflows/ (proposal → buy → contract monitoring; current account-authenticated WebSocket flow).
