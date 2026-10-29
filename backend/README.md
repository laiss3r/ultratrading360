# UltraTrading360 — backend engine

Django + DRF + Channels + Postgres + Redis. This is the **server-side** counterpart to the Next.js
frontend in the repository root.

## Why this exists

The frontend is deployed to Vercel and works completely on its own: Deriv market data, proposals,
tick streams, the simulation engine, the statistics and IndexedDB persistence all run in the
browser, with only the OAuth token exchange on a serverless route.

What Vercel's serverless functions **cannot** do is run a bot. A bot must outlive a single HTTP
request, keep a WebSocket open for minutes or hours, and survive a deploy. That needs a persistent
worker process, a real database and a message broker — which is what this stack provides.

**This backend is not deployed.** It is complete and unit-tested, ready to host.

## Layout

```
config/          settings, urls, asgi (HTTP + WebSocket), test_settings
trading/
  models.py      DerivAccount, RiskProfile, Strategy, BotRun, Trade
  crypto.py      Fernet encryption for credentials at rest (fails closed)
  digits.py      last-digit extraction + settlement (mirrors the TS implementation)
  risk.py        RiskManager — enforced limits, clamping, halts
  deriv.py       Deriv REST/WS client, token validation, OTP socket minting
  engine.py      bot lifecycle: leases, ticks, idempotent settlement
  views.py       REST API, every query scoped to request.user
  consumers.py   Channels consumers for live bot/trade events
  management/commands/run_engine.py   the worker
  tests/         162 tests
```

## Guarantees enforced at the database level

These are constraints, not application checks, because an application check does not survive two
workers racing or a crash mid-run:

| Guarantee | Mechanism |
|---|---|
| No duplicate bots | Partial unique index: at most one `running` `BotRun` per strategy |
| A dead worker's bot is reclaimed, not double-run | `lease_expires_at` + `reclaim_expired()` on worker start |
| No double-counted trade | `Trade.idempotency_key` unique (`strategy:version:index`) |
| No false trade success | `settled_at` is nullable; only an observed outcome sets it |
| Per-user isolation | Every manager query goes through `.for_user()`; no endpoint accepts an owner id |
| Credentials never in plaintext | Fernet at rest; a missing key makes the API return 503 instead of storing plaintext |
| Real money is opt-in | Per-account acknowledgement, re-checked by `RiskManager` on every order |

## Running locally

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # then fill in the secrets
export DJANGO_DB_ENGINE=sqlite DJANGO_ALLOW_INSECURE_TEST_KEY=1   # quick local trial only
python manage.py migrate
python manage.py runserver    # API
python manage.py run_engine   # worker (separate terminal)
```

## Tests

```bash
python -m pytest -q
```

162 tests. The suite is hermetic: SQLite, in-memory channel layer, and **no real Deriv calls** — the
HTTP transport is stubbed, so validation logic is exercised without ever placing an order.

Coverage: digit extraction and cross-language agreement with the frontend, settlement rules
(including strict over/under inequality), credential encryption and tamper detection, every risk
limit and halt, bot lifecycle (start/duplicate/lease expiry/stop/pause/resume), idempotent
settlement, failed orders recorded as errors rather than wins, simulation reproducibility, API
authentication, and per-user isolation on every resource.

## Docker

```bash
cp .env.example .env    # set POSTGRES_PASSWORD, DJANGO_SECRET_KEY, DERIV_TOKEN_FERNET_KEY
docker compose up --build
```

Brings up `db`, `redis`, `api` (port 8000, HTTP + WebSocket) and `worker`. Scale the worker with
`docker compose up --scale worker=3` — leases prevent two workers from running the same bot.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health/` | public; Deriv reachability + engine counters |
| POST | `/api/deriv/connect/` | validate a PAT against Deriv, encrypt, store |
| GET | `/api/deriv/accounts/` | this user's accounts, token redacted |
| POST | `/api/deriv/disconnect/` | erase ciphertext, stop dependent bots |
| POST | `/api/deriv/acknowledge-real/` | requires the exact loginid echoed back |
| GET/PUT | `/api/risk/` | enforced limits; disabling trading stops running bots |
| CRUD | `/api/strategies/` | updates create a new version, never mutate history |
| POST | `/api/strategies/{id}/run\|pause\|resume\|stop/` | bot control |
| GET | `/api/bots/`, `/api/trades/` | paginated, user-scoped |
| WS | `/ws/activity/`, `/ws/bots/{run_id}/` | live events; ownership checked before subscribing |

## What this backend does not do

- It does not implement the Signal Lab statistics. Those are pure functions over a digit series and
  already run in the browser; duplicating them in Python would create two sources of truth that can
  drift. Port them only if you need server-side analysis.
- It has no admin UI. Use `python manage.py createsuperuser` and `/admin/` if you want one
  (`django.contrib.admin` is not in `INSTALLED_APPS` by default here).
