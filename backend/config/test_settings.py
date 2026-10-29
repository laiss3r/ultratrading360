"""
Test settings.

pytest-django imports the settings module before the rootdir conftest.py runs, so environment
defaults for the suite have to be established HERE, at import time, before `config.settings` is
evaluated. A dedicated module makes the test configuration explicit instead of relying on whatever
happens to be exported in the shell.

Everything sensitive is pinned to safe, hermetic values: SQLite, an in-memory channel layer, a
LocMem cache, and a test-only Fernet key. No test touches the network or a real Deriv account.
"""

import os

from cryptography.fernet import Fernet

os.environ.setdefault("DJANGO_ALLOW_INSECURE_TEST_KEY", "1")
os.environ.setdefault("DJANGO_DB_ENGINE", "sqlite")
os.environ.setdefault("DJANGO_DEBUG", "false")
os.environ.setdefault("DJANGO_USE_LOCMEM_CACHE", "1")
os.environ.setdefault("DJANGO_USE_INMEMORY_CHANNELS", "1")
# Generated once at import if absent, so the encryption code paths are genuinely exercised.
os.environ.setdefault("DERIV_TOKEN_FERNET_KEY", Fernet.generate_key().decode())
os.environ.setdefault("DERIV_APP_ID", "90470")

from .settings import *  # noqa: E402,F401,F403

# SSL redirect and HSTS are correct in production but make every test request a 301. TLS
# termination is a deployment concern (the reverse proxy handles it), so it is disabled here
# rather than weakening the production defaults in config/settings.py.
SECURE_SSL_REDIRECT = False
SECURE_HSTS_SECONDS = 0
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
