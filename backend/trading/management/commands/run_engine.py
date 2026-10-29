"""
The worker.

Long-running process that drives active bot runs. Designed for docker-compose / a container
orchestrator, NOT for a serverless function: a bot must outlive a single HTTP request.

On startup it reclaims bots whose lease expired, which is what makes a crash or a rolling deploy
safe -- a dead worker's bot is marked stopped rather than left "running" forever (and rather than
being silently duplicated by the replacement worker).
"""

from __future__ import annotations

import logging
import os
import signal
import time

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import close_old_connections
from django.utils import timezone

from trading import engine
from trading.crypto import decrypt_secret
from trading.engine import BotExecutor, SimulationFeed
from trading.models import BotRun, RiskProfile

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Run the bot engine worker: drives active BotRuns and renews their leases."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Process one pass and exit (useful in tests and cron).")
        parser.add_argument("--tick", type=float, default=None, help="Seconds between passes.")
        parser.add_argument("--max-trades-per-pass", type=int, default=25)

    def handle(self, *args, **options):
        self.tick = options["tick"] if options["tick"] is not None else float(getattr(settings, "BOT_TICK_SECONDS", 1.0))
        self.max_per_pass = options["max_trades_per_pass"]
        self.worker_id = f"{os.getpid()}-{BotRun.new_worker_id()}"
        self._stop = False

        signal.signal(signal.SIGTERM, self._on_signal)
        signal.signal(signal.SIGINT, self._on_signal)

        reclaimed = engine.reclaim_expired(self.worker_id)
        self.stdout.write(f"worker {self.worker_id} started; reclaimed {reclaimed} expired lease(s)")

        while not self._stop:
            try:
                self._pass()
            except Exception as exc:  # noqa: BLE001 - a worker must not die on one bad bot
                logger.exception("Engine pass failed: %s", exc)
            close_old_connections()
            if options["once"]:
                break
            time.sleep(self.tick)

        self.stdout.write(f"worker {self.worker_id} stopped")

    def _on_signal(self, signum, frame):
        logger.info("Received signal %s; finishing the current pass then stopping.", signum)
        self._stop = True

    def _pass(self):
        runs = list(
            BotRun.objects.filter(status=BotRun.STATUS_RUNNING)
            .select_related("strategy", "account", "owner")
            .order_by("created_at")[: getattr(settings, "ENGINE_MAX_WORKERS", 4) * 4]
        )
        for run in runs:
            # Honour a lease held by another live worker. Only take over if it has expired.
            if run.worker_id and run.worker_id != self.worker_id:
                if run.lease_expires_at and run.lease_expires_at > timezone.now():
                    continue
            self._drive(run)

    def _drive(self, run: BotRun):
        limits, recovery = self._limits_for(run)
        feed = self._feed_for(run)
        if feed is None:
            engine.stop_bot(run, "no usable credential for this mode; stopped rather than simulated")
            return
        starting = float(run.account.balance) if run.account else 10000.0
        executor = BotExecutor(run, feed, worker_id=self.worker_id, limits=limits, recovery=recovery,
                               starting_balance=starting)
        run.worker_id = self.worker_id
        run.save(update_fields=["worker_id", "updated_at"])
        for _ in range(self.max_per_pass):
            try:
                executor.tick()
            except engine.BotNotLeased as exc:
                logger.warning("Bot %s: %s", run.id, exc)
                return
            except Exception as exc:  # noqa: BLE001
                logger.exception("Bot %s errored: %s", run.id, exc)
                BotRun.objects.filter(pk=run.pk).update(
                    status=BotRun.STATUS_ERROR, detail=str(exc)[:2000],
                    finished_at=timezone.now(), lease_expires_at=None,
                )
                return
            if executor.run.status not in (BotRun.STATUS_RUNNING, BotRun.STATUS_PAUSED):
                return

    def _limits_for(self, run: BotRun):
        profile = RiskProfile.objects.filter(owner_id=run.owner_id).first()
        if profile:
            return profile.to_limits()
        from trading.risk import RecoveryConfig, RiskLimits

        return RiskLimits(), RecoveryConfig()

    def _feed_for(self, run: BotRun):
        if run.mode == "simulation":
            return SimulationFeed(seed=f"{run.owner_id}:{run.strategy_id}:{run.strategy_version}")
        # Live modes need a decryptable credential and an authenticated socket. If either is
        # unavailable the bot is STOPPED -- it never falls back to pretending to trade.
        account = run.account
        if not account or not account.token_ciphertext:
            return None
        try:
            token = decrypt_secret(account.token_ciphertext)
        except Exception as exc:  # noqa: BLE001
            logger.error("Cannot decrypt credential for %s: %s", account.loginid, exc)
            return None
        try:
            from trading.deriv import DerivSocket, mint_socket_otp, socket_url_for

            otp = mint_socket_otp(token, account.loginid, kind=account.kind)
            sock = DerivSocket(socket_url_for(run.mode, otp))
            import asyncio

            asyncio.get_event_loop_policy().new_event_loop().run_until_complete(sock.connect())
            return engine.LiveFeed(sock, authorized=True)
        except Exception as exc:  # noqa: BLE001
            logger.error("Cannot open a trading socket for %s: %s", account.loginid, exc)
            return None
