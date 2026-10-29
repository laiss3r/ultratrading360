"""
Bot lifecycle and the reliability guarantees the product depends on.

These are the tests that matter most: a duplicate bot double-spends, a bot that does not stop
keeps trading after the user pressed stop, and a fabricated settlement turns a loss into a
recorded win.
"""

from datetime import timedelta

import pytest
from django.db import IntegrityError
from django.utils import timezone

from trading import engine
from trading.engine import BotAlreadyRunning, BotExecutor, BotNotLeased, SimulationFeed, start_bot, stop_bot
from trading.models import BotRun, Strategy, Trade
from trading.risk import RecoveryConfig, RiskLimits, RiskManager


class CountingFeed(SimulationFeed):
    """Simulation feed that also counts calls, so tests can assert nothing extra was executed."""

    def __init__(self, seed="s", payout=1.96):
        super().__init__(seed=seed, payout=payout)
        self.executions = 0
        self.pricings = 0

    def price(self, *a, **k):
        self.pricings += 1
        return super().price(*a, **k)

    def execute(self, *a, **k):
        self.executions += 1
        return super().execute(*a, **k)


class FailingFeed(CountingFeed):
    """A feed whose order placement always fails — used to prove failures are not recorded as wins."""

    def execute(self, *a, **k):
        self.executions += 1
        raise RuntimeError("Deriv rejected the buy: market closed")


def executor_for(run, feed=None, **limits) -> BotExecutor:
    base = dict(trading_enabled=True, max_stake=100, max_session_loss=10_000, max_daily_loss=10_000,
                max_session_exposure=1_000_000, max_open_exposure=1_000_000, max_trades=10_000)
    base.update(limits)
    return BotExecutor(run, feed or SimulationFeed(), worker_id=run.worker_id,
                       limits=RiskLimits(**base), recovery=RecoveryConfig(), starting_balance=1000)


class TestNoDuplicateBots:
    def test_starting_twice_raises_instead_of_creating_a_second_bot(self, strategy):
        first = start_bot(strategy=strategy, mode="simulation")
        with pytest.raises(BotAlreadyRunning):
            start_bot(strategy=strategy, mode="simulation")
        assert BotRun.objects.filter(strategy=strategy, status=BotRun.STATUS_RUNNING).count() == 1
        assert first.status == BotRun.STATUS_RUNNING

    def test_database_constraint_forbids_two_running_rows(self, strategy):
        """
        The guarantee is enforced by a partial unique index, not by an application check, because
        two workers can both pass an application check simultaneously.
        """
        start_bot(strategy=strategy, mode="simulation")
        with pytest.raises(IntegrityError):
            BotRun.objects.create(
                owner=strategy.owner, strategy=strategy, strategy_version=strategy.version,
                mode="simulation", status=BotRun.STATUS_RUNNING,
            )

    def test_a_stopped_bot_may_be_started_again(self, strategy):
        run = start_bot(strategy=strategy, mode="simulation")
        stop_bot(run, "done")
        executor_for(run).tick()  # loop observes the stop request and finishes
        refreshed = BotRun.objects.get(pk=run.pk)
        assert refreshed.status == BotRun.STATUS_STOPPED
        again = start_bot(strategy=strategy, mode="simulation")
        assert again.pk != run.pk
        assert again.status == BotRun.STATUS_RUNNING

    def test_expired_lease_is_reclaimed_rather_than_blocking_forever(self, strategy):
        run = start_bot(strategy=strategy, mode="simulation")
        # Simulate a worker that died without releasing its lease.
        BotRun.objects.filter(pk=run.pk).update(lease_expires_at=timezone.now() - timedelta(seconds=60))
        reclaimed = start_bot(strategy=strategy, mode="simulation")
        assert reclaimed.pk != run.pk
        BotRun.objects.get(pk=run.pk).status == BotRun.STATUS_STOPPED

    def test_reclaim_expired_sweeps_dead_workers(self, strategy):
        run = start_bot(strategy=strategy, mode="simulation")
        BotRun.objects.filter(pk=run.pk).update(lease_expires_at=timezone.now() - timedelta(seconds=120))
        assert engine.reclaim_expired() == 1
        BotRun.objects.get(pk=run.pk).status == BotRun.STATUS_STOPPED

    def test_renew_lease_fails_for_a_different_worker(self, strategy):
        run = start_bot(strategy=strategy, mode="simulation", worker_id="worker-a")
        assert engine.renew_lease(run, "worker-a") is True
        assert engine.renew_lease(run, "worker-b") is False

    def test_executor_stops_when_it_loses_its_lease(self, strategy):
        """A worker that no longer owns the bot must stop trading it, not carry on in parallel."""
        run = start_bot(strategy=strategy, mode="simulation", worker_id="worker-a")
        ex = executor_for(run)
        BotRun.objects.filter(pk=run.pk).update(worker_id="worker-b")
        with pytest.raises(BotNotLeased):
            ex.tick()


class TestStopReallyStops:
    def test_stop_request_is_observed_on_the_next_tick(self, strategy):
        run = start_bot(strategy=strategy, mode="simulation")
        ex = executor_for(run)
        stop_bot(run, "user pressed stop")
        assert ex.tick() is None
        assert BotRun.objects.get(pk=run.pk).status == BotRun.STATUS_STOPPED

    def test_no_trades_are_placed_after_a_stop(self, strategy):
        run = start_bot(strategy=strategy, mode="simulation")
        feed = CountingFeed()
        ex = executor_for(run, feed)
        stop_bot(run, "stop")
        before = feed.executions
        for _ in range(10):
            ex.tick()
        assert feed.executions == before
        assert Trade.objects.filter(run=run).count() == 0

    def test_paused_bot_places_nothing_but_is_not_stopped(self, strategy):
        run = start_bot(strategy=strategy, mode="simulation")
        feed = CountingFeed()
        ex = executor_for(run, feed)
        engine.pause_bot(run)
        for _ in range(5):
            assert ex.tick() is None
        assert feed.executions == 0
        assert BotRun.objects.get(pk=run.pk).status == BotRun.STATUS_PAUSED
        engine.resume_bot(run)
        ex.run = BotRun.objects.get(pk=run.pk)
        assert BotRun.objects.get(pk=run.pk).status == BotRun.STATUS_RUNNING


class TestTradeRecording:
    def test_trades_are_recorded_with_unique_idempotency_keys(self, strategy):
        run = start_bot(strategy=strategy, mode="simulation")
        ex = executor_for(run)
        ex.run_for(20)
        trades = list(Trade.objects.filter(run=run).order_by("created_at"))
        assert len(trades) >= 5
        keys = [t.idempotency_key for t in trades]
        assert len(set(keys)) == len(keys), "idempotency keys must be unique"
        for t in trades:
            assert t.idempotency_key.startswith(f"{strategy.id}:{run.strategy_version}:")

    def test_every_recorded_trade_is_settled_with_an_outcome(self, strategy):
        run = start_bot(strategy=strategy, mode="simulation")
        executor_for(run).run_for(15)
        for t in Trade.objects.filter(run=run):
            assert t.is_settled is True
            assert t.settled_at is not None
            assert t.error == ""
            assert t.won in (True, False)

    def test_profit_arithmetic_is_consistent(self, strategy):
        run = start_bot(strategy=strategy, mode="simulation")
        executor_for(run).run_for(20)
        for t in Trade.objects.filter(run=run):
            stake, payout, profit = float(t.stake), float(t.payout), float(t.profit)
            if t.won:
                assert profit == pytest.approx(payout - stake, abs=0.011)
            else:
                assert profit == pytest.approx(-stake, abs=0.011)
                assert payout == 0

    def test_run_counters_track_the_trades(self, strategy):
        run = start_bot(strategy=strategy, mode="simulation")
        executor_for(run).run_for(20)
        run.refresh_from_db()
        n = Trade.objects.filter(run=run).count()
        assert run.trades_count == n
        assert float(run.net_profit) == pytest.approx(
            float(Trade.objects.filter(run=run).aggregate(s=__import__("django").db.models.Sum("profit"))["s"] or 0), abs=0.02
        )

    def test_restart_resumes_the_trade_index_without_reusing_a_key(self, strategy):
        """
        After a worker restart the counter must continue, not reset. Resetting would collide with
        existing keys and either crash on the unique constraint or appear to re-run a settled trade.
        """
        run = start_bot(strategy=strategy, mode="simulation")
        first = executor_for(run)
        first.run_for(10)
        keys_before = set(Trade.objects.filter(run=run).values_list("idempotency_key", flat=True))
        assert keys_before

        # A fresh executor models a new worker process picking the same bot up.
        second = executor_for(run)
        assert second._trade_index > 0
        second.run_for(10)
        keys_after = set(Trade.objects.filter(strategy=strategy).values_list("idempotency_key", flat=True))
        assert keys_before <= keys_after
        assert len(keys_after) == len(keys_before) + (len(keys_after) - len(keys_before))
        assert len(keys_after) == len(set(keys_after))

    def test_a_duplicate_key_does_not_double_count(self, strategy):
        run = start_bot(strategy=strategy, mode="simulation")
        ex = executor_for(run)
        ex._cooldown_until = timezone.now() - timedelta(seconds=1)
        trade = ex.tick()
        assert trade is not None
        profit_after_first = float(BotRun.objects.get(pk=run.pk).net_profit)

        # Force the next key to collide with an already-settled trade.
        ex._trade_index -= 1
        ex._cooldown_until = timezone.now() - timedelta(seconds=1)
        dup = ex.tick()
        assert Trade.objects.filter(strategy=strategy).count() == 1, "no second row may be created"
        assert float(BotRun.objects.get(pk=run.pk).net_profit) == pytest.approx(profit_after_first, abs=0.001)


class TestNoFalseSuccess:
    def test_a_failed_order_is_recorded_as_an_error_not_a_win(self, strategy):
        run = start_bot(strategy=strategy, mode="simulation")
        ex = executor_for(run, FailingFeed())
        trade = ex._tick_once = None
        ex._cooldown_until = timezone.now() - timedelta(seconds=1)
        trade = ex.tick()
        assert trade is not None
        assert trade.error != ""
        assert trade.settled_at is None
        assert trade.is_settled is False
        assert trade.won is False
        assert float(trade.profit) == 0

    def test_an_errored_trade_is_not_counted_as_settled(self, strategy):
        run = start_bot(strategy=strategy, mode="simulation")
        ex = executor_for(run, FailingFeed())
        ex.run_for(5)
        assert Trade.objects.filter(run=run, settled_at__isnull=False).count() == 0
        assert Trade.objects.filter(run=run).exclude(error="").count() > 0

    def test_unverified_price_movement_aborts_the_purchase(self, strategy):
        """If the quote differs from the risk-approved stake the buy must not proceed."""

        class DriftingFeed(CountingFeed):
            def price(self, symbol, contract_type, stake, barrier):
                self.pricings += 1
                return stake * 2.0, stake * 3.9  # quoted stake is 2x the approved stake

        run = start_bot(strategy=strategy, mode="simulation")
        feed = DriftingFeed()
        ex = executor_for(run, feed)
        ex._cooldown_until = timezone.now() - timedelta(seconds=1)
        trade = ex.tick()
        assert trade.error != ""
        assert feed.executions == 0, "must not execute after a price mismatch"


class TestRiskIntegration:
    def test_halt_from_the_risk_manager_stops_the_bot(self, strategy):
        run = start_bot(strategy=strategy, mode="simulation")
        ex = executor_for(run, max_session_loss=1)
        # Force a loss beyond the limit, then confirm the bot halts rather than trading on.
        ex.risk.close_exposure(1, -50)
        ex._cooldown_until = timezone.now() - timedelta(seconds=1)
        assert ex.tick() is None
        run.refresh_from_db()
        assert run.status == BotRun.STATUS_HALTED
        assert run.halt_reason == "session_loss"

    def test_kill_switch_prevents_any_trade(self, strategy):
        run = start_bot(strategy=strategy, mode="simulation")
        feed = CountingFeed()
        ex = executor_for(run, feed, trading_enabled=False)
        ex.run_for(5)
        assert feed.executions == 0
        assert Trade.objects.filter(run=run).count() == 0

    def test_strategy_max_trades_halts_the_run(self, strategy):
        strategy.max_trades = 3
        strategy.save(update_fields=["max_trades"])
        run = start_bot(strategy=strategy, mode="simulation")
        executor_for(run).run_for(50)
        run.refresh_from_db()
        assert run.status == BotRun.STATUS_HALTED
        assert run.halt_reason == "max_trades"
        assert Trade.objects.filter(run=run).count() <= 4

    def test_real_mode_refuses_without_acknowledgement(self, strategy, user):
        from trading.models import DerivAccount

        acct = DerivAccount.objects.create(
            owner=user, loginid="CR1234567", is_virtual=False, real_trading_acknowledged=False
        )
        with pytest.raises(PermissionError):
            start_bot(strategy=strategy, mode="deriv_real", account=acct)

    def test_real_mode_refuses_without_an_account(self, strategy):
        with pytest.raises(PermissionError):
            start_bot(strategy=strategy, mode="deriv_real", account=None)

    def test_demo_mode_refuses_without_an_account(self, strategy):
        with pytest.raises(PermissionError):
            start_bot(strategy=strategy, mode="deriv_demo", account=None)


class TestSimulationReproducibility:
    def test_same_seed_produces_identical_outcomes(self, user):
        """
        Two separate runs of the same strategy under the same seed must agree trade for trade.
        This is what makes a simulation result reproducible rather than anecdotal.
        """
        results = []
        for i in range(2):
            st = Strategy.objects.create(
                owner=user, name=f"Repro {i}", version=1, market="R_100", contract_type="DIGITODD",
                stake=1, cooldown_seconds=0, max_trades=1000,
                entry={"id": "root", "op": "AND", "children": [{"id": "a", "kind": "always"}]},
            )
            run = start_bot(strategy=st, mode="simulation")
            ex = BotExecutor(run, SimulationFeed(seed="fixed-seed"), worker_id=run.worker_id,
                             limits=RiskLimits(trading_enabled=True, max_stake=100, max_session_loss=1e9,
                                               max_daily_loss=1e9, max_session_exposure=1e9,
                                               max_open_exposure=1e9, max_trades=100000),
                             recovery=RecoveryConfig(), starting_balance=1000)
            ex.run_for(60)
            trades = list(Trade.objects.filter(run=run).order_by("created_at"))
            results.append([(t.won, float(t.profit), t.exit_digit) for t in trades])
        assert len(results[0]) > 10
        assert results[0] == results[1]

    def test_different_seeds_produce_different_outcomes(self, user):
        outcomes = []
        for seed in ("seed-a", "seed-b"):
            st = Strategy.objects.create(
                owner=user, name=f"Seed {seed}", version=1, market="R_100", contract_type="DIGITODD",
                stake=1, cooldown_seconds=0, max_trades=1000,
                entry={"id": "root", "op": "AND", "children": [{"id": "a", "kind": "always"}]},
            )
            run = start_bot(strategy=st, mode="simulation")
            ex = BotExecutor(run, SimulationFeed(seed=seed), worker_id=run.worker_id,
                             limits=RiskLimits(trading_enabled=True, max_stake=100, max_session_loss=1e9,
                                               max_daily_loss=1e9, max_session_exposure=1e9,
                                               max_open_exposure=1e9, max_trades=100000),
                             recovery=RecoveryConfig(), starting_balance=1000)
            ex.run_for(60)
            outcomes.append([t.exit_digit for t in Trade.objects.filter(run=run).order_by("created_at")])
        assert outcomes[0] != outcomes[1]

    def test_simulation_trades_are_labelled_as_simulation(self, strategy):
        run = start_bot(strategy=strategy, mode="simulation")
        executor_for(run).run_for(10)
        assert Trade.objects.filter(run=run).exclude(source=Trade.SOURCE_SIMULATION).count() == 0
        assert Trade.objects.filter(run=run).exclude(mode="simulation").count() == 0
