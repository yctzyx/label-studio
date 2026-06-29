"""Business logic for task workflow: distribute by %, round-robin review/accept, transitions."""

from __future__ import annotations

import math
from typing import Dict, List, Sequence

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import CharField, Q
from django.db.models.functions import Cast
from django.shortcuts import get_object_or_404
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


def pick_next_round_robin(project, role: str) -> User:
    """role is 'review' or 'accept'."""
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

    with transaction.atomic():
        settings, _ = ProjectWorkflowSettings.objects.select_for_update().get_or_create(
            project=project,
            defaults={'rr_review_index': 0, 'rr_accept_index': 0},
        )
        idx = getattr(settings, field)
        uid = pool[idx % len(pool)]
        setattr(settings, field, idx + 1)
        settings.save(update_fields=[field])

    return User.objects.get(pk=uid)


def get_task_workflow_or_404(task_id: int) -> TaskWorkflow:
    return get_object_or_404(
        TaskWorkflow.objects.select_related('task', 'project', 'annotate_user', 'current_assignee'),
        task_id=task_id,
    )


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
        reviewer = pick_next_round_robin(project, ProjectTeamRole.REVIEW)
        wf.stage = TaskWorkflowStage.REVIEW
        wf.current_assignee = reviewer
        wf.save(update_fields=['stage', 'current_assignee', 'returned_to_annotation', 'updated_at'])
        return wf

    if _accept_pool_ids(project):
        accepter = pick_next_round_robin(project, ProjectTeamRole.ACCEPT)
        wf.stage = TaskWorkflowStage.ACCEPT
        wf.current_assignee = accepter
        wf.save(update_fields=['stage', 'current_assignee', 'returned_to_annotation', 'updated_at'])
        return wf

    _mark_task_done(wf)
    return wf


def review_decision(task_id: int, user, approve: bool) -> TaskWorkflow:
    wf = get_task_workflow_or_404(task_id)
    project = wf.project
    if wf.stage != TaskWorkflowStage.REVIEW:
        raise ValidationError('Task is not in review stage')
    if wf.current_assignee_id != user.id:
        raise ValidationError('Not the current reviewer')

    if not approve:
        wf.stage = TaskWorkflowStage.ANNOTATE
        wf.current_assignee_id = wf.annotate_user_id
        wf.returned_to_annotation = True
        wf.save(update_fields=['stage', 'current_assignee_id', 'returned_to_annotation', 'updated_at'])
        return wf

    if _accept_pool_ids(project):
        accepter = pick_next_round_robin(project, ProjectTeamRole.ACCEPT)
        wf.stage = TaskWorkflowStage.ACCEPT
        wf.current_assignee = accepter
        wf.save(update_fields=['stage', 'current_assignee', 'updated_at'])
        return wf

    _mark_task_done(wf)
    return wf


def accept_decision(task_id: int, user, approve: bool) -> TaskWorkflow:
    wf = get_task_workflow_or_404(task_id)
    if wf.stage != TaskWorkflowStage.ACCEPT:
        raise ValidationError('Task is not in accept stage')
    if wf.current_assignee_id != user.id:
        raise ValidationError('Not the current acceptor')

    if not approve:
        wf.stage = TaskWorkflowStage.ANNOTATE
        wf.current_assignee_id = wf.annotate_user_id
        wf.returned_to_annotation = True
        wf.save(update_fields=['stage', 'current_assignee_id', 'returned_to_annotation', 'updated_at'])
        return wf

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
                    next_u = pick_next_round_robin(project, ProjectTeamRole.REVIEW)
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
                    next_u = pick_next_round_robin(project, ProjectTeamRole.ACCEPT)
                    wf.current_assignee_id = next_u.id
                    wf.save(update_fields=['current_assignee_id', 'updated_at'])
                    stats['accept_reassigned'] += 1
            elif review_pool:
                for wf in workflows:
                    wf.stage = TaskWorkflowStage.REVIEW
                    next_u = pick_next_round_robin(project, ProjectTeamRole.REVIEW)
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
            .select_related('workflow', 'project')
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
