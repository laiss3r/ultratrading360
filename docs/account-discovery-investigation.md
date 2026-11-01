# Account discovery investigation — 2026-11-01

## Status: private Real-account discovery remains unverified

The new screenshots prove an invalid UI state: empty account identity/list, presented as “Demo account 0.00”. They do **not** reveal the upstream JSON, prove absence of a Real account, or establish a migration failure. Earlier synthetic classic-discovery fixtures did not prove compatibility with this user's OAuth token.

## Confirmed app defects corrected locally

- Credential-only sessions no longer present themselves as selected Demo accounts or actual zero balances. Actual broker-returned zero balances remain visible.
- Account retrieval, OAuth exchange, OTP and explicit account creation have bounded headers/body reads. Account reads have a 5-second deadline; diagnostic requests run in parallel with a 1.5-second deadline. Token exchange has an 8-second deadline. These are deadlines, not measured live-user timings.
- Current OAuth login and account refresh no longer wait on server classic socket failover followed by browser classic discovery. A complete Demo-only REST listing is not automatically re-polled simply because Real is absent.
- Current OAuth does not issue browser token-handoff markers; the handoff endpoint rejects OAuth even if an old marker remains. Existing classic PAT display sessions retain their separately gated historical balance reader.
- Malformed account payloads are distinct from genuine empty arrays. Canonical decimal-string balances are accepted, while null/blank/boolean/non-finite money is rejected. Diagnostics expose returned/accepted/rejected counts without raw payloads or secrets.
- Empty/partially rejected/Demo-only results check the official read-only migration status and historical mapping endpoints. These mappings never become selectable live accounts or invented balances.
- Successful authentication with no usable trading account is labelled “Signed in to Deriv”, not falsely called a failed credential exchange. Callback codes/state are removed even in that state.
- Empty identities cannot enable execution/Real acknowledgement or display another account's ledger/journal. Viewing and trading authority remain separate.

## Official contracts reviewed

- [Get accounts](https://developers.deriv.com/docs/options/get-accounts/) and [raw response schema](https://developers.deriv.com/schemas/get_accounts_response.schema.json): `data` array; account_id, account_type, currency, numeric balance.
- [OAuth](https://developers.deriv.com/docs/intro/oauth/): authorization-code + PKCE, server-side exchange.
- [Authentication](https://developers.deriv.com/docs/intro/authentication/): PAT needs Deriv-App-ID; OAuth identifies its client through the bearer.
- [Legacy APIs](https://developers.deriv.com/docs/options-legacy/): read-only historical mappings/statements, not live account/trading access.
- [Migration status](https://developers.deriv.com/docs/options-legacy/legacy-migration-status/) and its [schema](https://developers.deriv.com/schemas/legacy_migration_status_response.schema.json): top-level status, pending/complete/failed/not_applicable, all HTTP 200.
- [Legacy account schema](https://developers.deriv.com/schemas/legacy_accounts_response.schema.json): top-level loginids map, integer historical account_id and currency; **no balance**. Pending/failed mapping requests return 409; no mapping returns 404.
- [Wallet API](https://developers.deriv.com/docs/wallet/): separate product and payment scope. No new payment scope, transfers or automatic Real-account creation added.
- [Create account](https://developers.deriv.com/docs/options/create-account/): distinct explicit action. Not a workaround for recovering an existing funded account.
- [Deriv partner migration explanation](https://partners-academy.deriv.com/articles/new-deriv-api): legacy and current ecosystems differ. A missing current Options row must not be taken as proof the user's profile lacks Real funds.

## Evidence and limits

- Anonymous live REST probes: accounts/migration-status/legacy-accounts each returned expected 401 without credentials; no private account data retrieved. Legacy cloud probes timed out or failed DNS; no conclusion about all users/hosts.
- Typecheck, lint, clean Next production build passed. 488 unit/component/route tests passed.
- `tools/auth-empty-flow.mjs`: 45 synthetic empty-account browser checks and 12 current-REST Real-default/reload/switching checks at 320/360/390/1280px passed. Real server state signing, callback handling, encrypted cookies, account listing and mobile UI were exercised with an isolated test-only upstream transport. Pending migration is a fixture, **not this user's observed status**. No real consent, credentials, accounts or orders tested.
- Test transport hook is tools/auth-transport-hook.cjs, never imported by the app. Activate it only through NODE_OPTIONS in the isolated test process; never in production or publish fixture credentials as evidence of live authentication.

## Remaining blockers before a completion claim

1. Determine whether the user's actual Real account is current Options (ROT prefix), legacy Options (CR prefix), or wallet/MT5. Prefix/product name alone suffices; do not request tokens, authorization codes or passwords.
2. Inspect sanitized authenticated upstream results (status/counts/migration). No such private observation is available in this workspace.
3. Restore an authorized publication path. Git push dry-run fails because no GitHub credential is available; the GitHub connector reports unsupported. Vercel remains connected, but its existing Git-source deployment cannot include an unpushed local patch. Production remains ae37375; do not claim these local changes are deployed.

Do not replace these blockers with more synthetic success claims or another “fixed” deployment announcement.
