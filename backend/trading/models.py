"""
Persistence schema.

Three properties are enforced at the DATABASE level rather than in application code, because
application-level checks do not survive a worker crash, a deploy, or two workers racing:

 1. Per-user isolation — every row carries an owner and queries are scoped through managers that
    refuse to return another user's data.
 2. No duplicate bots — a partial unique index guarantees at most one running BotRun per strategy,
    plus a lease that expires so a crashed worker's bot can be reclaimed instead of double-running.
 3. No duplicate trades — `Trade.idempotency_key` is unique, so a retried settlement cannot
    double-count a win.
"""

from __future__ import annotations

import secrets
import uuid

from django.conf import settings
from django.db import models


def _uuid() -> str:
    return uuid.uuid4().hex


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class OwnerQuerySet(models.QuerySet):
    """Scoping helper: makes "only this user's rows" the default way to query."""

    def for_user(self, user) -> "OwnerQuerySet":
        return self.filter(owner=user)


# --------------------------------------------------------------------- accounts


class DerivAccount(TimeStampedModel):
    """
    A Deriv account a user has connected, plus the encrypted credential that authorizes it.

    The token is stored ONLY as ciphertext. `token_redacted` holds a display-safe identifier so the
    UI can say which token is connected without the plaintext ever leaving the database layer.
    """

    KIND_OAUTH = "oauth"
    KIND_PAT = "pat"
    KIND_CHOICES = [(KIND_OAUTH, "OAuth 2.0"), (KIND_PAT, "Personal Access Token")]

    id = models.CharField(primary_key=True, max_length=32, default=_uuid, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="deriv_accounts")
    loginid = models.CharField(max_length=64)
    currency = models.CharField(max_length=8, default="USD")
    balance = models.DecimalField(max_digits=18, decimal_places=2, default="0.00")
    is_virtual = models.BooleanField(default=True, help_text="True for demo accounts. False means REAL MONEY.")
    kind = models.CharField(max_length=8, choices=KIND_CHOICES, default=KIND_PAT)
    scopes = models.JSONField(default=list, blank=True)

    # Encrypted at rest. Never logged, never serialized to an API response.
    token_ciphertext = models.TextField(blank=True, default="")
    token_redacted = models.CharField(max_length=64, blank=True, default="")
    expires_at = models.DateTimeField(null=True, blank=True)

    # Explicit, recorded acknowledgement for real-money trading. Storing it means "the user said
    # yes" is auditable rather than being a transient UI flag.
    real_trading_acknowledged = models.BooleanField(default=False)
    real_trading_acknowledged_at = models.DateTimeField(null=True, blank=True)
    disconnected_at = models.DateTimeField(null=True, blank=True)

    objects = OwnerQuerySet.as_manager()

    class Meta:
        unique_together = [("owner", "loginid")]
        indexes = [models.Index(fields=["owner", "loginid"])]

    def __str__(self) -> str:  # pragma: no cover - display only
        return f"{self.loginid} ({'demo' if self.is_virtual else 'REAL'})"

    @property
    def is_connected(self) -> bool:
        return self.disconnected_at is None and bool(self.token_ciphertext)

    @property
    def is_expired(self) -> bool:
        if not self.expires_at:
            return False
        from django.utils import timezone

        return self.expires_at <= timezone.now()


class RiskProfile(TimeStampedModel):
    """Per-user enforced limits. One profile per user; the engine reads it before every order."""

    id = models.CharField(primary_key=True, max_length=32, default=_uuid, editable=False)
    owner = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="risk_profile")

    max_stake = models.DecimalField(max_digits=12, decimal_places=2, default="10.00")
    min_stake = models.DecimalField(max_digits=12, decimal_places=2, default="0.35")
    max_open_exposure = models.DecimalField(max_digits=14, decimal_places=2, default="50.00")
    max_session_exposure = models.DecimalField(max_digits=14, decimal_places=2, default="500.00")
    max_trades = models.PositiveIntegerField(default=100)
    max_session_loss = models.DecimalField(max_digits=14, decimal_places=2, default="100.00")
    max_session_profit = models.DecimalField(max_digits=14, decimal_places=2, default="0.00", help_text="Take-profit halt. 0 disables.")
    max_daily_loss = models.DecimalField(max_digits=14, decimal_places=2, default="250.00")
    max_drawdown_pct = models.DecimalField(max_digits=5, decimal_places=4, default="0.25")

    trading_enabled = models.BooleanField(default=False, help_text="Master kill switch. False means no order can be placed.")

    recovery_enabled = models.BooleanField(default=False)
    recovery_multiplier = models.DecimalField(max_digits=6, decimal_places=2, default="1.5")
    recovery_step_limit = models.PositiveSmallIntegerField(default=4)
    recovery_max_stake = models.DecimalField(max_digits=12, decimal_places=2, default="25.00")
    recovery_max_drawdown = models.DecimalField(max_digits=14, decimal_places=2, default="100.00")

    def to_limits(self):
        from .risk import RecoveryConfig, RiskLimits

        return RiskLimits(
            max_stake=float(self.max_stake),
            min_stake=float(self.min_stake),
            max_open_exposure=float(self.max_open_exposure),
            max_session_exposure=float(self.max_session_exposure),
            max_trades=int(self.max_trades),
            max_session_loss=float(self.max_session_loss),
            max_session_profit=float(self.max_session_profit),
            max_daily_loss=float(self.max_daily_loss),
            max_drawdown_pct=float(self.max_drawdown_pct),
            trading_enabled=self.trading_enabled,
            real_trading_acknowledged=self.owner.deriv_accounts.filter(  # type: ignore[attr-defined]
                real_trading_acknowledged=True, disconnected_at__isnull=True
            ).exists(),
        ), RecoveryConfig(
            enabled=self.recovery_enabled,
            multiplier=float(self.recovery_multiplier),
            step_limit=int(self.recovery_step_limit),
            max_stake=float(self.recovery_max_stake),
            max_drawdown=float(self.recovery_max_drawdown),
        )


# -------------------------------------------------------------------- strategies


class Strategy(TimeStampedModel):
    """A saved, versioned trading strategy. The JSON body is the same shape the frontend uses."""

    id = models.CharField(primary_key=True, max_length=32, default=_uuid, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="strategies")
    name = models.CharField(max_length=120)
    version = models.PositiveIntegerField(default=1)
    market = models.CharField(max_length=32, default="R_100")
    contract_type = models.CharField(max_length=16, default="DIGITODD")
    barrier = models.PositiveSmallIntegerField(null=True, blank=True)
    duration = models.PositiveIntegerField(default=1)
    duration_unit = models.CharField(max_length=2, default="t")
    stake = models.DecimalField(max_digits=12, decimal_places=2, default="0.35")
    currency = models.CharField(max_length=8, default="USD")
    cooldown_seconds = models.PositiveIntegerField(default=2)
    max_trades = models.PositiveIntegerField(default=50)
    max_exposure = models.DecimalField(max_digits=14, decimal_places=2, default="100.00")
    entry = models.JSONField(default=dict, help_text="AND/OR condition tree, identical in shape to the frontend's.")
    notes = models.TextField(blank=True, default="")
    is_archived = models.BooleanField(default=False)

    objects = OwnerQuerySet.as_manager()

    class Meta:
        unique_together = [("owner", "name", "version")]
        ordering = ["-updated_at"]
        indexes = [models.Index(fields=["owner", "-updated_at"])]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.name} v{self.version}"

    def bump(self, **changes) -> "Strategy":
        """
        Create the next version as a NEW row rather than mutating this one.

        Recorded trades reference (strategy, version) exactly, so editing a strategy in place would
        silently change the meaning of historical results. Versioning keeps them attributable.
        """
        latest = Strategy.objects.filter(owner_id=self.owner_id, name=self.name).order_by("-version").first()
        base_version = (latest.version if latest else self.version) + 1
        fields = {f.name: getattr(self, f.name) for f in self._meta.concrete_fields if f.name not in {"id", "version", "created_at", "updated_at"}}
        fields.update(changes)
        return Strategy.objects.create(owner_id=self.owner_id, version=base_version, **fields)


# -------------------------------------------------------------------- bot runs


class BotRun(TimeStampedModel):
    """
    One execution of a strategy.

    `status` plus `lease_expires_at` implement the guarantee that a bot is never run twice: a
    worker holds a lease and must renew it, and a partial unique index forbids two running rows for
    the same strategy. If a worker dies mid-run the lease expires and another worker may reclaim
    the bot -- but never while a live lease exists.
    """

    STATUS_PENDING = "pending"
    STATUS_RUNNING = "running"
    STATUS_PAUSED = "paused"
    STATUS_STOPPING = "stopping"
    STATUS_STOPPED = "stopped"
    STATUS_HALTED = "halted"
    STATUS_ERROR = "error"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_RUNNING, "Running"),
        (STATUS_PAUSED, "Paused"),
        (STATUS_STOPPING, "Stopping"),
        (STATUS_STOPPED, "Stopped"),
        (STATUS_HALTED, "Halted"),
        (STATUS_ERROR, "Error"),
    ]
    ACTIVE_STATUSES = [STATUS_PENDING, STATUS_RUNNING, STATUS_PAUSED, STATUS_STOPPING]

    id = models.CharField(primary_key=True, max_length=32, default=_uuid, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bot_runs")
    strategy = models.ForeignKey(Strategy, on_delete=models.PROTECT, related_name="runs")
    strategy_version = models.PositiveIntegerField(default=1)
    account = models.ForeignKey(DerivAccount, on_delete=models.PROTECT, null=True, blank=True, related_name="runs",
                                help_text="Null for simulation runs, which need no Deriv account.")
    mode = models.CharField(max_length=16, default="simulation")
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_PENDING)
    detail = models.TextField(blank=True, default="")

    worker_id = models.CharField(max_length=64, blank=True, default="")
    lease_expires_at = models.DateTimeField(null=True, blank=True)

    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    stop_requested_at = models.DateTimeField(null=True, blank=True)

    trades_count = models.PositiveIntegerField(default=0)
    net_profit = models.DecimalField(max_digits=16, decimal_places=2, default="0.00")
    halt_reason = models.CharField(max_length=32, blank=True, default="")

    objects = OwnerQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            # At most one RUNNING bot per strategy. This is what prevents duplicate bots after a
            # page refresh or a worker restart: the second attempt fails at the database, not in a
            # check that two processes could both pass.
            models.UniqueConstraint(
                fields=["strategy"],
                # Literal, not BotRun.STATUS_RUNNING: the class is not yet defined inside its own
                # Meta, and the value must match the constant exactly.
                condition=models.Q(status="running"),
                name="one_running_bot_per_strategy",
            ),
        ]
        indexes = [
            # Lease scanning by the worker: which active runs have an expired lease.
            models.Index(fields=["status", "lease_expires_at"], name="botrun_lease_idx"),
            models.Index(fields=["owner", "status"], name="botrun_owner_status_idx"),
        ]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.strategy.name} v{self.strategy_version} [{self.status}]"

    @property
    def is_active(self) -> bool:
        return self.status in self.ACTIVE_STATUSES

    @staticmethod
    def new_worker_id() -> str:
        return f"w-{secrets.token_hex(8)}"


# ------------------------------------------------------------------------ trades


class Trade(TimeStampedModel):
    """
    A settled contract.

    `settled_at` is nullable on purpose: a row may exist the moment an order is placed, and is only
    marked settled once Deriv (or the simulator) reports the outcome. This is what prevents a
    false trade success -- an unsettled row is never counted as a win.

    `idempotency_key` is unique, so a retried settlement cannot double-count.
    """

    SOURCE_SIMULATION = "simulation"
    SOURCE_LIVE = "deriv_live"
    SOURCE_CHOICES = [(SOURCE_SIMULATION, "Simulation"), (SOURCE_LIVE, "Deriv live")]

    id = models.CharField(primary_key=True, max_length=32, default=_uuid, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="trades")
    run = models.ForeignKey(BotRun, on_delete=models.CASCADE, related_name="trades", null=True, blank=True)
    strategy = models.ForeignKey(Strategy, on_delete=models.PROTECT, related_name="trades", null=True, blank=True)
    strategy_version = models.PositiveIntegerField(default=1)

    idempotency_key = models.CharField(max_length=128, unique=True, help_text="strategy_id:version:trade_index")

    symbol = models.CharField(max_length=32)
    contract_type = models.CharField(max_length=16)
    barrier = models.CharField(max_length=8, blank=True, default="")
    stake = models.DecimalField(max_digits=12, decimal_places=2)
    payout = models.DecimalField(max_digits=12, decimal_places=2, default="0.00")
    profit = models.DecimalField(max_digits=14, decimal_places=2, default="0.00")
    won = models.BooleanField(default=False)

    mode = models.CharField(max_length=16, default="simulation")
    source = models.CharField(max_length=16, choices=SOURCE_CHOICES, default=SOURCE_SIMULATION)

    entry_digit = models.PositiveSmallIntegerField(null=True, blank=True)
    exit_digit = models.PositiveSmallIntegerField(null=True, blank=True)
    entry_price = models.DecimalField(max_digits=20, decimal_places=6, null=True, blank=True)
    exit_price = models.DecimalField(max_digits=20, decimal_places=6, null=True, blank=True)

    balance_before = models.DecimalField(max_digits=18, decimal_places=2, default="0.00")
    balance_after = models.DecimalField(max_digits=18, decimal_places=2, default="0.00")

    deriv_contract_id = models.BigIntegerField(null=True, blank=True, help_text="Deriv's own contract id, when live.")
    opened_at = models.DateTimeField(null=True, blank=True)
    settled_at = models.DateTimeField(null=True, blank=True, help_text="Null until an outcome is confirmed. Never inferred.")

    risk_reasons = models.JSONField(default=list, blank=True)
    gate_reasons = models.JSONField(default=list, blank=True)
    error = models.TextField(blank=True, default="")

    objects = OwnerQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["owner", "-created_at"]),
            models.Index(fields=["run", "-created_at"]),
            models.Index(fields=["source", "settled_at"]),
        ]

    @property
    def is_settled(self) -> bool:
        return self.settled_at is not None and not self.error

    @staticmethod
    def make_key(strategy_id: str, version: int, trade_index: int) -> str:
        return f"{strategy_id}:{version}:{trade_index}"
