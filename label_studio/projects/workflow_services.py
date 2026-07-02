"""Business logic for task workflow: distribute by %, round-robin review/accept, transitions."""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import CharField, Q
from django.db.models.functions import Cast
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from projects.workflow_models import (
    ProjectTeamAllocation,
    ProjectTeamRole,
    ProjectWorkflowSettings,
    TaskWorkflow,
    TaskWorkflowStage,
)
from tasks.models import Annotation

User = get_user_model()


def _label_allocations(project) -> List[ProjectTeamAllocation]:
    return list(
        ProjectTeamAllocation.objects.filter(project=project, role=ProjectTeamRole.LABEL)
        .select_related('user')
        .order_by('user_id')
    )


def allocate_integer_slots(n: int, weights: Sequence[float]) -> List[int]:
    """Largest remainder: split n integer slots across buckets with given positive weights."""
    if n == 0:
        return [0] * len(weights)
    if not weights:
        return []
    total_w = sum(weights) or 1.0
    exact = [n * w / total_w for w in weights]
    floors = [int(math.floor(x)) for x in exact]
    rem = n - sum(floors)
    order = sorted(range(len(weights)), key=lambda i: exact[i] - floors[i], reverse=True)
    for k in range(rem):
        floors[order[k % len(order)]] += 1
    return floors


def distribute_tasks_for_project(project) -> int:
    """
    Create TaskWorkflow for tasks that do not have one yet, assigning annotate_user by allocation %.
    Returns number of TaskWorkflow rows created.
    """
    if not project.task_workflow_enabled:
        project.task_workflow_enabled = True
        project.save(update_fields=['task_workflow_enabled'])

    allocs = _label_allocations(project)
    if not allocs:
        raise ValidationError('No label pool: add at least one user with label role and allocation %')

    weights = [float(a.allocation_percent) for a in allocs]
    if sum(weights) <= 0:
        raise ValidationError('Label allocation percents must sum to > 0')

    user_ids = [a.user_id for a in allocs]

    from tasks.models import Task

    existing = TaskWorkflow.objects.filter(project=project).values_list('task_id', flat=True)
    tasks = list(Task.objects.filter(project=project).exclude(id__in=existing).order_by('id'))
    n = len(tasks)
    if n == 0:
        return 0

    counts = allocate_integer_slots(n, weights)
    created = 0
    for idx, task in enumerate(tasks):
        uid = user_ids[0]
        offset = 0
        for i, c in enumerate(counts):
            if offset <= idx < offset + c:
                uid = user_ids[i]
                break
            offset += c
        TaskWorkflow.objects.create(
            task=task,
            project=project,
            stage=TaskWorkflowStage.ANNOTATE,
            annotate_user_id=uid,
            current_assignee_id=uid,
        )
        created += 1
    return created


def _review_pool_ids(project) -> List[int]:
    return list(
        ProjectTeamAllocation.objects.filter(project=project, role=ProjectTeamRole.REVIEW)
        .values_list('user_id', flat=True)
        .order_by('user_id')
    )


def _accept_pool_ids(project) -> List[int]:
    return list(
        ProjectTeamAllocation.objects.filter(project=project, role=ProjectTeamRole.ACCEPT)
        .values_list('user_id', flat=True)
        .order_by('user_id')
    )


def get_workflow_pipeline_config(project) -> Dict[str, bool]:
    """Whether review / accept stages are active (personnel configured for the project)."""
    if not getattr(project, 'task_workflow_enabled', False):
        return {'has_review': False, 'has_accept': False}

    roles = set(
        ProjectTeamAllocation.objects.filter(
            project=project,
            role__in=(ProjectTeamRole.REVIEW, ProjectTeamRole.ACCEPT),
        ).values_list('role', flat=True)
    )
    return {
        'has_review': ProjectTeamRole.REVIEW in roles,
        'has_accept': ProjectTeamRole.ACCEPT in roles,
    }


def _user_progress_row(user) -> Dict:
    return {
        'user_id': user.id,
        'username': user.username,
        'first_name': user.first_name or '',
        'last_name': user.last_name or '',
        'phone': getattr(user, 'phone', None) or '',
        'email': user.email or '',
    }


def _counts_by_field(qs, field: str) -> Dict[int, int]:
    from django.db.models import Count

    return {
        row[field]: int(row['c'])
        for row in qs.values(field).annotate(c=Count('task_id'))
        if row.get(field) is not None
    }


def get_workflow_progress_detail(project, stage: str) -> Dict:
    """Per-person workflow progress for label / review / accept stages."""
    from tasks.models import Task

    if stage not in ('label', 'review', 'accept'):
        raise ValidationError('Invalid stage (label|review|accept)')
    if not getattr(project, 'task_workflow_enabled', False):
        raise ValidationError('Workflow not enabled for this project')

    project_task_count = Task.objects.filter(project=project).count()
    wf_qs = TaskWorkflow.objects.filter(project=project)

    role_by_stage = {
        'label': ProjectTeamRole.LABEL,
        'review': ProjectTeamRole.REVIEW,
        'accept': ProjectTeamRole.ACCEPT,
    }
    role = role_by_stage[stage]
    allocations = list(
        ProjectTeamAllocation.objects.filter(project=project, role=role).select_related('user').order_by('user_id')
    )

    members = []
    if stage == 'label':
        assigned = _counts_by_field(wf_qs, 'annotate_user_id')
        completed = _counts_by_field(wf_qs.exclude(stage=TaskWorkflowStage.ANNOTATE), 'annotate_user_id')
        pending = _counts_by_field(wf_qs.filter(stage=TaskWorkflowStage.ANNOTATE), 'annotate_user_id')
        stage_completed_count = wf_qs.exclude(stage=TaskWorkflowStage.ANNOTATE).count()
        for alloc in allocations:
            uid = alloc.user_id
            row = _user_progress_row(alloc.user)
            row['assigned_task_count'] = assigned.get(uid, 0)
            row['completed_task_count'] = completed.get(uid, 0)
            row['pending_task_count'] = pending.get(uid, 0)
            members.append(row)
    elif stage == 'review':
        pending = _counts_by_field(
            wf_qs.filter(stage=TaskWorkflowStage.REVIEW, current_assignee_id__isnull=False),
            'current_assignee_id',
        )
        completed = _counts_by_field(wf_qs.filter(reviewed_by_id__isnull=False), 'reviewed_by_id')
        stage_completed_count = wf_qs.filter(stage__in=(TaskWorkflowStage.ACCEPT, TaskWorkflowStage.DONE)).count()
        for alloc in allocations:
            uid = alloc.user_id
            row = _user_progress_row(alloc.user)
            row['pending_task_count'] = pending.get(uid, 0)
            row['completed_task_count'] = completed.get(uid, 0)
            row['assigned_task_count'] = row['pending_task_count'] + row['completed_task_count']
            members.append(row)
    else:
        pending = _counts_by_field(
            wf_qs.filter(stage=TaskWorkflowStage.ACCEPT, current_assignee_id__isnull=False),
            'current_assignee_id',
        )
        completed = _counts_by_field(wf_qs.filter(accepted_by_id__isnull=False), 'accepted_by_id')
        stage_completed_count = wf_qs.filter(stage=TaskWorkflowStage.DONE).count()
        for alloc in allocations:
            uid = alloc.user_id
            row = _user_progress_row(alloc.user)
            row['pending_task_count'] = pending.get(uid, 0)
            row['completed_task_count'] = completed.get(uid, 0)
            row['assigned_task_count'] = row['pending_task_count'] + row['completed_task_count']
            members.append(row)

    return {
        'stage': stage,
        'project_task_count': project_task_count,
        'stage_completed_count': stage_completed_count,
        'members': members,
    }


def _cross_review_exclude_ids(wf: TaskWorkflow, role: str) -> List[int]:
    """Prefer excluding annotator (and reviewer for accept) from downstream assignment."""
    exclude: List[int] = []
    if wf.annotate_user_id:
        exclude.append(wf.annotate_user_id)
    if role == ProjectTeamRole.ACCEPT and wf.reviewed_by_id:
        exclude.append(wf.reviewed_by_id)
    return exclude


def pick_next_round_robin(
    project,
    role: str,
    *,
    exclude_user_ids: Optional[Sequence[int]] = None,
) -> User:
    """Pick the next user from the review or accept pool (round-robin).

    When ``exclude_user_ids`` is set (cross-review), skip those users while scanning the pool.
    If every pool member would be excluded — e.g. the only reviewer is also the annotator —
    fall back to the plain round-robin pick so the task still enters review/accept.
    """
    if role == ProjectTeamRole.REVIEW:
        pool = _review_pool_ids(project)
        field = 'rr_review_index'
    elif role == ProjectTeamRole.ACCEPT:
        pool = _accept_pool_ids(project)
        field = 'rr_accept_index'
    else:
        raise ValidationError('Invalid role for round-robin')

    if not pool:
        raise ValidationError(f'No users in {role} pool for this project')

    exclude = {uid for uid in (exclude_user_ids or []) if uid is not None}

    with transaction.atomic():
        settings, _ = ProjectWorkflowSettings.objects.select_for_update().get_or_create(
            project=project,
            defaults={'rr_review_index': 0, 'rr_accept_index': 0},
        )
        idx = getattr(settings, field)
        n = len(pool)
        chosen_uid = None
        next_idx = idx

        for offset in range(n):
            pos = (idx + offset) % n
            candidate = pool[pos]
            if candidate not in exclude:
                chosen_uid = candidate
                next_idx = (pos + 1) % n
                break

        if chosen_uid is None:
            # Cross-review impossible: allow self-review / self-accept so workflow does not stall.
            chosen_uid = pool[idx % n]
            next_idx = (idx + 1) % n

        setattr(settings, field, next_idx)
        settings.save(update_fields=[field])

    return User.objects.get(pk=chosen_uid)


def get_task_workflow_or_404(task_id: int) -> TaskWorkflow:
    return get_object_or_404(
        TaskWorkflow.objects.select_related(
            'task', 'project', 'annotate_user', 'current_assignee', 'last_rejected_by'
        ),
        task_id=task_id,
    )


REJECT_COMMENT_MAX_LENGTH = 500


def normalize_reject_comment(comment: str | None, *, required: bool) -> str | None:
    """Strip and validate workflow rejection comment."""
    text = (comment or '').strip()
    if required and not text:
        raise ValidationError('驳回时必须填写原因')
    if text and len(text) > REJECT_COMMENT_MAX_LENGTH:
        raise ValidationError(f'驳回原因不能超过{REJECT_COMMENT_MAX_LENGTH}字')
    return text or None


def serialize_workflow_for_api(wf: TaskWorkflow | None) -> dict | None:
    """JSON snapshot of workflow row for task APIs and detail endpoints."""
    if wf is None:
        return None
    payload = {
        'stage': wf.stage,
        'current_assignee_id': wf.current_assignee_id,
        'annotate_user_id': wf.annotate_user_id,
        'returned_to_annotation': bool(wf.returned_to_annotation),
    }
    if wf.returned_to_annotation:
        payload['last_reject_reason'] = wf.last_reject_reason
        if wf.last_rejected_at:
            payload['last_rejected_at'] = wf.last_rejected_at.isoformat()
        if wf.last_rejected_by_id:
            payload['last_rejected_by'] = {
                'id': wf.last_rejected_by_id,
                'username': wf.last_rejected_by.username if wf.last_rejected_by else None,
            }
    return payload


def _return_task_to_annotate(wf: TaskWorkflow, *, rejected_by, comment: str | None) -> TaskWorkflow:
    wf.stage = TaskWorkflowStage.ANNOTATE
    wf.current_assignee_id = wf.annotate_user_id
    wf.returned_to_annotation = True
    wf.last_reject_reason = comment
    wf.last_rejected_at = timezone.now()
    wf.last_rejected_by = rejected_by
    wf.save(
        update_fields=[
            'stage',
            'current_assignee_id',
            'returned_to_annotation',
            'last_reject_reason',
            'last_rejected_at',
            'last_rejected_by',
            'updated_at',
        ]
    )
    task = wf.task
    if task and task.is_labeled:
        task.is_labeled = False
        task.save(update_fields=['is_labeled', 'updated_at'])
    return wf


def _mark_task_done(wf: TaskWorkflow) -> None:
    """Set the workflow row to done and ensure the task is_labeled flag is up to date."""
    wf.stage = TaskWorkflowStage.DONE
    wf.current_assignee = None
    wf.returned_to_annotation = False
    wf.save(update_fields=['stage', 'current_assignee', 'returned_to_annotation', 'updated_at'])
    task = wf.task
    if task and not task.is_labeled:
        task.is_labeled = True
        task.save(update_fields=['is_labeled', 'updated_at'])


def submit_annotation_after_labeling(task_id: int, user) -> TaskWorkflow:
    """After annotator saved annotation: move forward in the workflow.

    Default flow: ``annotate -> review (round-robin) -> accept (round-robin) -> done``.
    If a downstream pool (review or accept) is empty, the corresponding stage is skipped so
    the task does not get stuck in the annotate stage forever. When neither review nor accept
    pool is configured, the task is marked as ``done`` directly.
    """
    wf = get_task_workflow_or_404(task_id)
    project = wf.project
    if not project.task_workflow_enabled:
        raise ValidationError('Workflow not enabled')
    if wf.stage != TaskWorkflowStage.ANNOTATE:
        raise ValidationError('Task is not in annotate stage')
    if wf.current_assignee_id != user.id:
        raise ValidationError('Not the current assignee for this task')
    if not Annotation.objects.filter(
        task_id=task_id, completed_by_id=user.id, was_cancelled=False
    ).exists():
        raise ValidationError('Submit at least one non-cancelled annotation first')

    wf.returned_to_annotation = False

    if _review_pool_ids(project):
        reviewer = pick_next_round_robin(
            project,
            ProjectTeamRole.REVIEW,
            exclude_user_ids=_cross_review_exclude_ids(wf, ProjectTeamRole.REVIEW),
        )
        wf.stage = TaskWorkflowStage.REVIEW
        wf.current_assignee = reviewer
        wf.save(update_fields=['stage', 'current_assignee', 'returned_to_annotation', 'updated_at'])
        return wf

    if _accept_pool_ids(project):
        accepter = pick_next_round_robin(
            project,
            ProjectTeamRole.ACCEPT,
            exclude_user_ids=_cross_review_exclude_ids(wf, ProjectTeamRole.ACCEPT),
        )
        wf.stage = TaskWorkflowStage.ACCEPT
        wf.current_assignee = accepter
        wf.save(update_fields=['stage', 'current_assignee', 'returned_to_annotation', 'updated_at'])
        return wf

    _mark_task_done(wf)
    return wf


def review_decision(task_id: int, user, approve: bool, *, comment: str | None = None) -> TaskWorkflow:
    wf = get_task_workflow_or_404(task_id)
    project = wf.project
    if wf.stage != TaskWorkflowStage.REVIEW:
        raise ValidationError('Task is not in review stage')
    if wf.current_assignee_id != user.id:
        raise ValidationError('Not the current reviewer')

    if not approve:
        normalized = normalize_reject_comment(comment, required=True)
        return _return_task_to_annotate(wf, rejected_by=user, comment=normalized)

    wf.reviewed_by = user
    if _accept_pool_ids(project):
        accepter = pick_next_round_robin(
            project,
            ProjectTeamRole.ACCEPT,
            exclude_user_ids=_cross_review_exclude_ids(wf, ProjectTeamRole.ACCEPT),
        )
        wf.stage = TaskWorkflowStage.ACCEPT
        wf.current_assignee = accepter
        wf.save(update_fields=['stage', 'current_assignee', 'reviewed_by', 'updated_at'])
        return wf

    wf.save(update_fields=['reviewed_by', 'updated_at'])
    _mark_task_done(wf)
    return wf


def accept_decision(task_id: int, user, approve: bool, *, comment: str | None = None) -> TaskWorkflow:
    wf = get_task_workflow_or_404(task_id)
    if wf.stage != TaskWorkflowStage.ACCEPT:
        raise ValidationError('Task is not in accept stage')
    if wf.current_assignee_id != user.id:
        raise ValidationError('Not the current acceptor')

    if not approve:
        normalized = normalize_reject_comment(comment, required=True)
        return _return_task_to_annotate(wf, rejected_by=user, comment=normalized)

    wf.accepted_by = user
    wf.save(update_fields=['accepted_by', 'updated_at'])
    _mark_task_done(wf)
    return wf


def release_workflows_after_team_allocation_removed(project, removed_user_id: int, role: str) -> Dict[str, int]:
    """
    Call **after** deleting the ``ProjectTeamAllocation`` row so pools exclude the removed user.

    - **label**: Delete workflow rows still in ``annotate`` owned by this annotator → tasks become
      undistributed and can receive new rows on the next ``distribute_tasks_for_project``.
    - **review**: Reassign ``current_assignee`` for tasks in ``review`` waiting on this user;
      if no reviewers remain, send tasks back to ``annotate`` / ``annotate_user``.
    - **accept**: Same pattern for ``accept`` stage; if no accept pool, fall back to ``review`` or ``annotate``.
    - **admin**: No workflow rows tied to admin role — no-op.

    Returns coarse counters for observability (best-effort).
    """
    stats = {'annotate_workflows_deleted': 0, 'review_reassigned': 0, 'accept_reassigned': 0}

    if role == ProjectTeamRole.ADMIN:
        return stats

    if role == ProjectTeamRole.LABEL:
        total_deleted, _ = TaskWorkflow.objects.filter(
            project=project,
            annotate_user_id=removed_user_id,
            stage=TaskWorkflowStage.ANNOTATE,
        ).delete()
        stats['annotate_workflows_deleted'] = total_deleted
        return stats

    if role == ProjectTeamRole.REVIEW:
        with transaction.atomic():
            workflows = list(
                TaskWorkflow.objects.select_for_update().filter(
                    project=project,
                    stage=TaskWorkflowStage.REVIEW,
                    current_assignee_id=removed_user_id,
                )
            )
            pool = _review_pool_ids(project)
            if pool:
                for wf in workflows:
                    next_u = pick_next_round_robin(
                        project,
                        ProjectTeamRole.REVIEW,
                        exclude_user_ids=_cross_review_exclude_ids(wf, ProjectTeamRole.REVIEW),
                    )
                    wf.current_assignee_id = next_u.id
                    wf.save(update_fields=['current_assignee_id', 'updated_at'])
                    stats['review_reassigned'] += 1
            else:
                for wf in workflows:
                    wf.stage = TaskWorkflowStage.ANNOTATE
                    wf.current_assignee_id = wf.annotate_user_id
                    wf.returned_to_annotation = False
                    wf.save(update_fields=['stage', 'current_assignee_id', 'returned_to_annotation', 'updated_at'])
                    stats['review_reassigned'] += 1
        return stats

    if role == ProjectTeamRole.ACCEPT:
        with transaction.atomic():
            workflows = list(
                TaskWorkflow.objects.select_for_update().filter(
                    project=project,
                    stage=TaskWorkflowStage.ACCEPT,
                    current_assignee_id=removed_user_id,
                )
            )
            accept_pool = _accept_pool_ids(project)
            review_pool = _review_pool_ids(project)
            if accept_pool:
                for wf in workflows:
                    next_u = pick_next_round_robin(
                        project,
                        ProjectTeamRole.ACCEPT,
                        exclude_user_ids=_cross_review_exclude_ids(wf, ProjectTeamRole.ACCEPT),
                    )
                    wf.current_assignee_id = next_u.id
                    wf.save(update_fields=['current_assignee_id', 'updated_at'])
                    stats['accept_reassigned'] += 1
            elif review_pool:
                for wf in workflows:
                    wf.stage = TaskWorkflowStage.REVIEW
                    next_u = pick_next_round_robin(
                        project,
                        ProjectTeamRole.REVIEW,
                        exclude_user_ids=_cross_review_exclude_ids(wf, ProjectTeamRole.REVIEW),
                    )
                    wf.current_assignee_id = next_u.id
                    wf.save(update_fields=['stage', 'current_assignee_id', 'updated_at'])
                    stats['accept_reassigned'] += 1
            else:
                for wf in workflows:
                    wf.stage = TaskWorkflowStage.ANNOTATE
                    wf.current_assignee_id = wf.annotate_user_id
                    wf.returned_to_annotation = False
                    wf.save(update_fields=['stage', 'current_assignee_id', 'returned_to_annotation', 'updated_at'])
                    stats['accept_reassigned'] += 1
        return stats

    return stats


def _apply_my_tasks_pipeline_status(qs, status: str):
    """Filter Task queryset by coarse pipeline UI status (workflow-enabled tasks only)."""
    if status == 'annotating':
        return qs.filter(
            workflow__stage=TaskWorkflowStage.ANNOTATE,
            workflow__returned_to_annotation=False,
        )
    if status == 'rejected':
        return qs.filter(
            workflow__stage=TaskWorkflowStage.ANNOTATE,
            workflow__returned_to_annotation=True,
        )
    if status == 'in_review':
        return qs.filter(workflow__stage=TaskWorkflowStage.REVIEW)
    if status == 'in_accept':
        return qs.filter(workflow__stage=TaskWorkflowStage.ACCEPT)
    if status == 'done':
        return qs.filter(workflow__stage=TaskWorkflowStage.DONE)
    return qs


def queryset_my_tasks(project, user, stage: str, *, search: str | None = None, status: str | None = None):
    """stage: annotate | review | accept

    Optional filters (AND):
    - search: match task id substring and/or task.data JSON text (same intent as DM quick search)
    - status: annotating | rejected | in_review | in_accept | done (workflow-enabled); legacy without row uses is_labeled for done vs annotating

    Annotate tab: tasks where this user is ``annotate_user`` (assigned labeler). Includes rows still in
    annotate stage (must usually also be ``current_assignee``), and rows already moved to
    review/accept/done after submit — so labelers still see completed / downstream tasks.
    Review/accept tabs: tasks currently in that stage with ``current_assignee`` = user.
    """
    from tasks.models import Task

    stage_map = {
        'annotate': TaskWorkflowStage.ANNOTATE,
        'review': TaskWorkflowStage.REVIEW,
        'accept': TaskWorkflowStage.ACCEPT,
    }
    if stage not in stage_map:
        raise ValidationError('Invalid stage filter')

    allowed_status = (
        None,
        '',
        'annotating',
        'rejected',
        'in_review',
        'in_accept',
        'done',
    )
    if status not in allowed_status:
        raise ValidationError('Invalid status filter (annotating|rejected|in_review|in_accept|done)')

    if stage == 'annotate':
        qs = (
            Task.objects.filter(project=project, workflow__annotate_user_id=user.id)
            .filter(
                Q(~Q(workflow__stage=TaskWorkflowStage.ANNOTATE))
                | Q(workflow__current_assignee_id=user.id)
            )
            .select_related('workflow', 'workflow__last_rejected_by', 'project')
        )
    else:
        qs = Task.objects.filter(
            project=project,
            workflow__stage=stage_map[stage],
            workflow__current_assignee_id=user.id,
        ).select_related('workflow', 'project')

    if search:
        term = search.strip()
        if term:
            qs = qs.annotate(_mt_id_text=Cast('id', output_field=CharField())).filter(
                Q(_mt_id_text__icontains=term) | Q(data__icontains=term)
            )

    if status:
        if project.task_workflow_enabled:
            qs = _apply_my_tasks_pipeline_status(qs, status)
        elif status == 'done':
            qs = qs.filter(is_labeled=True)
        elif status == 'annotating':
            qs = qs.filter(is_labeled=False)
        else:
            qs = qs.none()

    return qs


def apply_workflow_queue_filter(queryset, request, prepare_params):
    """Restrict a DM task queryset to the current user's my-tasks queue when workflow_queue is set.

    Used by Explorer/labeling sidebar so entries from /my-tasks only list the user's own tasks.
    Without workflow_queue, the queryset is returned unchanged.
    """
    if prepare_params is None or getattr(prepare_params, 'is_multi_project', False):
        return queryset

    workflow_queue = request.GET.get('workflow_queue')
    if not workflow_queue and hasattr(request, 'data'):
        workflow_queue = request.data.get('workflow_queue')
    if not workflow_queue or not str(workflow_queue).strip():
        return queryset

    stage = str(workflow_queue).strip()
    if stage not in ('annotate', 'review', 'accept'):
        return queryset.none()

    project_id = prepare_params.project
    project = project_id if hasattr(project_id, 'task_workflow_enabled') else None
    if project is None:
        from projects.models import Project

        project = Project.objects.get(pk=project_id)

    if not project.task_workflow_enabled:
        return queryset

    my_tasks = queryset_my_tasks(project, request.user, stage)
    return queryset.filter(id__in=my_tasks.values('id'))


def default_annotation_id_for_stream(task, user) -> int | None:
    """Latest non-cancelled annotation by ``user`` on ``task`` for workflow annotate stream resume."""
    ann = (
        Annotation.objects.filter(task=task, completed_by=user, was_cancelled=False)
        .order_by('-updated_at', '-id')
        .values_list('id', flat=True)
        .first()
    )
    return ann


def workflow_stream_next_task(project, user, stage: str):
    """Get the next task for workflow stream mode (one at a time, ordered by task id).

    stage: annotate | review | accept
    Returns Task or None.
    """
    from tasks.models import Task

    if stage == 'annotate':
        qs = Task.objects.filter(
            project=project,
            workflow__stage=TaskWorkflowStage.ANNOTATE,
            workflow__current_assignee_id=user.id,
        ).select_related('workflow', 'project').order_by('id')
    elif stage == 'review':
        qs = Task.objects.filter(
            project=project,
            workflow__stage=TaskWorkflowStage.REVIEW,
            workflow__current_assignee_id=user.id,
        ).select_related('workflow', 'project').order_by('id')
    elif stage == 'accept':
        qs = Task.objects.filter(
            project=project,
            workflow__stage=TaskWorkflowStage.ACCEPT,
            workflow__current_assignee_id=user.id,
        ).select_related('workflow', 'project').order_by('id')
    else:
        raise ValidationError('Invalid stream stage (annotate|review|accept)')

    return qs.first()
