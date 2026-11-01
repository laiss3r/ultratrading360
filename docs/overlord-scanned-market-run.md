# Run a scanned market’s best setup

After Find market produces an analysed market, **Run market** appears beside the market name and on the highlighted highest-probability result. It uses that row’s own best scanned contract/barrier and analysed tick duration, retaining the user’s stake, recovery settings, entry limits and risk caps. The visible Trading setup updates to match.

The strategy is built directly from the clicked row, not from a React state update or a previously selected market. Confirmation explicitly identifies its market, contract, duration, stake and account. Confirm & run follows the existing execution boundary and expands the shared session workspace. Historical percentages never bypass live-signal validation, broker payout checks, account permissions or risk limits.

Readiness, result age, duration, open-market listing and single-bot/pending-order protections are checked before preparation. Expiry is checked again on confirmation. A changed market selection blocks confirmation rather than silently running a different market. No order is submitted just by scanning or opening confirmation.

Verification: full automated suite, TypeScript, ESLint and production build; 17 controlled fixture browser checks covering clicking R_25 while R_10 is selected, row-best contract/barrier, retained stake, visible setup, confirmation, automatic expansion, waiting without an unqualified buy, disabled additional runs and 320/390/1280px overflow. Browser orders are an isolated fixture, not genuine private broker execution. Unit regressions cover stale clicks/confirmation, duration mismatch, active/paused/starting/stopping bots and pending contracts.
