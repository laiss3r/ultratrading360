# Faster execution submission path

## Scope

Reduce avoidable browser work between a qualified condition and the broker request. This release does not change strategy qualification, stake sizing, recovery, concurrency caps, account verification, payout/freshness checks, the one-minute read-only scanner, or the single-use ≤1-second proposal policy. No genuine private orders were placed for measurement.

## Changes

1. **Elite no longer serializes the entire receipt checkpoint for `qualified` and `pricing` notices with no financial exposure.** These notices remain in the normal asynchronous Journal. They do not yet represent a submitted purchase. The first `buying` marker still writes synchronously before the WebSocket buy is sent; a failure still cancels submission. Actual receipts, settlements, unresolved outcomes and notices containing a contract ID or submitted-purchase marker remain synchronous.
2. **Cancellation writes remain critical.** In particular, a `waiting` frame clearing a buying marker must be persisted. Otherwise Stop/permission cancellation just before send could leave a phantom unresolved lock. This release explicitly retains that write and tests the buying→cancelled transition.
3. **Checkpoint partitioning is one linear pass**, retaining all pending entries and the same capped closed history, rather than filtering and repeatedly searching the pending array.
4. **Both engines publish execution and changed Journal together in one state update.** Previously an execution transition caused two synchronous subscriber notifications and briefly exposed new execution with old Journal state. Progress-only frames still avoid adding duplicate Journal rows. Journal persistence, critical receipt-before-send ordering and error handling remain intact.

## Controlled measurement

Compare actual source at `5365fd5fbf90188aba268d3362c1169839189b36` with the updated code using an 83,606-byte checkpoint of 100 synthetic retained records. Fifty measured samples follow ten warm-up samples. The adapter is an in-memory Map: it measures actual JSON/control CPU and write count, **not browser disk latency or real broker acknowledgement time**.

| Qualified → pricing → buying marker | Before | After |
|---|---:|---:|
| Synchronous checkpoint writes | 3 | 1 |
| Median pre-proposal checkpoint CPU | 0.570 ms | 0.002 ms |
| Median CPU through buying marker | 0.883 ms | 0.292 ms |

This is a small measured client-side saving, not a claim that total execution or broker fills are 66% faster. The critical write is deliberately retained. Real device storage/CPU and network costs vary. Existing contract details report actual pricing, broker acknowledgement and quote-to-receipt times when available.

Reproduce: `npm exec --yes --package=tsx -- tsx tools/execution-hotpath-bench.ts`. The baseline temporary module is deleted in `finally`; no account or socket is used. Raw results: `execution-hotpath-benchmark.json`.

## Validation

- **682 tests / 55 files PASS**, TypeScript, ESLint, genuine-config Next.js production build and diff checks pass.
- Added regression tests for zero nonfinancial storage work, unconditional persistence of exposure-bearing notices, preservation of unrelated pending contracts, clearing a cancelled buying marker, and atomic execution/Journal notifications.
- Controlled synthetic browser flows: Elite39 Demo +39 Real-mode, shared-session48 Demo +48 Real-mode PASS (174 checks). They cover actual request routing through an isolated transport, concurrent exposure, selected account, entry/stop-loss caps, Stop, accepted settlements and refresh/reconciliation. These are not claims of genuine private trading verification.
- Genuine public final-config local checks: session/layout22 + Elite discovery/history/streams16 PASS. No private authentication, quote or order; no runtime errors.
- Synthetic servers were stopped before the genuine final build. No credentials are part of the code or benchmark.

Rollout verification is recorded separately in the workspace release status after GitHub/Vercel publication. Stop and allow accepted contracts to settle before reloading. Never clear an unresolved receipt lock to make execution look faster.
