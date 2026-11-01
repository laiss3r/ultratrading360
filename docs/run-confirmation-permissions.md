# Run permission consistency

The user reported a green browser-trading switch but a “Trading is disabled” run error. The screenshots alone cannot establish the exact interleaving. Corrected potential stale-state paths and made the explicit run confirmation self-contained:

- One shared runtime permission state remains authoritative. Slow hydration cannot overwrite a newer user change, duplicate hydration is deduplicated, and settings persistence is serialized so a late older save cannot undo Stop.
- Opening a run dialog never enables trading or places an order. Its text explains that **Confirm & run** enables browser trading and requests the selected bot run.
- Confirm enables the browser permission, verifies the selected account channel (including waiting for an already in-progress connection), then calls the existing guarded runner. It never bypasses broker verification or retries a buy.
- Real-money acknowledgement is shown in the confirmation when needed and must be explicitly checked for the confirmed account. Demo does not require Real acknowledgement; its Risk page no longer shows an irrelevant grey acknowledgement switch.
- A stale “Trading is disabled” error is not displayed after the shared permission becomes enabled.
- Account changes, emergency Stop, acknowledgement revocation, pending contracts, signal qualification, payout checks and all loss/exposure limits continue to block execution when appropriate.

Unit coverage includes explicit Demo permission, Real acknowledgement refusal/approval, changed accounts, failed broker verification, Stop during connection verification, stale hydration, ordered persistence and dialog behaviour. No live broker orders are submitted by these tests.

Validation: typecheck, lint, clean production build and 498 tests passed. `tools/run-permission-flow.mjs` passed 18 browser checks with synthetic Demo and Real transport: permission initially off, explicit confirmation grants permission, account verified, run starts, Risk state agrees, reload retains permission, emergency disable works. Real without acknowledgement is refused. These are isolated fixture checks, not proof of private-account execution.
