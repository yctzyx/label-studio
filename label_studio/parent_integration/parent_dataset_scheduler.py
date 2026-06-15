"""Background scheduler for parent dataset table synchronization."""

from __future__ import annotations

import logging
import os
import threading
from typing import Optional

from django.conf import settings

from parent_integration.parent_dataset_sync import (
    parent_dataset_db,
    parent_dataset_source_db,
    sync_parent_dataset_tables,
)
from parent_integration.scheduler_utils import run_sync_with_retries

logger = logging.getLogger(__name__)

_thread: Optional[threading.Thread] = None
_thread_lock = threading.Lock()
_stop_event = threading.Event()


def _dataset_db_aliases() -> tuple[str, ...]:
    source_db = parent_dataset_source_db()
    target_db = parent_dataset_db()
    if source_db == target_db:
        return (source_db,)
    return (source_db, target_db)


def _scheduler_loop(interval_seconds: int, prune: bool) -> None:
    logger.info(
        '[ParentDatasetSync] scheduler started: interval=%ss, prune=%s, source=%s, target=%s',
        interval_seconds,
        prune,
        parent_dataset_source_db(),
        parent_dataset_db(),
    )
    _stop_event.wait(interval_seconds)
    while not _stop_event.is_set():
        run_sync_with_retries(
            'ParentDatasetSync',
            lambda: sync_parent_dataset_tables(dry_run=False, prune=prune),
            db_aliases=_dataset_db_aliases(),
            stop_event=_stop_event,
        )
        _stop_event.wait(interval_seconds)


def start_parent_dataset_scheduler_once() -> None:
    """Start one background scheduler thread per process."""
    if not getattr(settings, 'PARENT_DATASET_SYNC_ENABLED', True):
        logger.info('[ParentDatasetSync] scheduler disabled by PARENT_DATASET_SYNC_ENABLED=false')
        return
    if getattr(settings, 'DEBUG', False) and os.environ.get('RUN_MAIN') != 'true':
        return

    source_db = parent_dataset_source_db()
    target_db = parent_dataset_db()
    if source_db == target_db:
        logger.warning(
            '[ParentDatasetSync] skipped: source and target are both %r; configure PUB_DIRECTORY_MYSQL_* or PARENT_DATASET_SOURCE_DB',
            source_db,
        )
        return
    if source_db not in settings.DATABASES:
        logger.warning('[ParentDatasetSync] skipped: source db %r not in DATABASES', source_db)
        return

    interval_seconds = max(10, int(getattr(settings, 'PARENT_DATASET_SYNC_INTERVAL_SECONDS', 60)))
    prune = bool(getattr(settings, 'PARENT_DATASET_SYNC_PRUNE', False))

    global _thread
    with _thread_lock:
        if _thread and _thread.is_alive():
            return
        _stop_event.clear()
        _thread = threading.Thread(
            target=_scheduler_loop,
            args=(interval_seconds, prune),
            name='parent-dataset-sync-scheduler',
            daemon=True,
        )
        _thread.start()
