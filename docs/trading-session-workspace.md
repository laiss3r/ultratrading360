# Shared trading-session workspace — 2026-11-01

## Reference and scope
Based on the supplied 360 Trading Hub screenshots and publicly accessible reference application code (Run expands its run panel). The public site itself exposes a loading shell without authentication. No private reference account was used. Preserves Ultra Trading 360 navigation and account authentication; no Telegram/Support additions.

## Implementation
- One global full-width, expandable workspace replaces the floating sidebar and duplicate Overlord console.
- The shared store opens Summary after validated Run preflight, before awaiting broker startup. Confirmation dismisses at `starting`; startup failures stay visible in the session. Permission failures do not hide the confirmation or start trading.
- Overlord prepared runs, saved bots, Builder and the session dock use the same execution boundary.
- Summary, Transactions and Journal share actual account/run data. Tabs have independently scrolling content, persistent six totals and persistent Run/Stop lifecycle controls. Collapse does not stop, reset or restart execution.
- Accepted open contracts appear pending, never as settled wins/losses. Entry/exit spots, currency, actual return, potential payout, expiry, broker transaction IDs, contract description, tick progress and resale availability are shown only when reported. Missing fields are labelled unavailable. Potential payout is never counted as a settled gross return.
- CSV/JSON downloads and history inclusion remain account-scoped. Reset clears the view but preserves stored history. Stop blocks subsequent buys while an accepted contract settles. Pending contracts continue to lock reset/account switching.
- No synthetic trading results were added to application code. Controlled fixtures remain test tools only.

## Verification
- TypeScript, ESLint, production build and diff whitespace checks pass.
- 564 tests across 48 files pass, including deferred startup expansion, startup failure, preflight rejection, immediate confirmation dismissal, accepted open contracts, potential-vs-actual payout, prior-history/account isolation.
- `tools/session-flow.mjs`: 48 controlled browser assertions per account mode (Demo and Real), 96 total. Synthetic transport only, not genuine private broker execution. Includes qualified Overlord execution and risk limits, Builder/saved-bot expansion, collapse/reopen, downloads, pending Stop, authenticated refresh/no resume, history persistence/account switching, and each tab at 320×568, 360×844, 390×844, 768×844, 1280×844.
- Genuine public read-only regression: 19 browser assertions pass against real Deriv market histories; no authentication or order sent.

## Verification boundary
No private Real/Demo credentials were requested or used, and no live-money order was placed for testing. Public reads and controlled fixture orders do not prove a user's private purchase or account-recovery path. Existing consent, broker connection, live-signal and risk checks are retained.
