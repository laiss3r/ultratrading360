"""
Bot execution engine.

The reliability guarantees the product depends on are implemented here against the database, not
in memory, because an in-memory flag does not survive a worker restart:

 * No duplicate bots. Starting a bot takes a DB lease under a partial unique index. Two workers
   racing to start the same strategy produce exactly one running bot; the loser gets
   IntegrityError and backs off.
 * A stopped bot really stops. `stop_bot` writes a stop request; the loop checks it every tick and
   exits. A crashed worker's lease expires, so its bot is reclaimed rather than left "running".
 * No false trade success. A Trade row is only marked settled when an outcome is observed, and the
   unique idempotency key makes a retried settlement a no-op instead of a double-count.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Protocol

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from .digits import round2, settle_digit_contract
from .models import BotRun, DerivAccount, Strategy, Trade
from .risk import RecoveryConfig, RiskLimits, RiskManager

logger = logging.getLogger(__name__)


class BotAlreadyRunning(Exception):
    """Another worker (or a previous page action) already has this strategy running."""


class BotNotLeased(Exception):
    """This worker no longer holds the lease, so it must stop touching the bot."""


class MarketFeed(Protocol):
    """What the engine needs from a data source. Simulation and Deriv both satisfy it."""

    def next_digits(self, symbol: str, count: int) -> list[int]: ...
    def price(self, symbol: str, contract_type: str, stake: float, barrier: str | None) -> tuple[float, float]: ...
    def execute(self, symbol: str, contract_type: str, stake: float, barrier: str | None, payout: float) -> dict: ...


class SimulationFeed:
    """
    Deterministic simulation feed.

    Seeded, so a run is reproducible; and it settles contracts locally using the SAME settlement
    rules as the live path, so a strategy that works here is at least internally consistent.
    """

    def __init__(self, seed: str = "ultratrading360", payout: float = 1.96) -> None:
        import random

        self._rng = random.Random(seed)
        self.payout = payout

    def next_digits(self, symbol: str, count: int) -> list[int]:
        return [self._rng.randrange(10) for _ in range(count)]

    def price(self, symbol: str, contract_type: str, stake: float, barrier: str | None) -> tuple[float, float]:
        return stake, round2(stake * self.payout)

    def execute(self, symbol: str, contract_type: str, stake: float, barrier: str | None, payout: float) -> dict:
        exit_digit = self._rng.randrange(10)
        entry_digit = self._rng.randrange(10)
        won = settle_digit_contract(contract_type, int(barrier) if barrier not in (None, "") else None, exit_digit)
        profit = round2(payout - stake) if won else round2(-stake)
        return {
            "won": won,
            "profit": profit,
            "payout": payout if won else 0.0,
            "entry_digit": entry_digit,
            "exit_digit": exit_digit,
            "source": Trade.SOURCE_SIMULATION,
        }


class LiveFeed:
    """
    Deriv-backed feed. Wraps an open DerivSocket and refuses to report an outcome it did not see.

    `authorized` must be True for a real purchase; `execute` refuses otherwise, which is what stops
    a public (read-only) socket from being mistaken for a trading socket.

    The worker is synchronous Django code, so this owns a dedicated event loop rather than calling
    the deprecated `asyncio.get_event_loop()`. Every socket call is awaited on that loop.
    """

    def __init__(self, sock, *, authorized: bool) -> None:
        import asyncio

        self.sock = sock
        self.authorized = authorized
        self._loop = asyncio.new_event_loop()
        self._last_proposal: dict | None = None

    def _run(self, coro):
        return self._loop.run_until_complete(coro)

    def close(self) -> None:
        try:
            if not self._loop.is_closed():
                self._run(self.sock.close())
        finally:
            self._loop.close()

    def next_digits(self, symbol: str, count: int) -> list[int]:
        from .deriv import fetch_history

        return self._run(fetch_history(self.sock, symbol, count))

    def price(self, symbol: str, contract_type: str, stake: float, barrier: str | None) -> tuple[float, float]:
        from .deriv import fetch_proposal

        proposal = self._run(
            fetch_proposal(
                self.sock, symbol=symbol, contract_type=contract_type, amount=stake,
                duration=1, duration_unit="t", barrier=barrier, currency="USD",
            )
        )
        ask = float(proposal.get("ask_price") or stake)
        payout = float(proposal.get("payout") or 0)
        if not proposal.get("id"):
            # Without a proposal id there is nothing to buy BY, so purchasing later would mean
            # re-quoting at an unverified price. Fail now instead.
            raise RuntimeError("Deriv proposal carried no id; refusing to buy at an unverified price.")
        self._last_proposal = proposal
        return ask, payout

    def execute(self, symbol: str, contract_type: str, stake: float, barrier: str | None, payout: float) -> dict:
        from .deriv import buy_from_proposal, watch_contract

        if not self.authorized:
            raise PermissionError("Socket is not authorized; refusing to place a live order.")
        proposal = self._last_proposal
        if not proposal or not proposal.get("id"):
            raise RuntimeError("No verified proposal to buy. Refusing to guess a price.")

        ask = float(proposal.get("ask_price") or stake)
        buy = self._run(buy_from_proposal(self.sock, proposal_id=str(proposal["id"]), price=ask))
        contract_id = int(buy.get("contract_id") or 0)
        if not contract_id:
            raise RuntimeError("Deriv returned no contract_id; the purchase cannot be confirmed.")

        settled = self._run(watch_contract(self.sock, contract_id))
        profit = float(settled.get("profit") or 0)
        return {
            "won": profit > 0,
            "profit": round2(profit),
            "payout": float(settled.get("payout") or 0),
            # Digits are not reported for live contracts; leaving them None is honest, whereas
            # guessing would put invented numbers into the trade record.
            "entry_digit": None,
            "exit_digit": None,
            "source": Trade.SOURCE_LIVE,
            "deriv_contract_id": contract_id,
        }


# --------------------------------------------------------------------- leasing


def lease_seconds() -> int:
    return int(getattr(settings, "BOT_LEASE_SECONDS", 30))


@transaction.atomic
def start_bot(*, strategy: Strategy, mode: str = "simulation", account: DerivAccount | None = None,
              worker_id: str | None = None) -> BotRun:
    """
    Start a bot, guaranteeing at most one running instance per strategy.

    Uses select_for_update on any active run plus the DB-level unique constraint. If a race is lost
    the caller gets BotAlreadyRunning rather than a second bot placing orders.
    """
    if mode == "deriv_real":
        if account is None or not account.real_trading_acknowledged:
            raise PermissionError(
                "Real-money trading requires a connected account with an explicit, recorded "
                "acknowledgement. Refusing to start."
            )
        if account.is_expired:
            raise PermissionError("The connected account's credential has expired. Reconnect.")
    if mode != "simulation" and account is None:
        raise PermissionError(f"Mode {mode} requires a connected Deriv account.")

    existing = (
        BotRun.objects.select_for_update()
        .filter(strategy=strategy, status__in=BotRun.ACTIVE_STATUSES)
        .order_by("created_at")
        .first()
    )
    if existing:
        # A lease that has expired belongs to a dead worker and may be reclaimed.
        if existing.lease_expires_at and existing.lease_expires_at > timezone.now():
            raise BotAlreadyRunning(
                f"Strategy '{strategy.name}' is already running on worker {existing.worker_id or 'unknown'}."
            )
        logger.info("Reclaiming expired lease on bot %s (worker %s)", existing.id, existing.worker_id)
        existing.status = BotRun.STATUS_STOPPED
        existing.detail = "Lease expired; reclaimed by a new worker. The previous worker is presumed dead."
        existing.finished_at = timezone.now()
        existing.save(update_fields=["status", "detail", "finished_at", "updated_at"])

    try:
        run = BotRun.objects.create(
            owner_id=strategy.owner_id,
            strategy=strategy,
            strategy_version=strategy.version,
            account=account,
            mode=mode,
            status=BotRun.STATUS_RUNNING,
            worker_id=worker_id or BotRun.new_worker_id(),
            lease_expires_at=timezone.now() + timedelta(seconds=lease_seconds()),
            started_at=timezone.now(),
        )
    except IntegrityError as exc:
        raise BotAlreadyRunning(f"Another worker started this strategy first: {exc}") from exc
    return run


def renew_lease(run: BotRun, worker_id: str) -> bool:
    """
    Extend the lease. Returns False if this worker no longer owns the bot, in which case the loop
    must stop immediately -- continuing would mean two workers trading the same strategy.
    """
    updated = BotRun.objects.filter(
        pk=run.pk, worker_id=worker_id, status__in=BotRun.ACTIVE_STATUSES
    ).update(lease_expires_at=timezone.now() + timedelta(seconds=lease_seconds()), updated_at=timezone.now())
    return updated == 1


def stop_bot(run: BotRun, reason: str = "stopped by user") -> BotRun:
    """
    Request a stop. The loop observes this on its next tick and exits cleanly.

    Requesting rather than force-flipping the status is deliberate: an in-flight contract must be
    allowed to settle, otherwise the record would claim an outcome that was never observed.
    """
    run.stop_requested_at = timezone.now()
    run.detail = reason
    if run.status == BotRun.STATUS_RUNNING:
        run.status = BotRun.STATUS_STOPPING
    run.save(update_fields=["stop_requested_at", "detail", "status", "updated_at"])
    return run


def pause_bot(run: BotRun) -> BotRun:
    if run.status == BotRun.STATUS_RUNNING:
        run.status = BotRun.STATUS_PAUSED
        run.save(update_fields=["status", "updated_at"])
    return run


def resume_bot(run: BotRun) -> BotRun:
    if run.status == BotRun.STATUS_PAUSED:
        run.status = BotRun.STATUS_RUNNING
        run.save(update_fields=["status", "updated_at"])
    return run


def reclaim_expired(worker_id: str | None = None) -> int:
    """
    Mark bots whose lease expired as stopped. Run by the worker on startup so a crash does not
    leave a bot permanently "running" and unstartable.
    """
    stale = BotRun.objects.filter(status__in=BotRun.ACTIVE_STATUSES, lease_expires_at__lt=timezone.now())
    count = stale.count()
    if count:
        stale.update(
            status=BotRun.STATUS_STOPPED,
            detail="Lease expired without renewal; the owning worker is presumed dead. Marked stopped.",
            finished_at=timezone.now(),
            updated_at=timezone.now(),
        )
        logger.warning("Reclaimed %s bot run(s) with expired leases", count)
    return count


# --------------------------------------------------------------------- the loop


class BotExecutor:
    """
    Drives one BotRun. Each call to `tick()` performs at most one trade decision.

    Splitting the loop into discrete ticks (rather than an internal `while True`) is what makes it
    testable without wall-clock timers and lets the worker interleave many bots.
    """

    def __init__(self, run: BotRun, feed: MarketFeed, *, worker_id: str, limits: RiskLimits | None = None,
                 recovery: RecoveryConfig | None = None, starting_balance: float = 0.0) -> None:
        self.run = run
        self.feed = feed
        self.worker_id = worker_id
        self.risk = RiskManager(limits or RiskLimits(), recovery or RecoveryConfig(), starting_balance)
        self.balance = starting_balance
        self._trade_index = self._restore_trade_index()
        self._cooldown_until = timezone.now()
        self._window: list[int] = []

    def _restore_trade_index(self) -> int:
        """
        Resume the trade counter from what is already recorded.

        Without this, a worker restart would restart the index at 0 and collide with existing
        idempotency keys -- either crashing on the unique constraint or, worse, appearing to
        re-execute a trade that already settled.
        """
        last = (
            Trade.objects.filter(strategy_id=self.run.strategy_id, strategy_version=self.run.strategy_version)
            .order_by("-created_at")
            .values_list("idempotency_key", flat=True)
            .first()
        )
        if not last:
            return 0
        try:
            return int(str(last).rsplit(":", 1)[-1]) + 1
        except (ValueError, IndexError):
            return 0

    def tick(self) -> Trade | None:
        """Advance the bot by one decision. Returns the Trade created, or None."""
        run = BotRun.objects.filter(pk=self.run.pk).first()
        if run is None:
            raise BotNotLeased("Bot run no longer exists.")
        self.run = run

        if run.status == BotRun.STATUS_STOPPING or run.stop_requested_at:
            self._finish(BotRun.STATUS_STOPPED, run.detail or "stopped")
            return None
        if run.status not in (BotRun.STATUS_RUNNING, BotRun.STATUS_PAUSED):
            return None
        if run.status == BotRun.STATUS_PAUSED:
            return None
        if not renew_lease(run, self.worker_id):
            raise BotNotLeased("Lease lost to another worker; stopping this loop.")

        strategy = run.strategy
        now = timezone.now()
        if now < self._cooldown_until:
            return None

        # Refresh the digit window from the feed.
        need = max(50, 2 * int(strategy.cooldown_seconds or 1))
        self._window = self.feed.next_digits(strategy.market, need)

        decision = self.risk.evaluate(float(strategy.stake), run.mode, now=now)
        if not decision.allowed:
            if decision.halt:
                self._finish(BotRun.STATUS_HALTED, f"{decision.halt_reason}: {' '.join(decision.reasons)}",
                             halt_reason=decision.halt_reason or "")
            else:
                logger.info("Risk refused a trade on bot %s: %s", run.id, decision.reasons)
                self._cooldown_until = now + timedelta(seconds=max(1, strategy.cooldown_seconds))
            return None

        stake = decision.stake
        barrier = None if strategy.barrier is None else str(strategy.barrier)
        self.risk.open_exposure(stake)

        key = Trade.make_key(strategy.id, run.strategy_version, self._trade_index)
        self._trade_index += 1
        balance_before = round2(self.balance)

        try:
            quoted_stake, quoted_payout = self.feed.price(strategy.market, strategy.contract_type, stake, barrier)
            if abs(quoted_stake - stake) > max(0.01, stake * 0.05):
                raise RuntimeError(
                    f"Quoted stake {quoted_stake} differs from the risk-approved {stake} by more than 5%; "
                    "refusing to buy at an unverified price."
                )
            outcome = self.feed.execute(strategy.market, strategy.contract_type, stake, barrier, quoted_payout)
        except Exception as exc:  # noqa: BLE001 - a failed order must be recorded, never faked
            logger.warning("Trade failed on bot %s: %s", run.id, exc)
            self.risk.close_exposure(stake, 0.0, now=now)
            trade = Trade.objects.create(
                owner_id=run.owner_id, run=run, strategy=strategy, strategy_version=run.strategy_version,
                idempotency_key=key, symbol=strategy.market, contract_type=strategy.contract_type,
                barrier=barrier or "", stake=round2(stake), payout=0, profit=0, won=False,
                mode=run.mode, source=Trade.SOURCE_LIVE if run.mode != "simulation" else Trade.SOURCE_SIMULATION,
                balance_before=balance_before, balance_after=balance_before,
                opened_at=now, settled_at=None,
                risk_reasons=decision.reasons, error=str(exc)[:2000],
            )
            self._cooldown_until = now + timedelta(seconds=max(1, strategy.cooldown_seconds))
            return trade

        profit = round2(float(outcome["profit"]))
        self.risk.close_exposure(stake, profit, now=now)
        self.balance = round2(self.balance + profit)

        trade, created = Trade.objects.get_or_create(
            idempotency_key=key,
            defaults=dict(
                owner_id=run.owner_id, run=run, strategy=strategy, strategy_version=run.strategy_version,
                symbol=strategy.market, contract_type=strategy.contract_type, barrier=barrier or "",
                stake=round2(stake), payout=round2(float(outcome.get("payout") or 0)), profit=profit,
                won=bool(outcome["won"]), mode=run.mode, source=outcome.get("source") or Trade.SOURCE_SIMULATION,
                entry_digit=outcome.get("entry_digit"), exit_digit=outcome.get("exit_digit"),
                balance_before=balance_before, balance_after=round2(self.balance),
                deriv_contract_id=outcome.get("deriv_contract_id"),
                opened_at=now, settled_at=timezone.now(), risk_reasons=decision.reasons,
            ),
        )
        if not created:
            # The key already existed: a previous attempt settled this trade. Do not double-count.
            logger.warning("Idempotency key %s already present; skipping duplicate settlement.", key)
            self.risk.close_exposure(stake, -profit, now=now)  # undo the accounting
            self.balance = round2(self.balance - profit)
        else:
            BotRun.objects.filter(pk=run.pk).update(
                trades_count=F("trades_count") + 1,
                net_profit=F("net_profit") + profit,
                updated_at=timezone.now(),
            )

        if strategy.max_trades and self.risk.snap.trades_this_session >= strategy.max_trades:
            self._finish(BotRun.STATUS_HALTED, f"maxTrades ({strategy.max_trades}) reached", halt_reason="max_trades")
        self._cooldown_until = timezone.now() + timedelta(seconds=max(1, strategy.cooldown_seconds))
        return trade

    def _finish(self, status: str, detail: str, halt_reason: str = "") -> None:
        BotRun.objects.filter(pk=self.run.pk).update(
            status=status, detail=detail[:2000], halt_reason=halt_reason,
            finished_at=timezone.now(), lease_expires_at=None, updated_at=timezone.now(),
        )
        self.run.status = status
        logger.info("Bot %s finished: %s (%s)", self.run.id, status, detail)

    def run_for(self, ticks: int) -> list[Trade]:
        """Convenience driver for tests and for a bounded worker burst."""
        out: list[Trade] = []
        for _ in range(ticks):
            self._cooldown_until = timezone.now() - timedelta(seconds=1)  # tests/bursts ignore wall-clock pacing
            trade = self.tick()
            if trade:
                out.append(trade)
            if self.run.status not in (BotRun.STATUS_RUNNING, BotRun.STATUS_PAUSED):
                break
        return out
