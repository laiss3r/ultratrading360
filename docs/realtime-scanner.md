# Real-time market scanner

The scanner is read-only. It never buys and does not share permission to execute orders.

- Opens selected market streams before paged historical seeding. At most three concurrent stream openings and three historical seed jobs; history transport retains its rate pacing.
- Real history-page counts, latest quote, observed digits, tick count and broker timestamp are displayed. UI batches at 250 ms; no synthetic confidence or cycling market progress.
- Each market seeds up to 5,000 genuine ticks. Ticks buffered during training are part of training only, never new forward validation.
- Contract, barrier, duration, provider and selection changes invalidate the entire displayed scan immediately; late callbacks from stopped scans cannot reappear.
- Detected live gaps invalidate forward evidence and automatically reseed. History errors retry with 2–30 second backoff and a 45 second seed deadline. Stop aborts pending seeds, clears timers, disposes subscriptions and immediately hides results.
- A fresh connected feed is not a qualified pattern. Use market is disabled without current qualified evidence. The bot independently requires fresh evidence, a real payout, execution permission and all risk checks.
- Qualification thresholds and real-account consent are unchanged. Public data does not verify private account discovery or execution. Stopping this scanner does not stop an already-running bot.

Validation: typecheck, ESLint, production build; 501 tests in 46 files. Six mobile browser checks with fixture identity but genuine public Deriv ticks: parallel streams, observed quotes, unqualified selection blocked, 360px no overflow, Stop clears rows, no runtime errors. No order submitted. Scanner unit tests cover page telemetry, buffered forward-data exclusion, duplicate/malformed tick rejection, timeout retries, late callbacks, cancellation ownership, gap recovery and disconnected evidence. Market transport tests assert actual 1,000-row progress across all five pages.

Reproduce browser checks using the existing isolated transport fixture, a production build on port 3002 with `tools/auth-transport-hook.cjs`, and `node tools/scanner-browser-flow.mjs`. Do not use the fixture hook in production.
