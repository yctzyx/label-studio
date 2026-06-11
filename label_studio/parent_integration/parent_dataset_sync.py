"""将父平台 data_database / md_data_set 同步到 Label Studio 本库镜像表。"""

from __future__ import annotations

import logging
from typing import Type

from django.conf import settings
from django.db import models, transaction

from parent_integration.models import DataDatabase, MdDataSet

logger = logging.getLogger(__name__)


def parent_dataset_db() -> str:
    return getattr(settings, 'PARENT_DATASET_DB', 'default') or 'default'


def parent_dataset_source_db() -> str:
    return getattr(settings, 'PARENT_DATASET_SOURCE_DB', 'default') or 'default'


def _field_defaults(instance: models.Model) -> dict:
    pk_name = instance._meta.pk.attname
    return {f.attname: getattr(instance, f.attname) for f in instance._meta.fields if f.attname != pk_name}


def _upsert_rows(
    model: Type[models.Model], source_db: str, target_db: str, chunk_size: int = 200
) -> tuple[int, int, int, int]:
    """返回 (upserted_count, source_row_count, created_count, updated_count)。"""
    created = 0
    updated = 0
    source_ids: list[int] = []

    qs = model.objects.using(source_db).all()
    for row in qs.iterator(chunk_size=chunk_size):
        source_ids.append(row.pk)
        defaults = _field_defaults(row)
        _, was_created = model.objects.using(target_db).update_or_create(pk=row.pk, defaults=defaults)
        if was_created:
            created += 1
        else:
            updated += 1

    return created + updated, len(source_ids), created, updated


def _prune_rows(model: Type[models.Model], target_db: str, keep_ids: list[int]) -> int:
    if not keep_ids:
        deleted, _ = model.objects.using(target_db).all().delete()
        return deleted
    qs = model.objects.using(target_db).exclude(pk__in=keep_ids)
    deleted, _ = qs.delete()
    return deleted


def sync_parent_dataset_tables(
    *,
    dry_run: bool = False,
    prune: bool = False,
) -> dict[str, int]:
    """
    从 PARENT_DATASET_SOURCE_DB 读取 data_database、md_data_set，写入 PARENT_DATASET_DB。
    dry_run 时在单事务内执行并回滚。
    """
    source_db = parent_dataset_source_db()
    target_db = parent_dataset_db()

    for alias in (source_db, target_db):
        if alias not in settings.DATABASES:
            raise ValueError(f'数据库别名 {alias!r} 不在 DATABASES 中')

    if source_db == target_db:
        raise ValueError(f'源库与目标库不能相同（均为 {source_db!r}）')

    stats: dict[str, int] = {
        'databases_upserted': 0,
        'databases_created': 0,
        'databases_updated': 0,
        'datasets_upserted': 0,
        'datasets_created': 0,
        'datasets_updated': 0,
        'databases_pruned': 0,
        'datasets_pruned': 0,
    }

    def do_writes() -> None:
        db_upserted, db_source_n, db_created, db_updated = _upsert_rows(
            DataDatabase, source_db, target_db
        )
        ds_upserted, ds_source_n, ds_created, ds_updated = _upsert_rows(
            MdDataSet, source_db, target_db
        )
        stats['databases_upserted'] = db_upserted
        stats['databases_created'] = db_created
        stats['databases_updated'] = db_updated
        stats['datasets_upserted'] = ds_upserted
        stats['datasets_created'] = ds_created
        stats['datasets_updated'] = ds_updated

        if prune:
            db_ids = list(DataDatabase.objects.using(source_db).values_list('id', flat=True))
            ds_ids = list(MdDataSet.objects.using(source_db).values_list('id', flat=True))
            stats['databases_pruned'] = _prune_rows(DataDatabase, target_db, db_ids)
            stats['datasets_pruned'] = _prune_rows(MdDataSet, target_db, ds_ids)

        logger.info(
            '[ParentDatasetSync] source=%s target=%s databases=%s/%s datasets=%s/%s prune=%s',
            source_db,
            target_db,
            db_upserted,
            db_source_n,
            ds_upserted,
            ds_source_n,
            prune,
        )

    with transaction.atomic(using=target_db):
        do_writes()
        if dry_run:
            transaction.set_rollback(True, using=target_db)

    return stats


def sync_parent_dataset_counts() -> dict[str, int]:
    """只读统计源库与本库行数。"""
    source_db = parent_dataset_source_db()
    target_db = parent_dataset_db()
    return {
        'source_databases': DataDatabase.objects.using(source_db).count(),
        'source_datasets': MdDataSet.objects.using(source_db).count(),
        'local_databases': DataDatabase.objects.using(target_db).count(),
        'local_datasets': MdDataSet.objects.using(target_db).count(),
    }
