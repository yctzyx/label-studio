"""Task workflow: proportional label assignment, review/accept round-robin pools, reject → annotator."""

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _


class ProjectTeamRole(models.TextChoices):
    LABEL = 'label', _('Label')
    REVIEW = 'review', _('Review')
    ACCEPT = 'accept', _('Accept')
    ADMIN = 'admin', _('Admin')


class TaskWorkflowStage(models.TextChoices):
    ANNOTATE = 'annotate', _('Annotate')
    REVIEW = 'review', _('Review')
    ACCEPT = 'accept', _('Accept')
    DONE = 'done', _('Done')


class ProjectWorkflowSettings(models.Model):
    """Round-robin cursors for review / accept pools (per project)."""

    project = models.OneToOneField(
        'projects.Project',
        on_delete=models.CASCADE,
        related_name='workflow_settings',
        primary_key=True,
    )
    rr_review_index = models.PositiveIntegerField(default=0)
    rr_accept_index = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = 'project_workflow_settings'


class ProjectTeamAllocation(models.Model):
    """Per-project assignments: label (with %), review pool, accept pool, admin."""

    project = models.ForeignKey('projects.Project', on_delete=models.CASCADE, related_name='team_allocations')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='project_team_allocations')
    role = models.CharField(max_length=16, choices=ProjectTeamRole.choices, db_index=True)
    allocation_percent = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        default=0,
        help_text='Label share for distribution (0–100); ignored for non-label roles',
    )

    class Meta:
        db_table = 'project_team_allocation'
        constraints = [
            models.UniqueConstraint(fields=['project', 'user', 'role'], name='uniq_project_user_team_role'),
        ]


class TaskWorkflow(models.Model):
    """One row per task when project.task_workflow_enabled."""

    task = models.OneToOneField(
        'tasks.Task',
        on_delete=models.CASCADE,
        related_name='workflow',
        primary_key=True,
    )
    project = models.ForeignKey('projects.Project', on_delete=models.CASCADE, related_name='task_workflows')
    stage = models.CharField(max_length=16, choices=TaskWorkflowStage.choices, db_index=True)
    annotate_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='+',
        help_text='Annotator; reject returns here',
    )
    current_assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='+',
        help_text='Who must act at the current stage (null when done)',
    )
    returned_to_annotation = models.BooleanField(
        default=False,
        help_text='True after review/accept rejection sent task back to annotator; cleared when annotator resubmits',
    )
    last_reject_reason = models.TextField(
        null=True,
        blank=True,
        help_text='Most recent review/accept rejection comment for the annotator',
    )
    last_rejected_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text='When the task was last rejected back to annotate',
    )
    last_rejected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='+',
        help_text='User who last rejected the task to annotate',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'task_workflow'
