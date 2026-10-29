"""
Pytest bootstrap.

Environment variables must exist BEFORE Django settings are imported, so they are set here at the
top of conftest rather than in a fixture.

The suite is hermetic: SQLite, in-memory channel layer, LocMem cache, and NO real Deriv calls.
Network-dependent behaviour is tested against a stubbed transport, so the suite passes offline and
never places a real order.
"""

import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.test_settings")
os.environ.setdefault("DJANGO_ALLOW_INSECURE_TEST_KEY", "1")
os.environ.setdefault("DJANGO_DB_ENGINE", "sqlite")
os.environ.setdefault("DJANGO_DEBUG", "false")
# A real, valid Fernet key so the encryption code paths are genuinely exercised rather than
# skipped. TEST-ONLY: it is committed on purpose so the suite is reproducible, and production must
# set its own DERIV_TOKEN_FERNET_KEY -- reusing this one would mean shipping a published key.
os.environ.setdefault("DERIV_TOKEN_FERNET_KEY", "Jc0ysqTUAh2DYz27AYzgXaiR_BMnqWJHusn-sgIRAVw=")

import pytest  # noqa: E402
from django.contrib.auth import get_user_model  # noqa: E402


@pytest.fixture
def user(db):
    User = get_user_model()
    return User.objects.create_user(username="alice", password="pw-not-used-by-api")


@pytest.fixture
def other_user(db):
    User = get_user_model()
    return User.objects.create_user(username="bob", password="pw-not-used-by-api")


@pytest.fixture
def auth_client(user):
    """A DRF test client authenticated with a real bearer token."""
    from rest_framework.test import APIClient

    from trading.auth import issue_token

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(user)}")
    return client


@pytest.fixture
def strategy(user):
    from trading.models import Strategy

    return Strategy.objects.create(
        owner=user, name="Test odd", version=1, market="R_100", contract_type="DIGITODD",
        stake=1, cooldown_seconds=0, max_trades=1000,
        entry={"id": "root", "op": "AND", "children": [{"id": "a", "kind": "always"}]},
    )


@pytest.fixture
def risk_enabled(user):
    """A RiskProfile with the kill switch OFF→ON, since trading is disabled by default."""
    from trading.models import RiskProfile

    profile, _ = RiskProfile.objects.get_or_create(owner=user)
    profile.trading_enabled = True
    profile.max_stake = 100
    profile.max_session_loss = 10_000
    profile.max_daily_loss = 10_000
    profile.max_session_exposure = 1_000_000
    profile.max_open_exposure = 1_000_000
    profile.max_trades = 100_000
    profile.save()
    return profile
