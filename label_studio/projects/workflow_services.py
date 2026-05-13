"""Business logic for task workflow: distribute by %, round-robin review/accept, transitions."""

from __future__ import annotations

import math
from typing import List, Sequence

from django.contrib.auth import get_user_model
from django.db import transaction
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
    wf.save(update_fields=['stage', 'current_assignee', 'updated_at'])
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

    if _review_pool_ids(project):
        reviewer = pick_next_round_robin(project, ProjectTeamRole.REVIEW)
        wf.stage = TaskWorkflowStage.REVIEW
        wf.current_assignee = reviewer
        wf.save(update_fields=['stage', 'current_assignee', 'updated_at'])
        return wf

    if _accept_pool_ids(project):
        accepter = pick_next_round_robin(project, ProjectTeamRole.ACCEPT)
        wf.stage = TaskWorkflowStage.ACCEPT
        wf.current_assignee = accepter
        wf.save(update_fields=['stage', 'current_assignee', 'updated_at'])
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
        wf.save(update_fields=['stage', 'current_assignee', 'updated_at'])
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
        wf.save(update_fields=['stage', 'current_assignee', 'updated_at'])
        return wf

    _mark_task_done(wf)
    return wf


def queryset_my_tasks(project, user, stage: str):
    """stage: annotate | review | accept"""
    from tasks.models import Task

    stage_map = {
        'annotate': TaskWorkflowStage.ANNOTATE,
        'review': TaskWorkflowStage.REVIEW,
        'accept': TaskWorkflowStage.ACCEPT,
    }
    if stage not in stage_map:
        raise ValidationError('Invalid stage filter')

    return Task.objects.filter(
        project=project,
        workflow__stage=stage_map[stage],
        workflow__current_assignee_id=user.id,
    ).select_related('workflow', 'project')
