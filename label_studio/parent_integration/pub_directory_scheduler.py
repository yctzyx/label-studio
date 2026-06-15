"""Background scheduler for pub directory synchronization."""

from __future__ import annotations

import logging
import os
import threading
from typing import Optional

from django.conf import settings

from parent_integration.pub_directory_sync import pub_directory_db, sync_pub_directory
from parent_integration.scheduler_utils import run_sync_with_retries

logger = logging.getLogger(__name__)

_thread: Optional[threading.Thread] = None
_thread_lock = threading.Lock()
_stop_event = threading.Event()


def _scheduler_loop(interval_seconds: int, prune_memberships: bool) -> None:
    logger.info(
        '[PubDirectorySync] scheduler started: interval=%ss, prune_memberships=%s, db=%s',
        interval_seconds,
        prune_memberships,
        pub_directory_db(),
    )
    # Delay first run to avoid DB access during Django initialization.
    _stop_event.wait(interval_seconds)
    while not _stop_event.is_set():
        run_sync_with_retries(
            'PubDirectorySync',
            lambda: sync_pub_directory(dry_run=False, prune_memberships=prune_memberships),
            db_aliases=(pub_directory_db(),),
            stop_event=_stop_event,
        )
        _stop_event.wait(interval_seconds)


def start_pub_directory_scheduler_once() -> None:
    """
    Start one background scheduler thread per process.

    Used by runserver startup to trigger periodic pub directory sync.
    """
    if not getattr(settings, 'PUB_DIRECTORY_SYNC_ENABLED', True):
        logger.info('[PubDirectorySync] scheduler disabled by PUB_DIRECTORY_SYNC_ENABLED=false')
        return
    # In runserver autoreload mode, parent process should not start background loops.
    if getattr(settings, 'DEBUG', False) and os.environ.get('RUN_MAIN') != 'true':
        return

    interval_seconds = max(10, int(getattr(settings, 'PUB_DIRECTORY_SYNC_INTERVAL_SECONDS', 60)))
    prune_memberships = bool(getattr(settings, 'PUB_DIRECTORY_SYNC_PRUNE_MEMBERSHIPS', False))

    global _thread
    with _thread_lock:
        if _thread and _thread.is_alive():
            return
        _stop_event.clear()
        _thread = threading.Thread(
            target=_scheduler_loop,
            args=(interval_seconds, prune_memberships),
            name='pub-directory-sync-scheduler',
            daemon=True,
        )
        _thread.start()
