"""
REST API.

Every query is scoped to `request.user`. There is no endpoint that accepts an owner id from the
client, because that is how per-user isolation gets broken: a single unscoped lookup is enough to
read or trade someone else's account.
"""

from __future__ import annotations

import logging

from django.db import IntegrityError
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import engine
from .crypto import EncryptionNotConfigured, decrypt_secret, encrypt_secret, redact
from .deriv import DerivAuthError, DerivError, api_health, validate_token
from .models import BotRun, DerivAccount, RiskProfile, Strategy, Trade
from .serializers import (
    BotRunSerializer, DerivAccountSerializer, RiskProfileSerializer,
    StrategySerializer, TradeSerializer,
)

logger = logging.getLogger(__name__)


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    """Liveness plus Deriv reachability. Returns no secrets and requires no authentication."""
    deriv = {"ok": False, "detail": "not probed"}
    try:
        deriv = {"ok": True, **api_health()}
    except DerivError as exc:
        deriv = {"ok": False, "detail": exc.message, "code": exc.code}
    except Exception as exc:  # noqa: BLE001 - a probe must never take the service down
        deriv = {"ok": False, "detail": str(exc)[:200]}
    return Response({
        "service": "ultratrading360-backend",
        "time": timezone.now().isoformat(),
        "deriv_api": deriv,
        "engine": {
            "active_bots": BotRun.objects.filter(status__in=BotRun.ACTIVE_STATUSES).count(),
            "stale_leases": BotRun.objects.filter(
                status__in=BotRun.ACTIVE_STATUSES, lease_expires_at__lt=timezone.now()
            ).count(),
        },
    })


class DerivConnectView(APIView):
    """
    Connect a Deriv Personal Access Token.

    The token is validated by a REAL call to Deriv before anything is stored, then encrypted. A
    non-empty token is never accepted on its own strength.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        token = (request.data.get("token") or "").strip()
        if not token:
            return Response({"detail": "No token supplied."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            accounts = validate_token(token, kind="pat")
        except DerivAuthError as exc:
            logger.info("PAT validation rejected: %s", exc.code)
            return Response({"detail": exc.message, "code": exc.code}, status=status.HTTP_401_UNAUTHORIZED)
        except DerivError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=status.HTTP_502_BAD_GATEWAY)

        try:
            ciphertext = encrypt_secret(token)
        except EncryptionNotConfigured as exc:
            # Fail closed: never persist a trading credential in plaintext.
            logger.error("Refusing to store Deriv token: %s", exc)
            return Response({"detail": str(exc), "code": "encryption_not_configured"},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)

        saved = []
        for a in accounts:
            obj, _ = DerivAccount.objects.update_or_create(
                owner=request.user, loginid=a.loginid,
                defaults={
                    "currency": a.currency, "balance": a.balance, "is_virtual": a.is_virtual,
                    "kind": "pat", "scopes": a.scopes, "token_ciphertext": ciphertext,
                    "token_redacted": redact(token), "disconnected_at": None,
                },
            )
            saved.append(obj)
        return Response(DerivAccountSerializer(saved, many=True).data, status=status.HTTP_201_CREATED)


class DerivAccountsView(APIView):
    """List this user's connected accounts. Never returns token material."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        accounts = DerivAccount.objects.for_user(request.user).order_by("loginid")
        return Response(DerivAccountSerializer(accounts, many=True).data)


class DerivDisconnectView(APIView):
    """
    Disconnect. Erases the ciphertext rather than merely flagging the row.

    Deriv's OAuth tokens have no revocation endpoint, so clearing our copy does not invalidate the
    credential at Deriv; the response says so instead of implying a revocation we cannot perform.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        loginid = (request.data.get("loginid") or "").strip()
        qs = DerivAccount.objects.for_user(request.user)
        if loginid:
            qs = qs.filter(loginid=loginid)
        count = qs.count()
        # Stop any bot that depended on this credential first.
        for run in BotRun.objects.filter(account__in=qs, status__in=BotRun.ACTIVE_STATUSES):
            engine.stop_bot(run, "account disconnected")
        qs.update(token_ciphertext="", token_redacted="", disconnected_at=timezone.now())
        return Response({
            "disconnected": count,
            "note": (
                "The stored credential was erased from this server. Deriv offers no revocation "
                "endpoint for OAuth tokens, so revoke an API token at app.deriv.com/account/api-token "
                "if you want it invalidated at the source."
            ),
        })


class AcknowledgeRealTradingView(APIView):
    """
    Record an explicit real-money acknowledgement for a specific account.

    Stored per-account and timestamped so the consent is auditable, and required by the engine
    before any real order. Withdrawing it stops running real bots immediately.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        account = DerivAccount.objects.for_user(request.user).filter(id=request.data.get("id")).first()
        if not account:
            return Response({"detail": "Account not found."}, status=status.HTTP_404_NOT_FOUND)
        acknowledge = bool(request.data.get("acknowledge", True))
        if acknowledge and account.is_virtual:
            return Response({"detail": "This is a demo account; real-money acknowledgement does not apply."},
                            status=status.HTTP_400_BAD_REQUEST)
        if acknowledge and request.data.get("confirm_loginid") != account.loginid:
            return Response(
                {"detail": f"Confirm the exact loginid '{account.loginid}' to acknowledge real-money trading."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        account.real_trading_acknowledged = acknowledge
        account.real_trading_acknowledged_at = timezone.now() if acknowledge else None
        account.save(update_fields=["real_trading_acknowledged", "real_trading_acknowledged_at", "updated_at"])
        if not acknowledge:
            for run in BotRun.objects.filter(account=account, status__in=BotRun.ACTIVE_STATUSES, mode="deriv_real"):
                engine.stop_bot(run, "real-money acknowledgement withdrawn")
        return Response(DerivAccountSerializer(account).data)


class RiskProfileView(APIView):
    """Read and update this user's enforced risk limits."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile, _ = RiskProfile.objects.get_or_create(owner=request.user)
        return Response(RiskProfileSerializer(profile).data)

    def put(self, request):
        profile, _ = RiskProfile.objects.get_or_create(owner=request.user)
        serializer = RiskProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        was_enabled = profile.trading_enabled
        profile = serializer.save()
        if was_enabled and not profile.trading_enabled:
            # Engaging the kill switch must actually stop running bots, not just block new ones.
            for run in BotRun.objects.for_user(request.user).filter(status__in=BotRun.ACTIVE_STATUSES):
                engine.stop_bot(run, "trading disabled by kill switch")
        return Response(RiskProfileSerializer(profile).data)


class StrategyViewSet(viewsets.ModelViewSet):
    """CRUD over strategies, scoped to the requesting user, with version-preserving updates."""

    serializer_class = StrategySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Strategy.objects.for_user(self.request.user).filter(is_archived=False)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user, version=1)

    def perform_update(self, serializer):
        # Editing creates a NEW version instead of mutating history that trades already reference.
        instance = serializer.instance
        changes = serializer.validated_data
        latest = instance.bump(**changes)
        serializer.instance = latest

    def perform_destroy(self, instance):
        for run in BotRun.objects.filter(strategy=instance, status__in=BotRun.ACTIVE_STATUSES):
            engine.stop_bot(run, "strategy deleted")
        instance.is_archived = True
        instance.save(update_fields=["is_archived", "updated_at"])

    # ------------------------------------------------------------------ control

    @action(detail=True, methods=["post"])
    def run(self, request, pk=None):
        strategy = self.get_object()
        mode = request.data.get("mode", "simulation")
        if mode not in {"simulation", "deriv_demo", "deriv_real"}:
            return Response({"detail": f"Unknown mode '{mode}'."}, status=status.HTTP_400_BAD_REQUEST)

        profile, _ = RiskProfile.objects.get_or_create(owner=request.user)
        if not profile.trading_enabled:
            return Response(
                {"detail": "Trading is disabled by the kill switch. Enable it before starting a bot.",
                 "code": "trading_disabled"},
                status=status.HTTP_409_CONFLICT,
            )

        account = None
        if mode != "simulation":
            want_virtual = mode == "deriv_demo"
            account = (
                DerivAccount.objects.for_user(request.user)
                .filter(is_virtual=want_virtual, disconnected_at__isnull=True)
                .order_by("loginid")
                .first()
            )
            if not account:
                return Response(
                    {"detail": f"No connected {'demo' if want_virtual else 'real'} Deriv account for mode {mode}."},
                    status=status.HTTP_409_CONFLICT,
                )
            if account.is_expired:
                return Response({"detail": "The stored credential has expired. Reconnect."},
                                status=status.HTTP_409_CONFLICT)
            if mode == "deriv_real" and not account.real_trading_acknowledged:
                return Response(
                    {"detail": "Real-money trading is not acknowledged for this account.",
                     "code": "real_not_acknowledged"},
                    status=status.HTTP_403_FORBIDDEN,
                )

        try:
            run = engine.start_bot(strategy=strategy, mode=mode, account=account)
        except engine.BotAlreadyRunning as exc:
            return Response({"detail": str(exc), "code": "already_running"}, status=status.HTTP_409_CONFLICT)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        return Response(BotRunSerializer(run).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def stop(self, request, pk=None):
        strategy = self.get_object()
        runs = BotRun.objects.filter(strategy=strategy, status__in=BotRun.ACTIVE_STATUSES)
        if not runs.exists():
            return Response({"detail": "No active bot for this strategy."}, status=status.HTTP_409_CONFLICT)
        for run in runs:
            engine.stop_bot(run, request.data.get("reason") or "stopped via API")
        return Response(BotRunSerializer(runs.first()).data)

    @action(detail=True, methods=["post"])
    def pause(self, request, pk=None):
        strategy = self.get_object()
        run = BotRun.objects.filter(strategy=strategy, status=BotRun.STATUS_RUNNING).first()
        if not run:
            return Response({"detail": "No running bot to pause."}, status=status.HTTP_409_CONFLICT)
        return Response(BotRunSerializer(engine.pause_bot(run)).data)

    @action(detail=True, methods=["post"])
    def resume(self, request, pk=None):
        strategy = self.get_object()
        run = BotRun.objects.filter(strategy=strategy, status=BotRun.STATUS_PAUSED).first()
        if not run:
            return Response({"detail": "No paused bot to resume."}, status=status.HTTP_409_CONFLICT)
        return Response(BotRunSerializer(engine.resume_bot(run)).data)


class BotRunViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = BotRunSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = BotRun.objects.for_user(self.request.user).select_related("strategy", "account")
        if self.request.query_params.get("active") == "1":
            qs = qs.filter(status__in=BotRun.ACTIVE_STATUSES)
        return qs


class TradeViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = TradeSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = Trade.objects.for_user(self.request.user).select_related("strategy", "run")
        source = self.request.query_params.get("source")
        if source in {Trade.SOURCE_SIMULATION, Trade.SOURCE_LIVE}:
            qs = qs.filter(source=source)
        mode = self.request.query_params.get("mode")
        if mode in {"simulation", "deriv_demo", "deriv_real"}:
            qs = qs.filter(mode=mode)
        if self.request.query_params.get("settled") == "1":
            qs = qs.filter(settled_at__isnull=False, error="")
        return qs
