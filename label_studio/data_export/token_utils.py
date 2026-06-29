"""Resolve API tokens for export resource downloads."""

from __future__ import annotations

import logging

from rest_framework.authtoken.models import Token

logger = logging.getLogger(__name__)


def _user_token_key(user) -> str | None:
    if not user:
        return None
    try:
        return user.auth_token.key
    except (AttributeError, Token.DoesNotExist):
        token = Token.objects.filter(user=user).first()
        return token.key if token else None


def get_export_access_token(project, user=None) -> str | None:
    """Pick an API token for Converter downloads.

    Priority: current user → project.created_by → organization.created_by → any active org member.
    Returns None when no token exists (JSON-only export without resource download may still work).
    """
    from users.models import User

    candidates = []
    if user is not None and getattr(user, 'is_authenticated', True):
        candidates.append(user)
    if getattr(project, 'created_by_id', None):
        candidates.append(project.created_by)
    org = getattr(project, 'organization', None)
    if org is not None and getattr(org, 'created_by_id', None):
        candidates.append(org.created_by)
    if org is not None:
        member = (
            User.objects.filter(
                om_through__organization=org,
                om_through__deleted_at__isnull=True,
                is_active=True,
            )
            .order_by('om_through__created_at', 'pk')
            .first()
        )
        if member is not None:
            candidates.append(member)

    seen: set[int] = set()
    for candidate in candidates:
        pk = getattr(candidate, 'pk', None)
        if pk is None or pk in seen:
            continue
        seen.add(pk)
        key = _user_token_key(candidate)
        if key:
            return key

    logger.warning(
        'No export access token for project %s (org=%s); resource download in export may fail',
        project.pk,
        getattr(org, 'pk', None),
    )
    return None
