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

## Follow-up: stale-cookie race and direct authentication completion

The earlier Real preference alone did not prevent a background read from writing an
older Demo cookie back after a selection. `/accounts` and `/session` GETs are now strictly
read-only, including error responses. Client identity revisions discard obsolete reads;
identity-changing POSTs (login, adoption, switching and logout) are serialized.

The OAuth callback now consumes its successful response directly rather than making
extra session/account refresh calls. AppShell does not hydrate an old cookie or flash
its dropdown during a new callback. Market history, rankings and trading sockets load
independently after identity is committed. Known signed-cookie rows switch for VIEWING
without waiting on an upstream account-list request; trading still requires the socket
endpoint's fresh broker verification and all existing financial safeguards.

A failed new OAuth attempt cannot be replaced with any old authenticated Demo session.
Reload recovery is bound to the exact successfully completed OAuth attempt (a server-only
state hash), not merely the presence of a cookie. If the first response contains only
Demo, classic Real discovery finishes before navigation; it never briefly lands in Demo.
If no Real row is returned, the callback says so and offers an explicit Demo choice.
Authentication no longer creates a Demo account automatically.

Final verification before push: 472 unit/UI tests, typecheck, lint and clean production
build; 17 synthetic slow-market/stale-response checks, 7 late-discovery/no-silent-Demo
checks, 12 existing Real-first/switch/reload checks, and 27 mobile checks. In the final
slow-market run, Real appeared 90 ms after the authenticated response while market
history was delayed 10 seconds. This is fixture timing, not a promise of instantaneous
Deriv network/consent response. Browser callback tests use fixture-backed session API
responses; actual OAuth code exchange/state logic is covered separately in route tests.
No live interactive Deriv consent, private user accounts, funds or orders were used.
