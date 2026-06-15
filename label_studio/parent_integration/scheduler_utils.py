"""Shared retry helpers for parent-integration background schedulers."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any, Optional

from django.conf import settings
from django.db import DatabaseError, OperationalError, close_old_connections, connections

logger = logging.getLogger(__name__)

# Transient MySQL / network failures worth retrying (not schema or permission errors).
_RETRYABLE_DB_MARKERS = (
    'server has gone away',
    'lost connection',
    "can't connect",
    'cannot connect',
    'connection refused',
    'connection reset',
    'connection timed out',
    'timed out',
    'too many connections',
    'broken pipe',
    '(2002,',  # Can't connect to server
    '(2003,',  # Can't connect to MySQL server on host
    '(2006,',  # MySQL server has gone away
    '(2013,',  # Lost connection to MySQL server during query
)


def is_retryable_db_error(exc: BaseException) -> bool:
    if not isinstance(exc, (OperationalError, DatabaseError)):
        return False
    msg = str(exc).lower()
    return any(marker in msg for marker in _RETRYABLE_DB_MARKERS)


def close_db_aliases(*aliases: str) -> None:
    for alias in aliases:
        if alias not in connections:
            continue
        try:
            connections[alias].close()
        except Exception:
            logger.debug('[%s] close connection failed', alias, exc_info=True)


def _sync_retry_settings() -> tuple[int, float]:
    max_attempts = max(1, int(getattr(settings, 'PARENT_INTEGRATION_SYNC_MAX_RETRIES', 3)))
    base_delay = max(0.5, float(getattr(settings, 'PARENT_INTEGRATION_SYNC_RETRY_BASE_SECONDS', 2)))
    return max_attempts, base_delay


def run_sync_with_retries(
    label: str,
    sync_fn: Callable[[], Any],
    *,
    db_aliases: tuple[str, ...] = (),
    stop_event: Optional[Any] = None,
) -> bool:
    """
    Run ``sync_fn`` with exponential backoff on transient DB errors.

    Returns True when sync succeeds, False when all attempts fail or ``stop_event`` is set.
    """
    max_attempts, base_delay = _sync_retry_settings()
    last_exc: Optional[BaseException] = None

    for attempt in range(1, max_attempts + 1):
        if stop_event is not None and stop_event.is_set():
            return False

        try:
            close_old_connections()
            result = sync_fn()
            if attempt > 1:
                logger.info('[%s] synced on attempt %s/%s: %s', label, attempt, max_attempts, result)
            else:
                logger.info('[%s] synced: %s', label, result)
            return True
        except Exception as exc:
            last_exc = exc
            retryable = is_retryable_db_error(exc)
            is_last_attempt = attempt >= max_attempts

            if not retryable or is_last_attempt:
                if retryable:
                    logger.warning(
                        '[%s] scheduled sync failed after %s attempts: %s',
                        label,
                        max_attempts,
                        last_exc,
                    )
                else:
                    logger.exception('[%s] scheduled sync failed', label)
                return False

            delay = base_delay * (2 ** (attempt - 1))
            logger.warning(
                '[%s] transient DB error on attempt %s/%s (%s); retrying in %.1fs',
                label,
                attempt,
                max_attempts,
                exc,
                delay,
            )
            close_db_aliases(*db_aliases)
            close_old_connections()

            if stop_event is not None:
                if stop_event.wait(delay):
                    return False
            else:
                time.sleep(delay)

    return False
