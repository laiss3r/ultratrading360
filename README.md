# UltraTrading360

A Deriv trading automation platform: visual strategy builder, statistical signal analysis, and a
deterministic simulation engine — with enforced risk limits on every order.

**Live:** https://ultratrading360.vercel.app

---

## What this is

Three modules over one shared engine:

| Module | What it does |
|---|---|
| **Bot Builder** (Elite Prime) | Visual AND/OR condition tree over last-digit behaviour (odd/even, over/under, match/differ, last-N, rolling frequency, consecutive runs), with market, duration, stake, cooldown and caps. Strategies are validated and **versioned** — editing creates a new version so recorded trades stay attributable to an exact definition. |
| **Overlord Pro** | Quick launch: pick a contract, stake, duration, target profit, stop loss and optional capped recovery. Market discovery ranks synthetic indices from ticks actually collected, with the methodology stated. |
| **Signal Lab** | Digit frequency with Wilson intervals, χ² goodness-of-fit, autocorrelation, Ljung-Box, runs test, transition matrix, Holm/BH/Bonferroni corrections with expected false positives, out-of-sample backtesting, and payout-aware expected value. |

Plus a dashboard, trade history with per-provenance aggregation, connect flow, and risk controls.

## The honest parts

This is a trading tool, so the things that are usually glossed over are stated plainly in the UI:

- **An anomaly is not predictive power.** A digit distribution that departs from uniform describes
  the sample you already have. It says nothing about the next tick. Signal Lab reports uncorrected
  *and* corrected p-values side by side, shows how many false positives to expect by chance, and
  splits every backtest into in-sample and out-of-sample.
- **Expected value uses the payout the broker actually quotes**, never an assumed 2×. A 90%-win-rate
  DIGITDIFF contract loses money below a 1.11× payout, and the UI says so.
- **Simulation and live results are never summed.** Every trade row carries its own `source` and
  `mode`; the two are aggregated separately.
- **Recovery (martingale) escalation is a clamped suggestion.** The multiplier cannot push a stake
  past `maxStake`, because `evaluate()` re-clamps after suggesting.
- **Trading is disabled by default.** Nothing can be placed until you turn it on, and real money
  needs a separate explicit acknowledgement that is re-checked on every order.

## Architecture

```
src/
  lib/deriv/     Deriv integration: client (req_id correlation, reconnect + subscription replay),
                 market data, contracts, auth (OAuth2 PKCE + PAT), trading (proposal -> verify -> buy)
  lib/engine/    deterministic simulator, condition language, risk manager, bot state machine
  lib/stats/     special functions, confidence intervals, hypothesis tests, multiple-testing
                 corrections, payout-aware EV, backtesting with holdout
  lib/persistence/  IndexedDB (per-browser; tokens are never written here)
  lib/oauth/     PKCE + AES-256-GCM encrypted httpOnly session
  app/api/       9 server routes — the only place a token is handled
  state/         zustand store orchestrating provider, market, strategies and bot
backend/         Django + DRF + Channels + Postgres + Redis worker engine (complete, tested,
                 not deployed — see backend/README.md)
```

### Where credentials live

The Deriv access token is held in an **AES-256-GCM encrypted `httpOnly` cookie** set by a server
route. It is never returned to the browser, never written to IndexedDB, and never logged. Browser
JavaScript cannot read it — which is why the OTP that opens an authenticated trading socket is
minted server-side by `/api/deriv/socket`.

The app **never asks for your Deriv password**. It accepts either an OAuth2 authorization code
(exchanged server-side with PKCE S256) or a Personal Access Token you paste — and a PAT is only
accepted once Deriv itself returns the accounts it controls. A non-empty token is never treated as
valid on its own strength.

## Verified Deriv API contract

Confirmed against the live API on 2026-10-29:

- **Working:** `wss://api.derivws.com/trading/v1/options/ws/public?app_id=...` — market data,
  `active_symbols`, `ticks_history`, `ticks` (subscribe), `contracts_for`, and `proposal` all work
  **unauthenticated**. Any `Origin` is accepted, so browser-side streaming works from any domain.
- **Dead:** `wss://ws.derivws.com/websockets/v3` and `wss://ws.binaryws.com` return HTTP 520. Do not
  build on them.
- **Field names:** `proposal` and `contracts_for` require `underlying_symbol`; passing `symbol`
  returns "field is not allowed". `product_type` is rejected on `active_symbols`.
- **PAT calls require the `Deriv-App-ID` header.** Omitting it yields
  `401 "Deriv-App-ID header is required for PAT tokens"`, which looks like a bad token and is not.
- **OAuth:** `POST https://auth.deriv.com/oauth2/token`, form-encoded, no client secret, PKCE
  required. Tokens have **no refresh token and no revocation endpoint** — on expiry you re-run the
  whole flow.

## OAuth setup required

Market data, proposals, ticks, simulation and the entire statistics stack work with **no
credentials**. OAuth login additionally requires a client ID that only Deriv can issue:

1. Register an application at https://developers.deriv.com/dashboard/
2. Set the redirect URI to exactly `https://ultratrading360.vercel.app/callback`
   (add `http://localhost:3000/callback` for development — matching is exact)
3. Request scopes `trade account_manage application_read`
4. In Vercel → project `ultratrading360` → Settings → Environment Variables, set
   `DERIV_OAUTH_CLIENT_ID`, `DERIV_REDIRECT_URI` and `DERIV_SESSION_SECRET`, then redeploy

Until then the Connect page reports OAuth as not configured and links to the portal, rather than
pretending the button works. **PAT login works immediately** and needs none of this.

Note: `DERIV_APP_ID=90470` is an *application identifier*. It is accepted for market data, but it is
**not** an OAuth `client_id` — Deriv answers `invalid_client` if you try to authorize with it.

## Development

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # 251 tests (vitest)
npm run typecheck    # tsc --noEmit
npm run build
```

```bash
cd backend
pip install -r requirements.txt
python -m pytest -q  # 162 tests
```

## Environment variables

See `.env.example`. Summary:

| Variable | Where | Secret? |
|---|---|---|
| `DERIV_SESSION_SECRET` | Vercel (server) | **Yes** |
| `DERIV_OAUTH_CLIENT_ID` | Vercel (server) | **Yes** |
| `DERIV_REDIRECT_URI` | Vercel (server) | No |
| `DERIV_APP_ID` | Vercel (server) | No |
| `NEXT_PUBLIC_DERIV_*` | Vercel (client) | No — endpoints and identifiers only |

## Limitations

Stated rather than hidden:

- **Persistence is per-browser.** Vercel's serverless platform cannot host Postgres, Redis or a
  worker process, so strategies and trade history live in IndexedDB. Clearing site data loses them,
  and they are not shared across devices or browsers. `backend/` implements the same schema on
  Postgres for a deployment that needs real persistence.
- **One bot at a time**, by design, so a refresh cannot start a duplicate.
- **Logout clears the cookie only.** Because Deriv offers no revocation endpoint, the credential
  itself stays valid until it expires or you revoke it at `app.deriv.com/account/api-token`. The
  Connect page says this explicitly.
- **No trading edge is claimed or implied.** This is infrastructure for testing ideas rigorously.
  Digit contracts are priced so that the theoretical EV is negative.

## Disclaimer

Trading derivatives carries a high risk of losing money rapidly. Nothing here is financial advice.
Simulated results are not a forecast of live performance.
