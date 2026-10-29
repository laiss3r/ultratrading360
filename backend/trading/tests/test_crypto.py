"""Credential encryption. The property that matters: plaintext never reaches storage or logs."""

import pytest
from cryptography.fernet import InvalidToken
from django.test import override_settings

from trading.crypto import (
    EncryptionNotConfigured, decrypt_secret, encrypt_secret, is_encrypted, redact,
)

TOKEN = "tGNBexampleRealLookingDerivToken1234567"


class TestEncryptDecrypt:
    def test_round_trip(self):
        assert decrypt_secret(encrypt_secret(TOKEN)) == TOKEN

    def test_ciphertext_is_not_the_plaintext(self):
        blob = encrypt_secret(TOKEN)
        assert TOKEN not in blob
        assert blob != TOKEN

    def test_ciphertext_is_self_describing_and_versioned(self):
        assert encrypt_secret(TOKEN).startswith("enc:v1:")
        assert is_encrypted(encrypt_secret(TOKEN))

    def test_same_plaintext_yields_different_ciphertext(self):
        # Fernet embeds a timestamp and random IV, so equality would mean a deterministic cipher.
        assert encrypt_secret(TOKEN) != encrypt_secret(TOKEN)

    def test_unicode_and_edge_lengths(self):
        for value in ("", "a", "x" * 4096, "token-with-émoji-🔐"):
            assert decrypt_secret(encrypt_secret(value)) == value


class TestFailClosed:
    @override_settings(DERIV_TOKEN_FERNET_KEY="")
    def test_refuses_to_encrypt_without_a_key(self):
        """
        The critical guarantee: a missing key must NOT silently store plaintext. A leaked database
        containing unencrypted trading tokens is the exact failure this prevents.
        """
        with pytest.raises(EncryptionNotConfigured):
            encrypt_secret(TOKEN)

    @override_settings(DERIV_TOKEN_FERNET_KEY="not-a-valid-fernet-key")
    def test_refuses_a_malformed_key(self):
        with pytest.raises(EncryptionNotConfigured):
            encrypt_secret(TOKEN)

    def test_refuses_to_decrypt_without_a_key(self):
        # Encrypt while a key IS configured, then remove it: a deploy that loses its key must fail
        # loudly rather than silently treat ciphertext as unusable-or-plaintext.
        blob = encrypt_secret(TOKEN)
        with override_settings(DERIV_TOKEN_FERNET_KEY=""):
            with pytest.raises(EncryptionNotConfigured):
                decrypt_secret(blob)

    def test_rejects_a_value_that_was_never_encrypted(self):
        """
        A bare token in the column means something wrote plaintext. Accepting it would launder an
        unencrypted credential into normal operation, so it is rejected instead.
        """
        with pytest.raises(InvalidToken):
            decrypt_secret(TOKEN)

    def test_rejects_empty_input(self):
        with pytest.raises(ValueError):
            decrypt_secret("")
        with pytest.raises(ValueError):
            encrypt_secret(None)  # type: ignore[arg-type]

    def test_detects_tampering(self):
        blob = encrypt_secret(TOKEN)
        # Flip a character in the payload region.
        head, _, tail = blob.rpartition("=")
        tampered = head + "=" + ("A" if tail[:1] != "A" else "B") + tail[1:]
        with pytest.raises(InvalidToken):
            decrypt_secret(tampered)

    def test_rejects_ciphertext_from_a_different_key(self):
        blob = encrypt_secret(TOKEN)
        from cryptography.fernet import Fernet

        with override_settings(DERIV_TOKEN_FERNET_KEY=Fernet.generate_key().decode()):
            with pytest.raises(InvalidToken):
                decrypt_secret(blob)


class TestRedaction:
    def test_shows_only_prefix_and_suffix(self):
        r = redact(TOKEN)
        assert r.startswith(TOKEN[:4])
        assert r.endswith(TOKEN[-3:])
        assert "*" in r
        # The middle is gone: the redacted form cannot be used to reconstruct the token.
        assert TOKEN[4:-3] not in r

    def test_short_tokens_are_fully_masked(self):
        assert redact("abc") == "***"
        assert redact("abcdefgh") == "********"

    def test_empty(self):
        assert redact("") == ""

    def test_redacted_form_is_not_decryptable_or_usable(self):
        assert not is_encrypted(redact(TOKEN))
        with pytest.raises(InvalidToken):
            decrypt_secret(redact(TOKEN))
