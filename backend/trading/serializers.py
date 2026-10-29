"""API serializers. No serializer ever exposes a Deriv credential, in whole or in part."""

from __future__ import annotations

from rest_framework import serializers

from .crypto import is_encrypted
from .models import BotRun, DerivAccount, RiskProfile, Strategy, Trade


class DerivAccountSerializer(serializers.ModelSerializer):
    """Read model for a connected Deriv account. Token ciphertext is never serialized."""

    connected = serializers.BooleanField(source="is_connected", read_only=True)
    expired = serializers.BooleanField(source="is_expired", read_only=True)

    class Meta:
        model = DerivAccount
        fields = [
            "id", "loginid", "currency", "balance", "is_virtual", "kind", "scopes",
            "token_redacted", "connected", "expired", "expires_at",
            "real_trading_acknowledged", "real_trading_acknowledged_at", "disconnected_at", "created_at",
        ]
        read_only_fields = fields

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Defence in depth: even if a future field change leaked the ciphertext, strip it here.
        data.pop("token_ciphertext", None)
        if not is_encrypted(instance.token_ciphertext):
            # A row whose token is not encrypted is a bug; surface it rather than pretend it works.
            data["storage_warning"] = "credential is not stored encrypted" if instance.token_ciphertext else None
        return data


class RiskProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = RiskProfile
        exclude = ["id", "owner", "created_at", "updated_at"]

    @staticmethod
    def _num(value):
        """
        Coerce a money/ratio field to float for comparison.

        Values reach `validate` as a Decimal (from the DB), a str (a fresh instance default such as
        "0.35") or an int, and comparing those directly raises TypeError rather than reporting a
        validation error. Comparing numerically is the point of the check.
        """
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def validate(self, attrs):
        def resolve(field):
            if field in attrs:
                return self._num(attrs[field])
            return self._num(getattr(self.instance, field, None))

        min_stake, max_stake = resolve("min_stake"), resolve("max_stake")
        if min_stake is not None and max_stake is not None and min_stake > max_stake:
            raise serializers.ValidationError({"min_stake": "Minimum stake cannot exceed maximum stake."})
        mult = resolve("recovery_multiplier")
        if mult is not None and mult < 1:
            raise serializers.ValidationError({"recovery_multiplier": "Multiplier must be at least 1.0."})
        for field in ("max_stake", "min_stake", "max_session_loss", "max_daily_loss",
                      "max_open_exposure", "max_session_exposure", "recovery_max_stake",
                      "recovery_max_drawdown"):
            v = resolve(field)
            if v is not None and v < 0:
                raise serializers.ValidationError({field: "Cannot be negative."})
        drawdown = resolve("max_drawdown_pct")
        if drawdown is not None and not 0 <= drawdown <= 1:
            raise serializers.ValidationError({"max_drawdown_pct": "Must be a fraction between 0 and 1."})
        return attrs


class StrategySerializer(serializers.ModelSerializer):
    class Meta:
        model = Strategy
        fields = [
            "id", "name", "version", "market", "contract_type", "barrier", "duration", "duration_unit",
            "stake", "currency", "cooldown_seconds", "max_trades", "max_exposure", "entry", "notes",
            "is_archived", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "version", "created_at", "updated_at"]

    def validate_entry(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("entry must be an AND/OR condition group object.")
        if value.get("op") not in {"AND", "OR"}:
            raise serializers.ValidationError("entry.op must be 'AND' or 'OR'.")
        if not isinstance(value.get("children"), list) or not value["children"]:
            raise serializers.ValidationError("entry.children must be a non-empty list.")
        return value

    def validate_contract_type(self, value):
        allowed = {"DIGITODD", "DIGITEVEN", "DIGITOVER", "DIGITUNDER", "DIGITMATCH", "DIGITDIFF"}
        if value not in allowed:
            raise serializers.ValidationError(f"contract_type must be one of {sorted(allowed)}.")
        return value

    def validate(self, attrs):
        ct = attrs.get("contract_type", getattr(self.instance, "contract_type", None))
        barrier = attrs.get("barrier", getattr(self.instance, "barrier", None))
        needs_barrier = {"DIGITOVER", "DIGITUNDER", "DIGITMATCH", "DIGITDIFF"}
        if ct in needs_barrier:
            if barrier is None:
                raise serializers.ValidationError({"barrier": f"{ct} requires a barrier digit."})
            if not 0 <= int(barrier) <= 9:
                raise serializers.ValidationError({"barrier": "barrier must be 0..9."})
            if ct == "DIGITOVER" and int(barrier) == 9:
                raise serializers.ValidationError({"barrier": "DIGITOVER with barrier 9 can never win."})
            if ct == "DIGITUNDER" and int(barrier) == 0:
                raise serializers.ValidationError({"barrier": "DIGITUNDER with barrier 0 can never win."})
        stake = attrs.get("stake", getattr(self.instance, "stake", None))
        if stake is not None and float(stake) <= 0:
            raise serializers.ValidationError({"stake": "stake must be greater than zero."})
        return attrs


class TradeSerializer(serializers.ModelSerializer):
    settled = serializers.BooleanField(source="is_settled", read_only=True)

    class Meta:
        model = Trade
        fields = [
            "id", "run", "strategy", "strategy_version", "idempotency_key", "symbol", "contract_type",
            "barrier", "stake", "payout", "profit", "won", "mode", "source", "entry_digit", "exit_digit",
            "entry_price", "exit_price", "balance_before", "balance_after", "deriv_contract_id",
            "opened_at", "settled_at", "settled", "risk_reasons", "gate_reasons", "error", "created_at",
        ]
        read_only_fields = fields


class BotRunSerializer(serializers.ModelSerializer):
    strategy_name = serializers.CharField(source="strategy.name", read_only=True)
    active = serializers.BooleanField(source="is_active", read_only=True)

    class Meta:
        model = BotRun
        fields = [
            "id", "strategy", "strategy_name", "strategy_version", "account", "mode", "status", "detail",
            "active", "started_at", "finished_at", "stop_requested_at", "trades_count", "net_profit",
            "halt_reason", "created_at",
        ]
        read_only_fields = fields
