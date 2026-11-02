# Signals history loading / clock recovery — 2 November 2026

## Status

Fixed and tested locally; **not yet pushed or deployed**. GitHub push was attempted, but the workspace has no authenticated GitHub push access (`could not read Username`, terminal prompts disabled). No replacement token was requested, recovered or saved. The deployed site therefore still serves the previous production code. The earlier execution-speed commit is also local only.

## What the screenshot shows

The screenshot combines 0/13 completed historical seeds, zero accepted live ticks, queued cards and a stale/future-dated historical-seed error. A connected public socket does not prove the scanner accepted its timestamps.

We reproduced the zero-live-tick symptom against the **actual deployed site** by shifting the browser clock two minutes: the browser received 202 genuine broker tick frames in 18 seconds, while the cards reported zero accepted live ticks. With an unshifted clock, a separate 18-second run accepted live ticks. This establishes a real device-clock dependency, not proof of the user's exact clock setting.

The original progress header counts fully completed 5,000-tick seeds. Multiple in-flight seeds interleave their pages on a shared paced transport queue; it can say 0/13 even when several thousand real ticks have already loaded. The app also performs background market-ranking history reads. Thirteen markets are not thirteen instantaneous API requests: the server can cap each response at 1,000 ticks, requiring pagination and a newest-data refresh for every market.

Genuine public browser validation additionally captured repeated broker errors:

> RateLimit: You have reached the rate limit for ticks_history_expensive.

These caused read-only backoff and some 45-second seed deadlines/restarts. The request unnecessarily supplied `start: 1` (January 1970). Current documentation makes `start` optional and defaults tick history to one day ago. For the supported 1/2-second markets, the recent 5,000-tick window fits well within that default.

## Fixes

- Ask the broker for public `{time: 1}` before starting scanner streams. Verify the response and use a monotonic-clock anchor for scanner timestamps, training, snapshots and retry countdowns. A large clock-response round trip is rejected/retried, not used as permission to trade.
- Use a monotonic clock for history-request pacing as well, so correcting the computer clock mid-scan cannot freeze the read queue. A regression verifies the next read still runs after 1.2 seconds even when wall time jumps backwards two minutes.
- Keep five-second tick freshness and future-timestamp checks intact, evaluated against broker time. Warn when the computer clock differs materially. Other trading checks are not bypassed; users should still enable automatic device date/time.
- Open all bounded scanner streams, but finish one full historical seed at a time rather than interleaving three across an already serialized history transport. This makes the first model available sooner without reducing the sample size.
- Remove the unnecessary 1970 `start` boundary from paged recent tick requests. Preserve count, cursor validation, precision validation, chronological order, newest-data refresh, cancellation, pacing and rate-limit backoff.
- Surface actual broker rate-limit waiting in the market card instead of silently appearing idle. Clear previous-attempt errors when a retry is queued/started.
- Report actual historical ticks received, completed market models and live-stream counts separately. Progress is not predicted trading accuracy.
- Immediately after training, explicitly say history is ready and the next live tick is awaited rather than labelling the never-yet-live model stale. No entry is allowed during that state.

## Genuine public validation

These are real read-only API observations on the locally built app, not simulated trades and not production-deployment verification:

| Run | First full market model | Full selected set | Broker read errors |
|---|---:|---:|---:|
| Clock-calibration/sequential-seed changes, before removing `start: 1`; device +2 minutes, 13 markets | 16.44 s | 241.84 s | 9 rate-limit errors |
| Final history request, device +2 minutes, 13 markets | 16.19 s | 127.70 s | 0 |
| Final history request, device −2 minutes, one market | 15.87 s | 16.11 s | 0 |
| Final history request, correct clock, one market | 15.82 s | 16.05 s | 0 |

These sequential real-network runs are **not a controlled broker-latency benchmark** or a guarantee that every full scan finishes in two minutes. The full scan received 93 history responses (including application background reads/reseeding), 1,408 raw tick frames and completed **13/13**, with 13 accepted live streams. Current markets can still legitimately produce zero qualified signals.

- Scanner public-browser checks: 15 + 15 + 14 + 14 PASS (all markets with positive skew, one with negative skew, one with normal clock, and one where wall time is corrected during loading). The final-build correction case still finished in 16.11 seconds with no broker read errors, proving the paced queue did not freeze. Mobile/desktop widths 320/390/1280, Stop cleanup, actual pagination/streams, no private authorization/proposal/buy, no runtime errors.
- Existing genuine public checks: session/layout 22 PASS; Elite discovery/history/streams 16 PASS.
- **669 tests across 54 files PASS**, TypeScript and ESLint pass, genuine-config Next.js production build passes. Added broker-time validation, positive/negative device skew, stale-history rejection under calibration, strict stale/future live rejection, Stop during clock verification, retry cleanup, sequential full seeding, removal of ancient history boundaries and visible real read backoff coverage.
- Reproducible genuine scanner check: `CLOCK_OFFSET=120000 node tools/signals-public-flow.mjs`. Optional `ONLY_FIRST=1` and `BASE=...`. It never authenticates or places an order.

## Why loaded history does not necessarily mean a signal

The 5,000 historical ticks train and hold out validation samples. Qualification additionally needs at least **30 new live outcomes for the current pattern** and the existing conservative evidence bound. Thirty outcomes can require more than thirty ticks. Payout, live freshness, selected-account verification and risk checks still govern an eventual entry. Historical loading alone is not evidence of a profitable next trade, and the fix does not manufacture qualifying signals.

## Deployment and user guidance

The reviewed local commit must first be pushed using authenticated Git access restored outside this chat, then the exact Vercel production SHA must be verified READY/PROMOTED and public checks repeated. Until then the live site is unchanged. Do not paste tokens or OAuth codes in chat. An exportable patch is supplied in the workspace.

While on the old live version: enable automatic device date/time, Stop and restart the read-only scan, and choose fewer markets if a faster first result is needed. Stopping this read-only scanner does not stop an already-running trading bot. Never reload through an accepted unresolved contract; Stop the bot and let contracts settle first.

Schema reviewed: https://developers.deriv.com/schemas/ticks_history_request.schema.json (`start` optional; ticks default one day ago; `count` is an upper bound; `end` required). Actual `{time:1}`, fresh history and streaming responses were checked against the current public WebSocket.
