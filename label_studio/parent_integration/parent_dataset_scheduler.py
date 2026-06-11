"""Background scheduler for parent dataset table synchronization."""

from __future__ import annotations

import logging
import os
import threading
from typing import Optional

from django.conf import settings
from django.db import OperationalError, close_old_connections, connections

from parent_integration.parent_dataset_sync import (
    parent_dataset_source_db,
    parent_dataset_db,
    sync_parent_dataset_tables,
)

logger = logging.getLogger(__name__)

_thread: Optional[threading.Thread] = None
_thread_lock = threading.Lock()
_stop_event = threading.Event()


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
        try:
            close_old_connections()
            stats = sync_parent_dataset_tables(dry_run=False, prune=prune)
            logger.info('[ParentDatasetSync] synced: %s', stats)
        except OperationalError as e:
            if 'server has gone away' in str(e).lower():
                for alias in (parent_dataset_source_db(), parent_dataset_db()):
                    logger.warning('[ParentDatasetSync] stale DB connection on alias=%s, reconnecting', alias)
                    try:
                        connections[alias].close()
                    except Exception:
                        logger.debug('[ParentDatasetSync] close connection failed', exc_info=True)
                try:
                    close_old_connections()
                    stats = sync_parent_dataset_tables(dry_run=False, prune=prune)
                    logger.info('[ParentDatasetSync] synced after reconnect: %s', stats)
                    _stop_event.wait(interval_seconds)
                    continue
                except Exception:
                    logger.exception('[ParentDatasetSync] retry after reconnect failed')
            else:
                logger.exception('[ParentDatasetSync] scheduled sync failed')
        except Exception:
            logger.exception('[ParentDatasetSync] scheduled sync failed')
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
