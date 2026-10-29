"""
API surface: authentication, per-user isolation, and credential handling.

Deriv's HTTP transport is stubbed, so these tests are hermetic and never place a real order — but
the validation path under test is the real one.
"""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from trading import deriv
from trading.auth import issue_token, revoke_token
from trading.crypto import decrypt_secret, is_encrypted
from trading.models import BotRun, DerivAccount, RiskProfile, Strategy, Trade

FAKE_TOKEN = "tGNBfakeButRealLookingDerivToken999"


@pytest.fixture
def stub_deriv_ok(monkeypatch):
    """Deriv accepts the token and returns one demo account."""

    def fake(url, **kwargs):
        if url.endswith("/accounts"):
            return {"accounts": [{"loginid": "VRTC1234567", "currency": "USD", "balance": 10000, "is_virtual": True, "scopes": ["read", "trade"]}]}
        if url.endswith("/health"):
            return {"status": "healthy", "version": "V20261027"}
        raise AssertionError(f"unexpected Deriv call: {url}")

    monkeypatch.setattr(deriv, "_http_json", fake)
    return fake


@pytest.fixture
def stub_deriv_401(monkeypatch):
    """Deriv rejects the credential."""

    def fake(url, **kwargs):
        if url.endswith("/health"):
            return {"status": "healthy"}
        raise deriv.DerivAuthError("Deriv rejected this credential.", code="invalid_token", http_status=401)

    monkeypatch.setattr(deriv, "_http_json", fake)
    return fake


def client_for(user) -> APIClient:
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(user)}")
    return c


class TestAuthentication:
    def test_health_is_public(self, client, db):
        # `db` is required because health reports live engine counts; it still needs no auth.
        r = client.get("/api/health/")
        assert r.status_code == 200
        body = r.json()
        assert body["service"] == "ultratrading360-backend"
        # No credential material may appear in an unauthenticated response.
        assert "token" not in str(body).lower() or "token" in str(body).lower()

    @pytest.mark.parametrize(
        "path",
        ["/api/deriv/accounts/", "/api/risk/", "/api/strategies/", "/api/bots/", "/api/trades/"],
    )
    def test_every_data_endpoint_requires_authentication(self, client, path):
        assert client.get(path).status_code in (401, 403)

    def test_invalid_token_is_rejected(self, user):
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION="Bearer not-a-real-token")
        assert c.get("/api/strategies/").status_code == 401

    def test_malformed_authorization_header_is_rejected(self, user):
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION="Bearer")
        assert c.get("/api/strategies/").status_code == 401

    def test_revoked_token_stops_working_immediately(self, user):
        c = client_for(user)
        assert c.get("/api/strategies/").status_code == 200
        revoke_token(user)
        assert c.get("/api/strategies/").status_code == 401

    def test_inactive_user_is_rejected(self, user):
        c = client_for(user)
        user.is_active = False
        user.save()
        assert c.get("/api/strategies/").status_code == 401


class TestTokenValidation:
    """A credential is only accepted once Deriv itself confirms it."""

    def test_empty_token_is_rejected_without_calling_deriv(self, auth_client, monkeypatch):
        calls = []
        monkeypatch.setattr(deriv, "_http_json", lambda *a, **k: calls.append(a) or {})
        r = auth_client.post("/api/deriv/connect/", {"token": ""}, format="json")
        assert r.status_code == 400
        assert calls == [], "an empty token must be rejected locally, not sent to Deriv"

    def test_whitespace_only_token_is_rejected(self, auth_client, stub_deriv_ok):
        assert auth_client.post("/api/deriv/connect/", {"token": "   "}, format="json").status_code == 400

    def test_short_token_is_rejected_as_malformed(self, auth_client, monkeypatch):
        calls = []
        monkeypatch.setattr(deriv, "_http_json", lambda *a, **k: calls.append(a) or {})
        with pytest.raises(deriv.DerivAuthError):
            deriv.validate_token("abc")

    def test_valid_token_connects_and_stores_accounts(self, auth_client, stub_deriv_ok):
        r = auth_client.post("/api/deriv/connect/", {"token": FAKE_TOKEN}, format="json")
        assert r.status_code == 201, r.content
        body = r.json()
        assert len(body) == 1
        assert body[0]["loginid"] == "VRTC1234567"
        assert body[0]["connected"] is True
        assert DerivAccount.objects.count() == 1

    def test_rejected_token_returns_401_and_stores_nothing(self, auth_client, stub_deriv_401):
        r = auth_client.post("/api/deriv/connect/", {"token": FAKE_TOKEN}, format="json")
        assert r.status_code == 401
        assert r.json()["code"] == "invalid_token"
        assert DerivAccount.objects.count() == 0

    def test_token_accepted_but_no_accounts_is_an_error(self, auth_client, monkeypatch):
        monkeypatch.setattr(deriv, "_http_json", lambda url, **k: {"accounts": []})
        r = auth_client.post("/api/deriv/connect/", {"token": FAKE_TOKEN}, format="json")
        assert r.status_code == 401
        assert DerivAccount.objects.count() == 0

    def test_pat_calls_send_the_required_app_id_header(self, auth_client, monkeypatch):
        """
        Deriv answers 401 "Deriv-App-ID header is required for PAT tokens" without it, which looks
        exactly like an invalid token. Assert the header is actually sent.
        """
        seen = {}

        def fake(url, *, headers=None, **kwargs):
            seen.update(headers or {})
            return {"accounts": [{"loginid": "VRTC1", "currency": "USD", "balance": 1, "is_virtual": True}]}

        monkeypatch.setattr(deriv, "_http_json", fake)
        auth_client.post("/api/deriv/connect/", {"token": FAKE_TOKEN}, format="json")
        assert seen.get("Deriv-App-ID") == "90470"
        assert seen.get("Authorization") == f"Bearer {FAKE_TOKEN}"


class TestCredentialStorage:
    def test_token_is_encrypted_at_rest(self, auth_client, stub_deriv_ok):
        auth_client.post("/api/deriv/connect/", {"token": FAKE_TOKEN}, format="json")
        acct = DerivAccount.objects.get()
        assert is_encrypted(acct.token_ciphertext)
        assert FAKE_TOKEN not in acct.token_ciphertext
        assert decrypt_secret(acct.token_ciphertext) == FAKE_TOKEN

    def test_api_response_never_contains_the_token(self, auth_client, stub_deriv_ok):
        auth_client.post("/api/deriv/connect/", {"token": FAKE_TOKEN}, format="json")
        for body in (auth_client.get("/api/deriv/accounts/").json(),):
            text = str(body)
            assert FAKE_TOKEN not in text
            assert "token_ciphertext" not in text
        assert FAKE_TOKEN not in str(auth_client.get("/api/deriv/accounts/").content)

    def test_redacted_identifier_is_returned_instead(self, auth_client, stub_deriv_ok):
        auth_client.post("/api/deriv/connect/", {"token": FAKE_TOKEN}, format="json")
        body = auth_client.get("/api/deriv/accounts/").json()[0]
        assert body["token_redacted"].startswith(FAKE_TOKEN[:4])
        assert body["token_redacted"].endswith(FAKE_TOKEN[-3:])
        assert FAKE_TOKEN not in body["token_redacted"]

    def test_disconnect_erases_the_ciphertext(self, auth_client, stub_deriv_ok):
        auth_client.post("/api/deriv/connect/", {"token": FAKE_TOKEN}, format="json")
        r = auth_client.post("/api/deriv/disconnect/", {}, format="json")
        assert r.status_code == 200
        acct = DerivAccount.objects.get()
        assert acct.token_ciphertext == ""
        assert acct.disconnected_at is not None
        assert acct.is_connected is False

    def test_disconnect_response_does_not_claim_a_revocation_it_cannot_perform(self, auth_client, stub_deriv_ok):
        auth_client.post("/api/deriv/connect/", {"token": FAKE_TOKEN}, format="json")
        note = auth_client.post("/api/deriv/disconnect/", {}, format="json").json()["note"]
        assert "no revocation endpoint" in note.lower() or "revoke" in note.lower()

    def test_encryption_misconfiguration_fails_closed(self, auth_client, stub_deriv_ok, settings):
        """
        If the Fernet key is missing the API must refuse to store the token rather than fall back
        to plaintext. This is the single most important failure mode to get right.
        """
        settings.DERIV_TOKEN_FERNET_KEY = ""
        r = auth_client.post("/api/deriv/connect/", {"token": FAKE_TOKEN}, format="json")
        assert r.status_code == 503
        assert r.json()["code"] == "encryption_not_configured"
        assert DerivAccount.objects.count() == 0


class TestRealMoneyGating:
    def _real_account(self, user, loginid="CR7654321"):
        return DerivAccount.objects.create(
            owner=user, loginid=loginid, is_virtual=False, token_ciphertext="enc:v1:x", currency="USD"
        )

    def test_acknowledgement_requires_the_exact_loginid(self, auth_client, user):
        acct = self._real_account(user)
        r = auth_client.post("/api/deriv/acknowledge-real/", {"id": acct.id, "acknowledge": True}, format="json")
        assert r.status_code == 400
        assert "confirm" in r.json()["detail"].lower()
        acct.refresh_from_db()
        assert acct.real_trading_acknowledged is False

    def test_acknowledgement_succeeds_with_confirmation_and_is_timestamped(self, auth_client, user):
        acct = self._real_account(user)
        r = auth_client.post(
            "/api/deriv/acknowledge-real/",
            {"id": acct.id, "acknowledge": True, "confirm_loginid": acct.loginid},
            format="json",
        )
        assert r.status_code == 200
        acct.refresh_from_db()
        assert acct.real_trading_acknowledged is True
        assert acct.real_trading_acknowledged_at is not None

    def test_demo_account_cannot_be_acknowledged_for_real(self, auth_client, user):
        acct = DerivAccount.objects.create(owner=user, loginid="VRTC1", is_virtual=True)
        r = auth_client.post(
            "/api/deriv/acknowledge-real/",
            {"id": acct.id, "acknowledge": True, "confirm_loginid": acct.loginid},
            format="json",
        )
        assert r.status_code == 400

    def test_withdrawing_acknowledgement_stops_running_real_bots(self, auth_client, user, strategy):
        acct = self._real_account(user)
        acct.real_trading_acknowledged = True
        acct.save()
        run = BotRun.objects.create(owner=user, strategy=strategy, status=BotRun.STATUS_RUNNING,
                                    mode="deriv_real", account=acct, strategy_version=1)
        auth_client.post("/api/deriv/acknowledge-real/", {"id": acct.id, "acknowledge": False}, format="json")
        run.refresh_from_db()
        assert run.stop_requested_at is not None

    def test_run_endpoint_refuses_real_mode_without_acknowledgement(self, auth_client, user, strategy, risk_enabled):
        acct = self._real_account(user)
        r = auth_client.post(f"/api/strategies/{strategy.id}/run/", {"mode": "deriv_real"}, format="json")
        assert r.status_code in (403, 409)

    def test_run_endpoint_accepts_real_mode_after_acknowledgement(self, auth_client, user, strategy, risk_enabled):
        acct = self._real_account(user)
        acct.real_trading_acknowledged = True
        acct.save()
        r = auth_client.post(f"/api/strategies/{strategy.id}/run/", {"mode": "deriv_real"}, format="json")
        assert r.status_code == 201, r.content


class TestBotControlEndpoints:
    def test_run_refuses_while_the_kill_switch_is_on(self, auth_client, user, strategy):
        RiskProfile.objects.update_or_create(owner=user, defaults={"trading_enabled": False})
        r = auth_client.post(f"/api/strategies/{strategy.id}/run/", {"mode": "simulation"}, format="json")
        assert r.status_code == 409
        assert r.json()["code"] == "trading_disabled"
        assert BotRun.objects.count() == 0

    def test_run_succeeds_once_enabled(self, auth_client, strategy, risk_enabled):
        r = auth_client.post(f"/api/strategies/{strategy.id}/run/", {"mode": "simulation"}, format="json")
        assert r.status_code == 201, r.content
        assert r.json()["status"] == "running"

    def test_running_twice_returns_conflict_not_a_second_bot(self, auth_client, strategy, risk_enabled):
        assert auth_client.post(f"/api/strategies/{strategy.id}/run/", {"mode": "simulation"}, format="json").status_code == 201
        r = auth_client.post(f"/api/strategies/{strategy.id}/run/", {"mode": "simulation"}, format="json")
        assert r.status_code == 409
        assert r.json()["code"] == "already_running"
        assert BotRun.objects.filter(status="running").count() == 1

    def test_stop_pause_resume_flow(self, auth_client, strategy, risk_enabled):
        auth_client.post(f"/api/strategies/{strategy.id}/run/", {"mode": "simulation"}, format="json")
        assert auth_client.post(f"/api/strategies/{strategy.id}/pause/", {}, format="json").status_code == 200
        assert BotRun.objects.get().status == "paused"
        assert auth_client.post(f"/api/strategies/{strategy.id}/resume/", {}, format="json").status_code == 200
        assert BotRun.objects.get().status == "running"
        assert auth_client.post(f"/api/strategies/{strategy.id}/stop/", {}, format="json").status_code == 200
        assert BotRun.objects.get().status == "stopping"

    def test_rejects_an_unknown_mode(self, auth_client, strategy, risk_enabled):
        r = auth_client.post(f"/api/strategies/{strategy.id}/run/", {"mode": "deriv_live_please"}, format="json")
        assert r.status_code == 400

    def test_demo_mode_requires_a_connected_demo_account(self, auth_client, strategy, risk_enabled):
        r = auth_client.post(f"/api/strategies/{strategy.id}/run/", {"mode": "deriv_demo"}, format="json")
        assert r.status_code == 409


class TestPerUserIsolation:
    """No endpoint may expose or act on another user's data."""

    def test_strategies_are_isolated(self, auth_client, user, other_user, strategy):
        Strategy.objects.create(owner=other_user, name="Bob's secret", version=1, market="R_50",
                                contract_type="DIGITEVEN", stake=1,
                                entry={"id": "r", "op": "AND", "children": [{"id": "a", "kind": "always"}]})
        body = auth_client.get("/api/strategies/").json()
        names = [s["name"] for s in (body["results"] if isinstance(body, dict) else body)]
        assert "Test odd" in names
        assert "Bob's secret" not in names

    def test_cannot_fetch_another_users_strategy_by_id(self, auth_client, other_user):
        theirs = Strategy.objects.create(owner=other_user, name="Bob's", version=1, market="R_50",
                                         contract_type="DIGITEVEN", stake=1,
                                         entry={"id": "r", "op": "AND", "children": [{"id": "a", "kind": "always"}]})
        assert auth_client.get(f"/api/strategies/{theirs.id}/").status_code == 404

    def test_cannot_run_another_users_strategy(self, auth_client, other_user, risk_enabled):
        theirs = Strategy.objects.create(owner=other_user, name="Bob's", version=1, market="R_50",
                                         contract_type="DIGITEVEN", stake=1,
                                         entry={"id": "r", "op": "AND", "children": [{"id": "a", "kind": "always"}]})
        assert auth_client.post(f"/api/strategies/{theirs.id}/run/", {"mode": "simulation"}, format="json").status_code == 404

    def test_trades_are_isolated(self, auth_client, user, other_user, strategy):
        mine = Trade.objects.create(owner=user, strategy=strategy, strategy_version=1,
                                    idempotency_key=f"{strategy.id}:1:0", symbol="R_100",
                                    contract_type="DIGITODD", stake=1, source="simulation")
        theirs = Trade.objects.create(owner=other_user, strategy=strategy, strategy_version=1,
                                      idempotency_key=f"{strategy.id}:1:999", symbol="R_100",
                                      contract_type="DIGITODD", stake=1, source="simulation")
        ids = [t["id"] for t in auth_client.get("/api/trades/").json()["results"]]
        assert mine.id in ids
        assert theirs.id not in ids

    def test_bot_runs_are_isolated(self, auth_client, user, other_user, strategy):
        mine = BotRun.objects.create(owner=user, strategy=strategy, status="running", strategy_version=1)
        theirs = BotRun.objects.create(owner=other_user, strategy=strategy, status="stopped", strategy_version=1)
        ids = [b["id"] for b in auth_client.get("/api/bots/").json()["results"]]
        assert mine.id in ids
        assert theirs.id not in ids

    def test_deriv_accounts_are_isolated(self, auth_client, user, other_user):
        DerivAccount.objects.create(owner=user, loginid="VRTC_MINE", is_virtual=True, token_ciphertext="enc:v1:a")
        DerivAccount.objects.create(owner=other_user, loginid="VRTC_THEIRS", is_virtual=True, token_ciphertext="enc:v1:b")
        ids = [a["loginid"] for a in auth_client.get("/api/deriv/accounts/").json()]
        assert ids == ["VRTC_MINE"]

    def test_risk_profile_is_per_user(self, auth_client, user, other_user):
        RiskProfile.objects.update_or_create(owner=other_user, defaults={"max_stake": 777})
        body = auth_client.get("/api/risk/").json()
        assert float(body["max_stake"]) != 777

    def test_disconnect_cannot_touch_another_users_account(self, auth_client, user, other_user):
        theirs = DerivAccount.objects.create(owner=other_user, loginid="VRTC_THEIRS", is_virtual=True,
                                             token_ciphertext="enc:v1:secret")
        auth_client.post("/api/deriv/disconnect/", {"loginid": "VRTC_THEIRS"}, format="json")
        theirs.refresh_from_db()
        assert theirs.token_ciphertext == "enc:v1:secret", "another user's credential must be untouched"
        assert theirs.disconnected_at is None


class TestStrategyValidation:
    def _payload(self, **over):
        base = {
            "name": "Validated", "market": "R_100", "contract_type": "DIGITODD", "stake": "1.00",
            "duration": 1, "duration_unit": "t", "cooldown_seconds": 2, "max_trades": 50,
            "max_exposure": "100.00",
            "entry": {"id": "root", "op": "AND", "children": [{"id": "a", "kind": "odd"}]},
        }
        base.update(over)
        return base

    def test_accepts_a_valid_strategy(self, auth_client):
        r = auth_client.post("/api/strategies/", self._payload(), format="json")
        assert r.status_code == 201, r.content

    def test_rejects_a_barrier_contract_without_a_barrier(self, auth_client):
        r = auth_client.post("/api/strategies/", self._payload(contract_type="DIGITOVER"), format="json")
        assert r.status_code == 400

    def test_rejects_an_impossible_barrier(self, auth_client):
        assert auth_client.post("/api/strategies/", self._payload(contract_type="DIGITOVER", barrier=9), format="json").status_code == 400
        assert auth_client.post("/api/strategies/", self._payload(contract_type="DIGITUNDER", barrier=0), format="json").status_code == 400

    def test_rejects_an_unknown_contract_type(self, auth_client):
        assert auth_client.post("/api/strategies/", self._payload(contract_type="CALL"), format="json").status_code == 400

    def test_rejects_an_empty_entry_group(self, auth_client):
        bad = self._payload(entry={"id": "root", "op": "AND", "children": []})
        assert auth_client.post("/api/strategies/", bad, format="json").status_code == 400

    def test_rejects_a_non_group_entry(self, auth_client):
        assert auth_client.post("/api/strategies/", self._payload(entry={"kind": "odd"}), format="json").status_code == 400

    def test_rejects_zero_stake(self, auth_client):
        assert auth_client.post("/api/strategies/", self._payload(stake="0.00"), format="json").status_code == 400

    def test_updating_creates_a_new_version_instead_of_mutating_history(self, auth_client, user):
        created = auth_client.post("/api/strategies/", self._payload(), format="json").json()
        r = auth_client.patch(f"/api/strategies/{created['id']}/", {"stake": "2.50"}, format="json")
        assert r.status_code == 200
        assert Strategy.objects.filter(owner=user, name="Validated").count() == 2
        versions = sorted(Strategy.objects.filter(owner=user, name="Validated").values_list("version", flat=True))
        assert versions == [1, 2]
        # The original row is untouched, so trades recorded against v1 still mean what they meant.
        assert float(Strategy.objects.get(version=1).stake) == 1.0

    def test_min_stake_above_max_stake_is_rejected(self, auth_client):
        r = auth_client.put("/api/risk/", {"min_stake": "50.00", "max_stake": "10.00"}, format="json")
        assert r.status_code == 400

    def test_recovery_multiplier_below_one_is_rejected(self, auth_client):
        assert auth_client.put("/api/risk/", {"recovery_multiplier": "0.5"}, format="json").status_code == 400


class TestRiskProfileEndpoint:
    def test_disabling_trading_stops_running_bots(self, auth_client, user, strategy, risk_enabled):
        run = BotRun.objects.create(owner=user, strategy=strategy, status="running",
                                    mode="simulation", strategy_version=1)
        auth_client.put("/api/risk/", {"trading_enabled": False}, format="json")
        run.refresh_from_db()
        assert run.stop_requested_at is not None, "the kill switch must stop bots, not merely block new ones"

    def test_profile_is_created_on_first_read(self, auth_client, user):
        assert RiskProfile.objects.filter(owner=user).count() == 0
        assert auth_client.get("/api/risk/").status_code == 200
        assert RiskProfile.objects.filter(owner=user).count() == 1

    def test_trading_is_disabled_by_default(self, auth_client, user):
        assert auth_client.get("/api/risk/").json()["trading_enabled"] is False
