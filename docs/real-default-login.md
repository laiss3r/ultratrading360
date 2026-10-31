# Real-first login, explicit switching afterward

1 November 2026 (Nairobi).

Fresh OAuth and PAT sessions prefer the first genuine Real account returned by Deriv.
If the initial Options listing contains only Demo, a private encrypted-cookie flag keeps
that fresh-login preference pending until additional discovery returns Real. Discovery
then selects the returned Real identity and its own balance, including a genuine zero.
It does not turn a Demo identity into Real, manufacture an account, or grant trading rights.

Any explicit subsequent account selection clears this preference. Choosing Demo stays
Demo across reloads, navigation and account refresh. A new login starts the Real-first
policy again. The server cookie is authoritative: a stale local Demo preference from a
previous login cannot override fresh authentication. Identity changes also update the
client account mode/provider and clear Real trading acknowledgement.

If Deriv only returns Demo, the app retains Demo rather than inventing a Real account.
Real viewing remains independent of Real execution acknowledgement and global trading
permission. No design, navigation or broker-authentication bypass was added.

Evidence: 408 passing unit/UI tests (36 files), typecheck and ESLint passed. A 12-check
synthetic authenticated browser run verified late Real discovery, old local preference,
manual switching both ways, reload/refresh retention, Real default on a second fresh
login, disabled execution permission, mobile width 390px and no uncaught browser errors.
No live account or live order was used. Interactive Deriv consent and the user's actual
account list still require user acceptance; synthetic results do not establish that a
previously missing Real account is now returned by Deriv.
