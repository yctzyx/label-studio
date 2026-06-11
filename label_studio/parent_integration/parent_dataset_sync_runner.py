"""父平台数据集 S3 → Task 异步同步与进度跟踪。"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from typing import Any

from django.db import close_old_connections, transaction
from django.utils import timezone

from parent_integration.s3_sync import (
    build_s3_client,
    iter_object_keys,
    parse_type_code,
    task_data_for_parent_proxy,
)
from parent_integration.parent_dataset_context import binding_get, load_parent_dataset_context
from projects.models import Project
from tasks.models import Task

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}
_active_job_by_project: dict[int, str] = {}

LISTING_CAP_PERCENT = 30
CREATE_BASE_PERCENT = 30
CREATE_SPAN_PERCENT = 65
FINALIZE_PERCENT = 95


def _now() -> float:
    return time.time()


def _set_job(job_id: str, **patch: Any) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.update(patch)
        job['updated_at'] = _now()


def get_parent_dataset_sync_job(project_id: int, job_id: str) -> dict[str, Any] | None:
    with _lock:
        job = _jobs.get(job_id)
        if not job or job.get('project_id') != project_id:
            return None
        return dict(job)


def _cleanup_stale_jobs(max_age_seconds: int = 3600) -> None:
    cutoff = _now() - max_age_seconds
    with _lock:
        stale = [jid for jid, j in _jobs.items() if j.get('updated_at', 0) < cutoff]
        for jid in stale:
            pid = _jobs[jid].get('project_id')
            _jobs.pop(jid, None)
            if pid and _active_job_by_project.get(pid) == jid:
                _active_job_by_project.pop(pid, None)


def start_parent_dataset_sync_job(project: Project, *, max_tasks: int = 2000) -> str:
    """启动后台同步，返回 job_id。同一项目若已有运行中任务则返回既有 job_id。"""
    _cleanup_stale_jobs()
    project_id = project.pk

    with _lock:
        existing_id = _active_job_by_project.get(project_id)
        if existing_id:
            existing = _jobs.get(existing_id)
            if existing and existing.get('status') in ('queued', 'running'):
                return existing_id

    job_id = uuid.uuid4().hex
    with _lock:
        _jobs[job_id] = {
            'job_id': job_id,
            'project_id': project_id,
            'status': 'queued',
            'phase': 'preparing',
            'percent': 0,
            'discovered': 0,
            'total': 0,
            'processed': 0,
            'created': 0,
            'skipped': 0,
            'message': '准备同步…',
            'error': None,
            'result': None,
            'updated_at': _now(),
        }
        _active_job_by_project[project_id] = job_id

    thread = threading.Thread(
        target=_run_sync_job,
        args=(job_id, project_id, max_tasks),
        name=f'parent-dataset-sync-{project_id}-{job_id[:8]}',
        daemon=True,
    )
    thread.start()
    return job_id


def _run_sync_job(job_id: str, project_id: int, max_tasks: int) -> None:
    close_old_connections()
    try:
        _execute_sync(job_id, project_id, max_tasks)
    except Exception as e:
        logger.exception('[ParentDatasetSyncJob] failed job_id=%s project_id=%s', job_id, project_id)
        _set_job(
            job_id,
            status='failed',
            phase='failed',
            percent=0,
            message='同步失败',
            error=str(e),
        )
    finally:
        with _lock:
            if _active_job_by_project.get(project_id) == job_id:
                job = _jobs.get(job_id) or {}
                if job.get('status') in ('done', 'failed'):
                    _active_job_by_project.pop(project_id, None)
        close_old_connections()


def _execute_sync(job_id: str, project_id: int, max_tasks: int) -> None:
    _set_job(job_id, status='running', phase='preparing', percent=2, message='正在加载数据集配置…')

    project = Project.objects.get(pk=project_id)
    binding = project.parent_platform_dataset or {}
    dataset_id, source_id, md, db_row, prefix = load_parent_dataset_context(project)

    bucket = (db_row.bucket_name or '').strip()
    if not bucket:
        raise ValueError('data_database.bucket_name 为空')

    type_code = parse_type_code(md.data_set_type) or parse_type_code(
        binding_get(binding, 'data_set_type', 'dataSetType')
    )
    if type_code is None or type_code not in (1, 2, 3, 4, 5):
        type_code = 5

    client = build_s3_client(db_row)

    def on_discovered(_key: str, count: int) -> None:
        pct = min(LISTING_CAP_PERCENT, 5 + min(count, 500) * LISTING_CAP_PERCENT // 500)
        _set_job(
            job_id,
            phase='listing',
            percent=pct,
            discovered=count,
            message=f'正在扫描对象存储… 已发现 {count} 个文件',
        )

    _set_job(job_id, phase='listing', percent=5, message='正在连接对象存储并扫描文件…')
    keys = iter_object_keys(
        client,
        bucket,
        prefix,
        type_code,
        max_tasks * 2,
        on_key=on_discovered,
    )

    if not keys:
        result = {
            'created': 0,
            'skipped': 0,
            'message': '前缀下没有匹配类型的文件',
            'prefix': prefix,
            'bucket': bucket,
        }
        _set_job(
            job_id,
            status='done',
            phase='done',
            percent=100,
            total=0,
            processed=0,
            created=0,
            skipped=0,
            message='同步完成：没有可导入的文件',
            result=result,
        )
        return

    _set_job(
        job_id,
        phase='creating',
        percent=CREATE_BASE_PERCENT,
        total=len(keys),
        discovered=len(keys),
        processed=0,
        message=f'扫描完成，共 {len(keys)} 个文件，正在创建任务…',
    )

    existing = set(
        Task.objects.filter(project=project, meta__has_key='parent_s3_key').values_list(
            'meta__parent_s3_key', flat=True
        )
    )
    existing.discard(None)

    to_create: list[Task] = []
    skipped = 0
    processed = 0
    for key in keys:
        processed += 1
        if key in existing:
            skipped += 1
        elif len(to_create) < max_tasks:
            data = task_data_for_parent_proxy(type_code, project.id, key)
            meta = {'parent_s3_key': key, 'parent_dataset_id': dataset_id, 'parent_source_id': source_id}
            to_create.append(Task(project=project, data=data, meta=meta))

        if processed % 50 == 0 or processed == len(keys):
            pct = CREATE_BASE_PERCENT + int(CREATE_SPAN_PERCENT * processed / max(len(keys), 1))
            _set_job(
                job_id,
                processed=processed,
                skipped=skipped,
                created=len(to_create),
                percent=min(pct, CREATE_BASE_PERCENT + CREATE_SPAN_PERCENT),
                message=f'正在准备任务… {processed}/{len(keys)}',
            )

    if not to_create:
        result = {
            'created': 0,
            'skipped': skipped,
            'message': '没有新任务（可能已全部同步过）',
            'prefix': prefix,
            'bucket': bucket,
        }
        _set_job(
            job_id,
            status='done',
            phase='done',
            percent=100,
            processed=processed,
            skipped=skipped,
            created=0,
            message='同步完成：没有新任务需要创建',
            result=result,
        )
        _save_project_sync_meta(project, 0)
        return

    _set_job(job_id, phase='creating', percent=CREATE_BASE_PERCENT + CREATE_SPAN_PERCENT - 5, message='正在写入数据库…')
    batch_size = 500
    created_total = 0
    for offset in range(0, len(to_create), batch_size):
        batch = to_create[offset : offset + batch_size]
        with transaction.atomic():
            Task.objects.bulk_create(batch, batch_size=batch_size)
        created_total += len(batch)
        pct = CREATE_BASE_PERCENT + CREATE_SPAN_PERCENT - 5 + int(5 * created_total / max(len(to_create), 1))
        _set_job(
            job_id,
            created=created_total,
            percent=min(pct, FINALIZE_PERCENT),
            message=f'正在写入数据库… {created_total}/{len(to_create)}',
        )

    _set_job(job_id, phase='finalizing', percent=FINALIZE_PERCENT, message='正在更新项目统计…')
    key_list = [t.meta['parent_s3_key'] for t in to_create]
    new_tasks = Task.objects.filter(project=project, meta__parent_s3_key__in=key_list)
    project.update_tasks_counters_and_task_states(
        new_tasks,
        maximum_annotations_changed=False,
        overlap_cohort_percentage_changed=False,
        tasks_number_changed=True,
        from_scratch=True,
    )
    _save_project_sync_meta(project, len(to_create))

    result = {
        'created': len(to_create),
        'skipped': skipped,
        'prefix': prefix,
        'bucket': bucket,
        'type_code': type_code,
    }
    _set_job(
        job_id,
        status='done',
        phase='done',
        percent=100,
        processed=processed,
        created=len(to_create),
        skipped=skipped,
        message=f'同步完成，已新增 {len(to_create)} 条标注任务',
        result=result,
    )


def _save_project_sync_meta(project: Project, created: int) -> None:
    pp = dict(project.parent_platform_dataset) if project.parent_platform_dataset else {}
    pp['last_sync_at'] = timezone.now().isoformat()
    pp['last_sync_created'] = created
    project.parent_platform_dataset = pp
    project.save(update_fields=['parent_platform_dataset', 'updated_at'])
