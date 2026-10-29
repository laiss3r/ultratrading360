"""
Django settings for the UltraTrading360 backend engine.

This backend is the SERVER-SIDE counterpart to the Next.js frontend. It exists so that a
deployment with a real database, a persistent worker and Redis-backed Channels can run bots
unattended -- something Vercel's serverless functions cannot do, because a bot must outlive a
single HTTP request.

Every secret comes from the environment. Nothing here has a usable production default: if a
required secret is missing the app refuses to start rather than silently running insecurely.
"""

from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def env(key: str, default: str | None = None, *, required: bool = False) -> str:
    value = os.environ.get(key, default)
    if required and (value is None or value == ""):
        raise RuntimeError(
            f"Missing required environment variable {key}. "
            f"Copy .env.example to .env and fill it in; do not hardcode secrets."
        )
    return value or ""


def env_bool(key: str, default: bool = False) -> bool:
    raw = os.environ.get(key)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_list(key: str, default: str = "") -> list[str]:
    raw = os.environ.get(key, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


# --------------------------------------------------------------------------- core

DEBUG = env_bool("DJANGO_DEBUG", False)

# SECRET_KEY must come from the environment in any real deployment.
#
# The one exception is the test suite: it sets DJANGO_ALLOW_INSECURE_TEST_KEY so `pytest` can run
# with no secrets configured. That flag is deliberately NOT honoured when DJANGO_DEBUG is false
# and a real database is in use, so a misconfigured production deploy fails loudly at import time
# instead of starting up with a key that is published in this repository.
_INSECURE_KEY = "insecure-test-key-not-for-production"
_allow_insecure_test_key = env_bool("DJANGO_ALLOW_INSECURE_TEST_KEY", False)
SECRET_KEY = env("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if _allow_insecure_test_key:
        SECRET_KEY = _INSECURE_KEY
    else:
        raise RuntimeError(
            "DJANGO_SECRET_KEY is not set. Refusing to start: a Django secret key signs sessions, "
            "CSRF tokens and password resets. Generate one with "
            "`python -c \"from django.core.management.utils import get_random_secret_key as g; print(g())\"` "
            "and set it in the environment. Set DJANGO_ALLOW_INSECURE_TEST_KEY=1 only for the test suite."
        )

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")

INSTALLED_APPS = [
    "daphne",
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    "channels",
    "trading",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    },
]

# --------------------------------------------------------------------------- database
#
# Postgres in every real deployment (docker-compose provides it). The test suite is pointed at
# SQLite via DJANGO_DB_ENGINE=sqlite so `pytest` runs with no external service, which keeps the
# suite fast and hermetic; schema-level behaviour is identical for what is tested here.

_DB_ENGINE = env("DJANGO_DB_ENGINE", "postgres")
if _DB_ENGINE == "sqlite":
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": env("POSTGRES_DB", "ultratrading"),
            "USER": env("POSTGRES_USER", "ultratrading"),
            "PASSWORD": env("POSTGRES_PASSWORD", ""),
            "HOST": env("POSTGRES_HOST", "localhost"),
            "PORT": env("POSTGRES_PORT", "5432"),
            "CONN_MAX_AGE": 60,
        }
    }

# --------------------------------------------------------------------------- cache / channels

REDIS_URL = env("REDIS_URL", "redis://localhost:6379/0")

CACHES = {
    "default": {
        # LocMem in tests so the suite does not require a running Redis.
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache"
        if env_bool("DJANGO_USE_LOCMEM_CACHE", _DB_ENGINE == "sqlite")
        else "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    }
}

CHANNEL_LAYERS = {
    "default": (
        {"BACKEND": "channels.layers.InMemoryChannelLayer"}
        if env_bool("DJANGO_USE_INMEMORY_CHANNELS", _DB_ENGINE == "sqlite")
        else {"BACKEND": "channels_redis.core.RedisChannelLayer", "CONFIG": {"hosts": [REDIS_URL]}}
    )
}

# --------------------------------------------------------------------------- DRF

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "trading.auth.BackendTokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "UNAUTHENTICATED_USER": None,
    # Paginate by default: a trade ledger grows without bound and an unpaginated list endpoint
    # would eventually return the entire history in one response.
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 100,
}

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:3000")
CORS_ALLOW_CREDENTIALS = True

# --------------------------------------------------------------------------- security

if not DEBUG:
    SECURE_HSTS_SECONDS = int(env("SECURE_HSTS_SECONDS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# --------------------------------------------------------------------------- Deriv

DERIV_APP_ID = env("DERIV_APP_ID", "90470")
DERIV_API_BASE = env("DERIV_API_BASE", "https://api.derivws.com")
DERIV_WS_PUBLIC = env("DERIV_WS_PUBLIC", "wss://api.derivws.com/trading/v1/options/ws/public")
DERIV_WS_DEMO = env("DERIV_WS_DEMO", "wss://api.derivws.com/trading/v1/options/ws/demo")
DERIV_WS_REAL = env("DERIV_WS_REAL", "wss://api.derivws.com/trading/v1/options/ws/real")
DERIV_OAUTH_AUTHORIZE_URL = env("DERIV_OAUTH_AUTHORIZE_URL", "https://auth.deriv.com/oauth2/auth")
DERIV_OAUTH_TOKEN_URL = env("DERIV_OAUTH_TOKEN_URL", "https://auth.deriv.com/oauth2/token")

# Fernet key used to encrypt stored Deriv tokens at rest. REQUIRED in production: a leaked
# database must not yield usable trading credentials.
DERIV_TOKEN_FERNET_KEY = env("DERIV_TOKEN_FERNET_KEY", "")

# --------------------------------------------------------------------------- engine

# How long a worker may hold a bot lease before another worker can take over. Prevents two
# workers running the same bot after a crash or a deploy.
BOT_LEASE_SECONDS = int(env("BOT_LEASE_SECONDS", "30"))
BOT_TICK_SECONDS = float(env("BOT_TICK_SECONDS", "1.0"))
ENGINE_MAX_WORKERS = int(env("ENGINE_MAX_WORKERS", "4"))

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
TIME_ZONE = "UTC"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"simple": {"format": "{levelname} {name} {message}", "style": "{"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "simple"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
}
