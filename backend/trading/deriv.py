"""
Deriv API client for the worker.

Two things matter here and both are enforced in code rather than assumed:

 * A credential is only accepted once Deriv itself confirms it. `validate_token` performs a real
   authorization round-trip and returns the accounts the token actually controls; a non-empty
   string is never treated as valid.
 * PAT calls require the `Deriv-App-ID` header. Omitting it makes Deriv answer 401 with
   "Deriv-App-ID header is required for PAT tokens", which looks like a bad token and is not.

The live endpoint contract (verified against api.derivws.com) is:
 * REST base           https://api.derivws.com
 * public WS           /trading/v1/options/ws/public?app_id=...   (no credential needed)
 * authenticated WS    /trading/v1/options/ws/{demo,real}?otp=...  (OTP minted via REST)
The legacy host wss://ws.derivws.com/websockets/v3 is DEAD (HTTP 520) and must not be used.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from django.conf import settings

logger = logging.getLogger(__name__)


class DerivError(Exception):
    """Base class for Deriv integration failures."""

    def __init__(self, message: str, *, code: str = "deriv_error", http_status: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.http_status = http_status


class DerivAuthError(DerivError):
    """The credential was rejected by Deriv, or is unusable for the requested operation."""


class DerivApiError(DerivError):
    """Deriv answered with a structured error payload."""


@dataclass
class AccountInfo:
    loginid: str
    currency: str
    balance: float
    is_virtual: bool
    scopes: list[str] = field(default_factory=list)
    email: str | None = None

    def as_dict(self) -> dict[str, Any]:
        # NOTE: no token material. This dict is safe to log and to return to a client.
        return {
            "loginid": self.loginid,
            "currency": self.currency,
            "balance": self.balance,
            "is_virtual": self.is_virtual,
            "scopes": self.scopes,
        }


def _http_json(url: str, *, data: dict | None = None, headers: dict | None = None, method: str | None = None, timeout: float = 20.0) -> dict:
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method or ("POST" if body else "GET"))
    req.add_header("Accept", "application/json")
    if body:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - https only
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:400]
        raise DerivError(f"Deriv returned HTTP {exc.code} for {url}: {detail}", code="http_error", http_status=exc.code) from exc
    except urllib.error.URLError as exc:
        raise DerivError(f"Could not reach Deriv at {url}: {exc.reason}", code="network_error") from exc


def api_health() -> dict:
    """Liveness probe for the Deriv REST API. Contains no secrets."""
    return _http_json(f"{settings.DERIV_API_BASE}/health", timeout=10.0)


def validate_token(token: str, *, kind: str = "pat", app_id: str | None = None) -> list[AccountInfo]:
    """
    Validate a Deriv credential with a REAL API call and return the accounts it controls.

    Never trusts the caller: an empty, whitespace-only, malformed or revoked token all raise
    DerivAuthError. This is the only path by which a credential becomes usable in this system.
    """
    if not token or not token.strip():
        raise DerivAuthError("No token supplied.", code="empty_token")
    token = token.strip()
    if len(token) < 8:
        raise DerivAuthError("That is too short to be a Deriv API token.", code="malformed_token")

    app = app_id or settings.DERIV_APP_ID
    headers = {"Authorization": f"Bearer {token}"}
    if kind == "pat":
        # Required for PAT tokens; harmless for OAuth but Deriv documents it as PAT-specific.
        headers["Deriv-App-ID"] = str(app)

    try:
        payload = _http_json(f"{settings.DERIV_API_BASE}/trading/v1/options/accounts", headers=headers)
    except DerivError as exc:
        if exc.http_status in (401, 403):
            raise DerivAuthError(
                "Deriv rejected this credential. It is invalid, expired, revoked, or lacks the "
                "scopes needed to list accounts.",
                code="invalid_token",
                http_status=exc.http_status,
            ) from exc
        raise

    accounts_raw = payload.get("accounts") or payload.get("data") or []
    if isinstance(accounts_raw, dict):
        accounts_raw = accounts_raw.get("accounts", [])
    if not accounts_raw:
        raise DerivAuthError(
            "Deriv accepted the credential but returned no accounts. Check the token's scopes.",
            code="no_accounts",
        )

    out: list[AccountInfo] = []
    for a in accounts_raw:
        loginid = str(a.get("loginid") or a.get("account_loginid") or a.get("id") or "").strip()
        if not loginid:
            continue
        out.append(
            AccountInfo(
                loginid=loginid,
                currency=str(a.get("currency") or "USD"),
                balance=float(a.get("balance") or 0),
                is_virtual=bool(a.get("is_virtual", loginid.upper().startswith("VRT"))),
                scopes=[str(s) for s in (a.get("scopes") or [])],
                email=a.get("email"),
            )
        )
    if not out:
        raise DerivAuthError("Deriv returned no usable accounts for this credential.", code="no_accounts")
    return out


def mint_socket_otp(token: str, loginid: str, *, kind: str = "pat", app_id: str | None = None) -> str:
    """
    Exchange a credential for the one-time password that opens an AUTHENTICATED socket.

    The current API does not accept a raw token on the WebSocket: you POST for an OTP over REST and
    then connect to /ws/demo or /ws/real with ?otp=. The OTP is single-use and short-lived.
    """
    app = app_id or settings.DERIV_APP_ID
    headers = {"Authorization": f"Bearer {token}"}
    if kind == "pat":
        headers["Deriv-App-ID"] = str(app)
    url = f"{settings.DERIV_API_BASE}/trading/v1/options/accounts/{urllib.parse.quote(loginid)}/otp"
    payload = _http_json(url, data={}, headers=headers, method="POST")
    otp = payload.get("otp") or (payload.get("data") or {}).get("otp")
    if not otp:
        raise DerivError(f"Deriv did not return an OTP: {json.dumps(payload)[:200]}", code="otp_missing")
    return str(otp)


def socket_url_for(mode: str, otp: str | None = None) -> str:
    """Build the correct WS URL. Public market data needs no OTP; trading does."""
    app = urllib.parse.urlencode({"app_id": settings.DERIV_APP_ID})
    if mode == "deriv_demo":
        if not otp:
            raise DerivAuthError("A demo trading socket requires an OTP.", code="otp_required")
        return f"{settings.DERIV_WS_DEMO}?{app}&otp={urllib.parse.quote(otp)}"
    if mode == "deriv_real":
        if not otp:
            raise DerivAuthError("A real trading socket requires an OTP.", code="otp_required")
        return f"{settings.DERIV_WS_REAL}?{app}&otp={urllib.parse.quote(otp)}"
    return f"{settings.DERIV_WS_PUBLIC}?{app}"


class DerivSocket:
    """
    Minimal async request/response WebSocket client with req_id correlation.

    Deliberately small: the worker needs proposals, buys and settlement updates, not a full
    reimplementation of the API surface. Reconnects with capped exponential backoff plus jitter.
    """

    def __init__(self, url: str, *, request_timeout: float = 15.0, max_reconnects: int = 5) -> None:
        self.url = url
        self.request_timeout = request_timeout
        self.max_reconnects = max_reconnects
        self._ws: Any = None
        self._req_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._reader: asyncio.Task | None = None
        self._closed = False
        self._reconnects = 0

    @property
    def is_open(self) -> bool:
        return self._ws is not None and not self._closed

    async def connect(self) -> None:
        import websockets

        self._ws = await websockets.connect(self.url, ping_interval=20, ping_timeout=20, max_queue=256)
        self._closed = False
        self._reader = asyncio.create_task(self._read_loop())

    async def _read_loop(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning("Non-JSON frame from Deriv: %.120s", raw)
                    continue
                req_id = msg.get("req_id") or (msg.get("echo_req") or {}).get("req_id")
                if req_id is not None and req_id in self._pending:
                    fut = self._pending.pop(int(req_id))
                    if not fut.done():
                        fut.set_result(msg)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - a dropped socket must fail its waiters, not hang
            logger.warning("Deriv socket read loop ended: %s", exc)
            self._fail_pending(exc)

    def _fail_pending(self, exc: Exception) -> None:
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(exc)
        self._pending.clear()

    async def send(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Send a request and await the correlated response."""
        if not self.is_open:
            raise DerivError("Socket is not open - call connect() first.", code="not_connected")
        self._req_id += 1
        req_id = self._req_id
        payload = {**payload, "req_id": req_id}
        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        self._pending[req_id] = fut
        await self._ws.send(json.dumps(payload))
        try:
            msg = await asyncio.wait_for(fut, timeout=self.request_timeout)
        except asyncio.TimeoutError:
            self._pending.pop(req_id, None)
            raise DerivError(f"Deriv request timed out: {json.dumps(payload)[:120]}", code="timeout") from None
        if msg.get("error"):
            err = msg["error"]
            raise DerivApiError(str(err.get("message", "Deriv error")), code=str(err.get("code", "deriv_error")))
        return msg

    async def close(self) -> None:
        self._closed = True
        if self._reader:
            self._reader.cancel()
        if self._ws:
            await self._ws.close()
        self._fail_pending(DerivError("Socket closed.", code="closed"))


async def fetch_history(sock: DerivSocket, symbol: str, count: int) -> list[int]:
    """
    Pull recent ticks and reduce them to last digits.

    Digits are derived with the instrument's OWN pip_size from the response, never assumed: an
    R_100 quote and a 1HZ100V quote have different pip sizes, and using the wrong one silently
    produces the wrong digit.
    """
    from .digits import last_digit

    msg = await sock.send({"ticks_history": symbol, "count": int(count), "end": "latest", "style": "ticks"})
    history = msg.get("history") or {}
    prices = history.get("prices") or []
    pip_size = int(msg.get("pip_size", 2))
    if not prices:
        raise DerivApiError(f"Deriv returned no tick history for {symbol}", code="no_history")
    return [last_digit(float(p), pip_size) for p in prices]


async def fetch_proposal(sock: DerivSocket, *, symbol: str, contract_type: str, amount: float, duration: int,
                         duration_unit: str, barrier: str | None, currency: str) -> dict:
    """Request a live proposal. The quoted payout is the ONLY honest basis for an EV calculation."""
    req: dict[str, Any] = {
        "proposal": 1,
        "underlying_symbol": symbol,   # NOT "symbol": the current API rejects that field name.
        "contract_type": contract_type,
        "amount": float(amount),
        "basis": "stake",
        "currency": currency,
        "duration": int(duration),
        "duration_unit": duration_unit,
    }
    if barrier is not None:
        req["barrier"] = str(barrier)
    msg = await sock.send(req)
    proposal = msg.get("proposal") or {}
    if not proposal:
        raise DerivApiError(f"Deriv returned no proposal: {json.dumps(msg)[:200]}", code="no_proposal")
    return proposal


async def buy_from_proposal(sock: DerivSocket, *, proposal_id: str, price: float, tolerance: float = 0.05) -> dict:
    """
    Buy using a proposal id, refusing if the price moved beyond `tolerance`.

    Buying by proposal id (rather than re-quoting at buy time) is what guarantees the price you
    verified is the price you pay.
    """
    msg = await sock.send({"buy": proposal_id, "price": float(price), "parameters": {"max_price": float(price) * (1 + tolerance)}})
    buy = msg.get("buy") or {}
    if not buy:
        raise DerivApiError(f"Deriv returned no buy confirmation: {json.dumps(msg)[:200]}", code="no_buy")
    return buy


async def watch_contract(sock: DerivSocket, contract_id: int, *, timeout: float = 60.0) -> dict:
    """
    Wait for a contract to settle via proposal_open_contract.

    Never infers an outcome from elapsed time: if settlement is not observed, this raises. A trade
    that cannot be confirmed is recorded as an error, not as a win.
    """
    deadline = time.monotonic() + timeout
    await sock.send({"proposal_open_contract": 1, "contract_id": int(contract_id)})
    while time.monotonic() < deadline:
        msg = await sock.send({"proposal_open_contract": 1, "contract_id": int(contract_id)})
        poc = msg.get("proposal_open_contract") or {}
        if poc.get("is_sold") == 1 or poc.get("status") in {"sold", "won", "lost"}:
            return poc
        await asyncio.sleep(0.5)
    raise DerivError(f"Contract {contract_id} did not settle within {timeout}s.", code="settlement_timeout")
