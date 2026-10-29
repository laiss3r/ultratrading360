"""
Authentication for the backend API.

The Next.js frontend calls this API with a bearer token issued by DRF's authtoken app. Session
authentication is also accepted so the Django admin and browser debugging work.

Nothing here accepts a Deriv credential as a way to log in to THIS backend: a Deriv token authorizes
Deriv, not us. Conflating the two would let anyone who obtains a Deriv token impersonate a user
here, and would also mean storing a trading credential in a place it is used as a session key.
"""

from __future__ import annotations

import logging

from django.utils import timezone
from rest_framework import exceptions
from rest_framework.authentication import get_authorization_header
from rest_framework.authtoken.models import Token
from rest_framework.authentication import BaseAuthentication

logger = logging.getLogger(__name__)


class BackendTokenAuthentication(BaseAuthentication):
    """Bearer-token authentication against DRF's authtoken table."""

    keyword = "Bearer"
    model = Token

    def authenticate(self, request):
        header = get_authorization_header(request).split()
        if not header:
            return None
        if len(header) == 1:
            raise exceptions.AuthenticationFailed("Invalid token header: no credentials provided.")
        if len(header) > 2:
            raise exceptions.AuthenticationFailed("Invalid token header: token string must not contain spaces.")
        if header[0].lower().decode() != self.keyword.lower():
            return None  # some other scheme; let the next authenticator try

        raw = header[1].decode()
        return self.authenticate_credentials(raw)

    def authenticate_credentials(self, key: str):
        # A constant-time-ish lookup: filter on the key rather than iterating users.
        try:
            token = Token.objects.select_related("user").get(key=key)
        except Token.DoesNotExist:
            raise exceptions.AuthenticationFailed("Invalid token.") from None
        if not token.user.is_active:
            raise exceptions.AuthenticationFailed("User inactive or deleted.")
        return (token.user, token)

    def authenticate_header(self, request):
        return self.keyword


def issue_token(user) -> str:
    """Create (or return the existing) API token for a user."""
    token, _ = Token.objects.get_or_create(user=user)
    return token.key


def revoke_token(user) -> None:
    """Delete a user's API token. Existing copies stop working immediately."""
    Token.objects.filter(user=user).delete()
    logger.info("Revoked API token for user %s at %s", getattr(user, "pk", "?"), timezone.now().isoformat())
