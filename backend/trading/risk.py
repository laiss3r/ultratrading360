"""
Central risk manager — the server-side authority on whether an order may be placed.

This mirrors the frontend's RiskManager rule for rule, so a bot moved from the browser to the
worker obeys identical limits. The manager is deliberately not advisory: `evaluate()` returns the
stake that will actually be used, clamped, and a halt flag that stops the run.

Recovery (martingale) escalation is a CLAMPED SUGGESTION. `suggest_recovery_stake` applies the cap
internally and `evaluate` re-clamps, so no multiplier can push a stake past max_stake.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import dataclasses
from datetime import datetime, timezone

from .digits import round2


@dataclass
class RiskLimits:
    max_stake: float = 10.0
    min_stake: float = 0.35
    max_open_exposure: float = 50.0
    max_session_exposure: float = 500.0
    max_trades: int = 100
    max_session_loss: float = 100.0
    max_session_profit: float = 0.0  # 0 disables the take-profit halt
    max_daily_loss: float = 250.0
    max_drawdown_pct: float = 0.25
    trading_enabled: bool = False
    real_trading_acknowledged: bool = False

    @classmethod
    def from_dict(cls, data: dict) -> "RiskLimits":
        known = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in (data or {}).items() if k in known})


@dataclass
class RecoveryConfig:
    enabled: bool = False
    multiplier: float = 1.5
    step_limit: int = 4
    max_stake: float = 25.0
    max_drawdown: float = 100.0

    @classmethod
    def from_dict(cls, data: dict) -> "RecoveryConfig":
        known = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in (data or {}).items() if k in known})


@dataclass
class RiskDecision:
    allowed: bool
    stake: float
    reasons: list[str] = field(default_factory=list)
    halt: bool = False
    halt_reason: str | None = None


@dataclass
class RiskSnapshot:
    trades_this_session: int = 0
    session_pnl: float = 0.0
    daily_pnl: float = 0.0
    daily_date: str = ""
    open_exposure: float = 0.0
    session_exposure: float = 0.0
    equity_peak: float = 0.0
    equity: float = 0.0
    consecutive_losses: int = 0
    recovery_step: int = 0
    halted: bool = False
    halt_reason: str | None = None
    halt_detail: str | None = None

    def as_dict(self) -> dict:
        return {
            "trades_this_session": self.trades_this_session,
            "session_pnl": round2(self.session_pnl),
            "daily_pnl": round2(self.daily_pnl),
            "daily_date": self.daily_date,
            "open_exposure": round2(self.open_exposure),
            "session_exposure": round2(self.session_exposure),
            "equity_peak": round2(self.equity_peak),
            "equity": round2(self.equity),
            "consecutive_losses": self.consecutive_losses,
            "recovery_step": self.recovery_step,
            "halted": self.halted,
            "halt_reason": self.halt_reason,
            "halt_detail": self.halt_detail,
        }


def _utc_day(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).astimezone(timezone.utc).date().isoformat()


class RiskManager:
    """Stateful per-session risk authority. One instance per running bot."""

    def __init__(
        self,
        limits: RiskLimits | None = None,
        recovery: RecoveryConfig | None = None,
        starting_equity: float = 0.0,
    ) -> None:
        self.limits = limits or RiskLimits()
        self.recovery = recovery or RecoveryConfig()
        self.snap = RiskSnapshot(
            daily_date=_utc_day(),
            equity=starting_equity,
            equity_peak=starting_equity,
        )

    # ------------------------------------------------------------------ state

    def get_snapshot(self) -> RiskSnapshot:
        """
        Return a COPY of the snapshot.

        Returning `self.snap` directly would let any caller mutate the manager's internal
        accounting through the object it was handed for display -- a serialized API response or a
        template could then silently alter risk state. The frontend's RiskManager has the same
        guard (`{...this.snap}`).
        """
        return dataclasses.replace(self.snap)

    def set_equity(self, equity: float) -> None:
        self.snap.equity = equity
        if equity > self.snap.equity_peak:
            self.snap.equity_peak = equity

    def open_exposure(self, stake: float) -> None:
        self.snap.open_exposure += stake
        self.snap.session_exposure += stake

    def close_exposure(self, stake: float, profit: float, now: datetime | None = None) -> None:
        self._roll_day(now)
        self.snap.open_exposure = max(0.0, self.snap.open_exposure - stake)
        self.snap.trades_this_session += 1
        self.snap.session_pnl += profit
        self.snap.daily_pnl += profit
        self.snap.equity += profit
        if self.snap.equity > self.snap.equity_peak:
            self.snap.equity_peak = self.snap.equity
        if profit < 0:
            self.snap.consecutive_losses += 1
            self.snap.recovery_step = min(self.snap.recovery_step + 1, 99)
        elif profit > 0:
            self.snap.consecutive_losses = 0
            self.snap.recovery_step = 0

    def _roll_day(self, now: datetime | None = None) -> None:
        today = _utc_day(now)
        if today != self.snap.daily_date:
            self.snap.daily_date = today
            self.snap.daily_pnl = 0.0

    def reset_session(self) -> None:
        self.snap.trades_this_session = 0
        self.snap.session_pnl = 0.0
        self.snap.open_exposure = 0.0
        self.snap.session_exposure = 0.0
        self.snap.consecutive_losses = 0
        self.snap.recovery_step = 0
        self.snap.halted = False
        self.snap.halt_reason = None
        self.snap.halt_detail = None

    def reset_all(self, starting_equity: float = 0.0) -> None:
        self.reset_session()
        self.snap.daily_pnl = 0.0
        self.snap.daily_date = _utc_day()
        self.snap.equity = starting_equity
        self.snap.equity_peak = starting_equity

    # ---------------------------------------------------------------- recovery

    def suggest_recovery_stake(self, base_stake: float) -> float:
        """Escalated stake, ALREADY clamped by both the recovery cap and the risk cap."""
        if not self.recovery.enabled or self.snap.recovery_step == 0:
            return base_stake
        step = min(self.snap.recovery_step, self.recovery.step_limit)
        raw = base_stake * (self.recovery.multiplier**step)
        return min(raw, self.recovery.max_stake, self.limits.max_stake)

    # ---------------------------------------------------------------- evaluate

    def evaluate(
        self, requested_stake: float, mode: str, now: datetime | None = None
    ) -> RiskDecision:
        """
        Decide whether an order may be placed, and at what stake.

        `mode` is one of 'simulation', 'deriv_demo', 'deriv_real'. Real money additionally
        requires an explicit acknowledgement that is re-checked on EVERY order, not once at
        startup — withdrawing the acknowledgement stops trading immediately.
        """
        self._roll_day(now)
        L = self.limits
        reasons: list[str] = []

        if not L.trading_enabled:
            return self._refuse(requested_stake, ["Trading is disabled. Enable it explicitly."], "trading_disabled")
        if mode == "deriv_real" and not L.real_trading_acknowledged:
            return self._refuse(
                requested_stake,
                ["REAL-MONEY trading is not acknowledged. Confirm the account and accept the risk first."],
                "real_not_acknowledged",
            )

        halt = False
        halt_reason: str | None = None

        if self.snap.trades_this_session >= L.max_trades:
            halt, halt_reason = True, "max_trades"
            reasons.append(f"Trade limit reached ({self.snap.trades_this_session}/{L.max_trades}).")
        if self.snap.session_pnl <= -abs(L.max_session_loss):
            halt, halt_reason = True, "session_loss"
            reasons.append(f"Session loss limit hit ({round2(self.snap.session_pnl)} <= -{L.max_session_loss}).")
        if L.max_session_profit > 0 and self.snap.session_pnl >= L.max_session_profit:
            halt, halt_reason = True, "session_target"
            reasons.append(f"Session profit target reached ({round2(self.snap.session_pnl)} >= {L.max_session_profit}).")
        if self.snap.daily_pnl <= -abs(L.max_daily_loss):
            halt, halt_reason = True, "daily_loss"
            reasons.append(f"Daily loss limit hit ({round2(self.snap.daily_pnl)} <= -{L.max_daily_loss}).")
        if L.max_drawdown_pct > 0 and self.snap.equity_peak > 0:
            dd = (self.snap.equity_peak - self.snap.equity) / self.snap.equity_peak
            if dd >= L.max_drawdown_pct:
                halt, halt_reason = True, "drawdown"
                reasons.append(f"Max drawdown hit ({dd:.1%} >= {L.max_drawdown_pct:.1%}).")
        if self.recovery.enabled and -self.snap.session_pnl >= self.recovery.max_drawdown:
            halt, halt_reason = True, "recovery_drawdown"
            reasons.append(f"Recovery max drawdown hit ({round2(-self.snap.session_pnl)} >= {self.recovery.max_drawdown}).")

        if halt:
            return self._refuse(requested_stake, reasons, halt_reason)

        # Stake clamping: recovery suggestion, then hard min/max, then exposure headroom.
        stake = self.suggest_recovery_stake(requested_stake)
        stake = min(stake, L.max_stake)
        if stake < L.min_stake:
            return self._refuse(
                stake,
                [f"Stake {round2(stake)} is below the minimum {L.min_stake}; refusing rather than silently resizing."],
                None,
            )

        headroom = L.max_open_exposure - self.snap.open_exposure
        if headroom <= 0:
            return self._refuse(stake, [f"Open exposure limit reached ({round2(self.snap.open_exposure)}/{L.max_open_exposure})."], None)
        if stake > headroom:
            reasons.append(f"Stake reduced from {round2(stake)} to {round2(headroom)} to respect the open-exposure cap.")
            stake = headroom

        session_headroom = L.max_session_exposure - self.snap.session_exposure
        if session_headroom <= 0:
            return self._refuse(stake, [f"Session exposure limit reached ({round2(self.snap.session_exposure)}/{L.max_session_exposure})."], None)
        if stake > session_headroom:
            reasons.append(f"Stake reduced to {round2(session_headroom)} to respect the session-exposure cap.")
            stake = session_headroom

        if self.snap.trades_this_session >= L.max_trades:
            return self._refuse(stake, ["Trade limit reached."], "max_trades")

        return RiskDecision(allowed=True, stake=round2(stake), reasons=reasons)

    def _refuse(self, stake: float, reasons: list[str], halt_reason: str | None) -> RiskDecision:
        self.snap.halted = halt_reason is not None
        if halt_reason:
            self.snap.halt_reason = halt_reason
            self.snap.halt_detail = " ".join(reasons)
        return RiskDecision(allowed=False, stake=0.0, reasons=reasons, halt=halt_reason is not None, halt_reason=halt_reason)
