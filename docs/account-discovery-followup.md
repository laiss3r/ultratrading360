# Missing Real selector — targeted follow-up, 31 October 2026

Approved frontend baseline: `9880b0a`. This patch preserves its layout, styling,
navigation, authentication configuration and all API routes.

## What the screenshots establish

UltraTrading shows one actual Demo account. The reference shows a Real-labelled
zero-balance row and a Demo row. The screenshots alone do not establish the
identity or broker account type behind the reference's Real-labelled row.

## Findings

1. Our callback skipped additional discovery whenever any Options account existed.
2. Our refresh function returned early for any non-empty REST list, including
   Demo-only lists. Existing Demo-only sessions therefore did not try the browser
   discovery bridge automatically.
3. Browser discovery used an empty application identifier if its public environment
   variable was absent. A stalled first host could consume the whole failover budget.
4. Classic authorize account lists can omit balance amounts. Missing amounts must
   not be converted to a fictitious zero Real balance.
5. The reference's public bundle has a special case for one specific `DOT…` account:
   when selected, the normally Demo-prefixed ID is displayed as Real. This means the
   reference label alone is not proof of a genuine Real account. We do not know
   whether that special case is the account in the user's screenshot.

Public source inspected:
`https://360tradinghub.co.ke/static/js/async/349.9074379c.js`.
The relevant logic sets a specific DOT ID as an exception, computes row
`isVirtual` using both the ID and active ID, and applies the same exception to the
header's Real/Demo label. No source code or hard-coded relabelling was copied.

Official legacy REST documentation was also checked:
`https://developers.deriv.com/docs/options-legacy/` and
`https://developers.deriv.com/schemas/legacy_accounts_response.schema.json`.
Those endpoints provide historical mappings without live balance amounts; they
were not used to invent a live Real account or balance.

## Changes

- Continue additional read-only discovery for incomplete account lists, not just
  empty ones. A fresh listing containing both environments avoids the token bridge.
- Automatically attempt this once for a Demo-only signed-in identity, including
  existing sessions after reload; no extra login button is required.
- Preserve existing Options rows, merge discovered rows and retain selected identity.
- Surface discovery errors while retaining existing accounts. Do not interpret
  discovery failure as proof that the user owns no Real account.
- Use configured public app identifier and divide the bounded timeout across hosts.
- If authorize omits amounts, request read-only all-account balances. Adopt only
  rows with actual finite balances; never substitute zero for an unknown amount.
- Keep selection separate from execution. Classic display rows do not grant
  Options OTP trading authority, and Real acknowledgement guards remain intact.

## Executed evidence

- Typecheck, lint, production build and diff whitespace checks passed.
- **363 tests / 30 files passed.** Added regression tests for Demo-only discovery,
  duplicate-operation rejection, partial failure preservation, configured app ID,
  failover, missing balances and no relabelling/fabricated Real row.
- **11 synthetic browser checks passed** using genuine application APIs and UI,
  with a fixture returning only Demo over REST and separate classic Real/Demo rows
  whose authorize listing initially omits balances. The browser discovered the
  additional row, fetched actual fixture balances, selected Real, preserved it
  through navigation/reload/refresh, and was refused Options trading on display
  metadata alone. No mobile overflow or uncaught browser errors.
- All test fixtures were stopped. Production build was recreated without fixture
  variables. API routes, shell and styles have no diff from the approved baseline.

Workspace logs: `/home/user/account-discovery-tests.log`,
`/home/user/account-discovery-build.log`, `/home/user/account-discovery-browser.log`.

## Explicit limitation

This is a verified correction to skipped discovery, not proof that the user's
current credential grants access to a genuine Real Options account. No live user
session, actual balance, real OTP or live trade was accessed. A Real row can only
appear if Deriv returns it with usable account data. If Deriv still returns only
Demo, the app must not fabricate a second account, rename Demo as Real, or
create a Real account automatically.
