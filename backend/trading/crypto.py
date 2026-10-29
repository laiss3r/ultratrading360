"""
Encryption for Deriv credentials at rest.

A leaked database must not yield usable trading credentials, so tokens are stored as Fernet
ciphertext (AES-128-CBC + HMAC-SHA256, authenticated). The key comes only from the environment.

If no key is configured, encryption FAILS rather than falling back to plaintext. Storing a live
trading token unencrypted because a variable was unset is exactly the failure mode this module
exists to prevent.
"""

from __future__ import annotations

import logging

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings

logger = logging.getLogger(__name__)

_FIELD_PREFIX = "enc:v1:"


class EncryptionNotConfigured(RuntimeError):
    """Raised when DERIV_TOKEN_FERNET_KEY is missing or malformed."""


def _fernet() -> Fernet:
    key = (getattr(settings, "DERIV_TOKEN_FERNET_KEY", "") or "").strip()
    if not key:
        raise EncryptionNotConfigured(
            "DERIV_TOKEN_FERNET_KEY is not set. Refusing to store a Deriv token in plaintext. "
            'Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
        )
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except Exception as exc:  # noqa: BLE001 - report any malformed key the same way
        raise EncryptionNotConfigured(f"DERIV_TOKEN_FERNET_KEY is not a valid Fernet key: {exc}") from exc


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a credential. Returns a versioned, self-describing string."""
    if plaintext is None:
        raise ValueError("cannot encrypt None")
    return _FIELD_PREFIX + _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(stored: str) -> str:
    """
    Decrypt a credential.

    Raises EncryptionNotConfigured if the key is absent, and InvalidToken if the ciphertext was
    tampered with or encrypted under a different key. Neither case is silently downgraded.
    """
    if not stored:
        raise ValueError("nothing to decrypt")
    if not stored.startswith(_FIELD_PREFIX):
        # A value without the prefix was written by something other than this module. Treating it
        # as plaintext would quietly accept unencrypted credentials, so it is rejected instead.
        raise InvalidToken("stored value is not encrypted with this module's format")
    return _fernet().decrypt(stored[len(_FIELD_PREFIX) :].encode("ascii")).decode("utf-8")


def redact(token: str, prefix: int = 4, suffix: int = 3) -> str:
    """
    A display-safe identifier for a credential: enough to recognise WHICH token is connected,
    never enough to use it. Used in logs and API responses.
    """
    if not token:
        return ""
    if len(token) <= prefix + suffix + 1:
        return "*" * len(token)
    return f"{token[:prefix]}{'*' * 8}{token[-suffix:]}"


def is_encrypted(value: str | None) -> bool:
    return bool(value) and value.startswith(_FIELD_PREFIX)
