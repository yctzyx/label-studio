"""Resolve optional base URL for bundled Django /static assets in embed mode."""

from __future__ import annotations

from django.conf import settings


def resolve_embed_static_hostname(request=None) -> str:
    """
    Optional override for /static/* sample URLs.

    Default (empty string): emit relative paths like ``/static/samples/sample.jpg``.
    The browser resolves them against the **current page origin** (e.g. platform
  :5173 with ``location /static { proxy_pass LS; }``), avoiding cross-origin requests.

    Set ``EMBED_STATIC_HOSTNAME`` only when static must be loaded from a different origin.
    """
    _ = request  # reserved for future request-derived overrides
    return (getattr(settings, 'EMBED_STATIC_HOSTNAME', None) or '').strip().rstrip('/')
