"""批量获取预测结果的后台任务与进度跟踪（避免多任务同步请求超时）。"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from typing import Any

from django.db import close_old_connections
from tasks.models import Prediction, Task

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}
_active_job_by_project: dict[int, str] = {}


def _now() -> float:
    return time.time()


def _set_job(job_id: str, **patch: Any) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.update(patch)
        job['updated_at'] = _now()


def get_prediction_retrieval_job(project_id: int, job_id: str) -> dict[str, Any] | None:
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


def start_prediction_retrieval_job(project, task_ids: list[int]) -> str:
    """启动后台逐条预测任务，立即返回 job_id。"""
    from data_manager.functions import evaluate_predictions

    _cleanup_stale_jobs()
    project_id = project.pk
    task_ids = [int(t) for t in task_ids if t]

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
            'total': len(task_ids),
            'completed': 0,
            'predictions_created': 0,
            'detail': '排队中…',
            'error': '',
            'created_at': _now(),
            'updated_at': _now(),
        }
        _active_job_by_project[project_id] = job_id

    def _run() -> None:
        close_old_connections()
        _set_job(job_id, status='running', detail='正在获取预测结果…')
        created_total = 0
        try:
            for index, task_id in enumerate(task_ids, start=1):
                before = Prediction.objects.filter(task_id=task_id).count()
                queryset = Task.objects.filter(id=task_id, project_id=project_id)
                if queryset.exists():
                    evaluate_predictions(queryset)
                after = Prediction.objects.filter(task_id=task_id).count()
                created_total += max(0, after - before)
                _set_job(
                    job_id,
                    completed=index,
                    predictions_created=created_total,
                    detail=f'已完成 {index}/{len(task_ids)} 条任务',
                )
            _set_job(
                job_id,
                status='completed',
                predictions_created=created_total,
                detail=(
                    f'已成功为 {created_total} 条任务获取预测结果。'
                    if created_total
                    else '未生成任何预测结果，请检查 ML 服务与标注配置。'
                ),
            )
        except Exception as exc:
            logger.exception('prediction retrieval job failed: %s', exc)
            _set_job(
                job_id,
                status='failed',
                error=str(exc),
                detail='获取预测结果失败',
            )
        finally:
            with _lock:
                if _active_job_by_project.get(project_id) == job_id:
                    _active_job_by_project.pop(project_id, None)
            close_old_connections()

    threading.Thread(target=_run, name=f'prediction-retrieval-{project_id}-{job_id[:8]}', daemon=True).start()
    return job_id
