"""Risk manager — the enforced authority on whether an order may be placed."""

from datetime import datetime, timedelta, timezone

import pytest

from trading.risk import RecoveryConfig, RiskLimits, RiskManager


def mgr(**over) -> RiskManager:
    """A permissive baseline manager so each test can tighten exactly one limit."""
    base = dict(
        trading_enabled=True, max_stake=100, min_stake=0.35,
        max_session_loss=10_000, max_daily_loss=10_000, max_session_profit=0,
        max_session_exposure=1_000_000, max_open_exposure=1_000_000,
        max_trades=10_000, max_drawdown_pct=0.25, real_trading_acknowledged=False,
    )
    base.update(over)
    return RiskManager(RiskLimits(**base), RecoveryConfig(), starting_equity=1000)


class TestKillSwitches:
    def test_trading_disabled_refuses_everything(self):
        m = RiskManager(RiskLimits(trading_enabled=False), RecoveryConfig())
        d = m.evaluate(1, "simulation")
        assert d.allowed is False and d.halt is True
        assert d.halt_reason == "trading_disabled"
        assert d.stake == 0

    def test_trading_disabled_by_default(self):
        """The default posture is closed: a fresh profile cannot trade."""
        assert RiskLimits().trading_enabled is False
        assert RiskManager().evaluate(1, "simulation").allowed is False

    def test_real_money_requires_acknowledgement(self):
        m = mgr(real_trading_acknowledged=False)
        d = m.evaluate(1, "deriv_real")
        assert d.allowed is False and d.halt is True
        assert d.halt_reason == "real_not_acknowledged"

    def test_real_money_allowed_once_acknowledged(self):
        assert mgr(real_trading_acknowledged=True).evaluate(1, "deriv_real").allowed is True

    def test_demo_and_simulation_do_not_need_real_acknowledgement(self):
        m = mgr(real_trading_acknowledged=False)
        assert m.evaluate(1, "deriv_demo").allowed is True
        assert m.evaluate(1, "simulation").allowed is True

    def test_acknowledgement_is_rechecked_on_every_order(self):
        """Withdrawing consent mid-session must stop the very next order, not the next restart."""
        m = mgr(real_trading_acknowledged=True)
        assert m.evaluate(1, "deriv_real").allowed is True
        m.limits.real_trading_acknowledged = False
        assert m.evaluate(1, "deriv_real").allowed is False


class TestStakeClamping:
    def test_stake_is_clamped_to_max(self):
        m = mgr(max_stake=5)
        d = m.evaluate(500, "simulation")
        assert d.allowed is True
        assert d.stake == 5

    def test_stake_below_minimum_is_refused_not_silently_raised(self):
        m = mgr(min_stake=1)
        d = m.evaluate(0.10, "simulation")
        assert d.allowed is False
        assert "below the minimum" in " ".join(d.reasons)

    def test_open_exposure_caps_the_stake(self):
        m = mgr(max_open_exposure=10)
        m.open_exposure(8)
        d = m.evaluate(5, "simulation")
        assert d.allowed is True
        assert d.stake == 2  # only the remaining headroom

    def test_open_exposure_exhausted_refuses(self):
        m = mgr(max_open_exposure=10)
        m.open_exposure(10)
        assert m.evaluate(1, "simulation").allowed is False

    def test_session_exposure_caps_the_stake(self):
        m = mgr(max_session_exposure=10)
        m.open_exposure(7)
        d = m.evaluate(6, "simulation")
        assert d.allowed is True
        assert d.stake == 3


class TestSessionLimits:
    def test_max_trades_halts(self):
        m = mgr(max_trades=2)
        assert m.evaluate(1, "simulation").allowed is True
        m.close_exposure(1, 0.5)
        m.close_exposure(1, 0.5)
        d = m.evaluate(1, "simulation")
        assert d.allowed is False and d.halt is True and d.halt_reason == "max_trades"

    def test_session_loss_halts(self):
        m = mgr(max_session_loss=10)
        m.close_exposure(1, -11)
        d = m.evaluate(1, "simulation")
        assert d.halt is True and d.halt_reason == "session_loss"

    def test_take_profit_halts_when_set(self):
        m = mgr(max_session_profit=20)
        m.close_exposure(1, 21)
        d = m.evaluate(1, "simulation")
        assert d.halt is True and d.halt_reason == "session_target"

    def test_take_profit_disabled_at_zero(self):
        m = mgr(max_session_profit=0)
        m.close_exposure(1, 5000)
        assert m.evaluate(1, "simulation").allowed is True

    def test_daily_loss_halts(self):
        m = mgr(max_daily_loss=5)
        m.close_exposure(1, -6)
        assert m.evaluate(1, "simulation").halt_reason == "daily_loss"

    def test_drawdown_halts(self):
        m = mgr(max_drawdown_pct=0.10)
        m.set_equity(1000)
        m.close_exposure(1, -150)  # equity 850, peak 1000 => 15% drawdown
        d = m.evaluate(1, "simulation")
        assert d.halt is True and d.halt_reason == "drawdown"

    def test_drawdown_check_disabled_at_zero(self):
        m = mgr(max_drawdown_pct=0)
        m.close_exposure(1, -900)
        assert m.evaluate(1, "simulation").halt_reason != "drawdown"


class TestRecovery:
    def test_disabled_returns_base_stake(self):
        m = RiskManager(RiskLimits(trading_enabled=True, max_stake=100), RecoveryConfig(enabled=False))
        m.close_exposure(1, -1)
        assert m.suggest_recovery_stake(2) == 2

    def test_escalates_by_multiplier(self):
        m = RiskManager(RiskLimits(trading_enabled=True, max_stake=1000),
                        RecoveryConfig(enabled=True, multiplier=2.0, step_limit=5, max_stake=1000))
        m.close_exposure(1, -1)
        assert m.suggest_recovery_stake(1) == 2      # step 1
        m.close_exposure(1, -1)
        assert m.suggest_recovery_stake(1) == 4      # step 2

    def test_escalation_is_clamped_by_the_step_limit(self):
        m = RiskManager(RiskLimits(trading_enabled=True, max_stake=1_000_000),
                        RecoveryConfig(enabled=True, multiplier=2.0, step_limit=3, max_stake=1_000_000))
        for _ in range(20):
            m.close_exposure(1, -1)
        assert m.suggest_recovery_stake(1) == 8  # 2^3, not 2^20

    def test_escalation_can_never_exceed_max_stake(self):
        """The multiplier is a suggestion; the cap is the law."""
        m = RiskManager(RiskLimits(trading_enabled=True, max_stake=10),
                        RecoveryConfig(enabled=True, multiplier=10.0, step_limit=10, max_stake=10_000))
        for _ in range(6):
            m.close_exposure(1, -1)
        d = m.evaluate(1, "simulation")
        assert d.allowed is True
        assert d.stake <= 10

    def test_recovery_max_drawdown_halts(self):
        m = RiskManager(
            RiskLimits(trading_enabled=True, max_stake=100, max_session_loss=10_000, max_daily_loss=10_000),
            RecoveryConfig(enabled=True, multiplier=1.5, step_limit=4, max_stake=25, max_drawdown=50),
        )
        m.close_exposure(1, -60)
        d = m.evaluate(1, "simulation")
        assert d.halt is True and d.halt_reason == "recovery_drawdown"

    def test_a_win_resets_the_recovery_step(self):
        m = RiskManager(RiskLimits(trading_enabled=True, max_stake=1000),
                        RecoveryConfig(enabled=True, multiplier=2.0, step_limit=5, max_stake=1000))
        m.close_exposure(1, -1)
        m.close_exposure(1, -1)
        assert m.get_snapshot().recovery_step == 2
        m.close_exposure(1, 5)
        assert m.get_snapshot().recovery_step == 0


class TestHaltReporting:
    def test_halt_is_surfaced_in_the_snapshot_with_a_reason(self):
        m = mgr(max_session_loss=5)
        m.close_exposure(1, -10)
        m.evaluate(1, "simulation")
        snap = m.get_snapshot()
        assert snap.halted is True
        assert snap.halt_reason == "session_loss"
        assert "Session loss limit" in (snap.halt_detail or "")

    def test_reset_session_clears_the_halt(self):
        m = mgr(max_session_loss=5)
        m.close_exposure(1, -10)
        m.evaluate(1, "simulation")
        assert m.get_snapshot().halted is True
        m.reset_session()
        assert m.get_snapshot().halted is False
        assert m.evaluate(1, "simulation").allowed is True

    def test_snapshot_is_a_copy(self):
        m = mgr()
        snap = m.get_snapshot()
        snap.session_pnl = 999
        assert m.get_snapshot().session_pnl == 0


class TestDailyRollover:
    def test_daily_counter_resets_at_utc_midnight(self):
        m = mgr(max_daily_loss=10)
        day1 = datetime(2026, 1, 1, 23, 0, tzinfo=timezone.utc)
        m.close_exposure(1, -5, now=day1)
        assert m.get_snapshot().daily_pnl == -5
        day2 = day1 + timedelta(hours=2)  # crosses UTC midnight
        m.close_exposure(1, -5, now=day2)
        # The first day's loss must not carry into the new UTC day.
        assert m.get_snapshot().daily_pnl == -5
        assert m.evaluate(1, "simulation", now=day2).allowed is True

    def test_serializable_snapshot(self):
        d = mgr().get_snapshot().as_dict()
        assert set(d) >= {"trades_this_session", "session_pnl", "halted", "recovery_step"}
        import json

        json.dumps(d)  # must be JSON-safe for an API response
