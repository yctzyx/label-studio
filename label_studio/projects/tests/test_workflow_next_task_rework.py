"""Rejected (rework) tasks must appear in the label stream for the assigned annotator."""

from django.test import TestCase

from projects.functions.next_task import get_next_task, get_not_solved_tasks_qs
from projects.tests.factories import ProjectFactory
from projects.workflow_models import TaskWorkflow, TaskWorkflowStage
from tasks.models import Annotation
from tasks.tests.factories import TaskFactory
from users.tests.factories import UserFactory


class TestWorkflowReworkInNextTask(TestCase):
    def test_rework_task_in_not_solved_despite_prior_annotation_and_is_labeled(self):
        project = ProjectFactory(task_workflow_enabled=True)
        user = UserFactory()
        task = TaskFactory(project=project, is_labeled=True)
        Annotation.objects.create(task=task, project=project, completed_by=user, result=[])
        TaskWorkflow.objects.create(
            task=task,
            project=project,
            stage=TaskWorkflowStage.ANNOTATE,
            annotate_user_id=user.id,
            current_assignee_id=user.id,
            returned_to_annotation=True,
        )

        prepared = project.tasks.all()
        not_solved, _, _, _ = get_not_solved_tasks_qs(user, project, prepared, assigned_flag=False, queue_info='')

        self.assertIn(task.pk, list(not_solved.values_list('pk', flat=True)))

    def test_get_next_task_prefers_rework_queue(self):
        project = ProjectFactory(task_workflow_enabled=True)
        user = UserFactory()
        other_user = UserFactory()

        fresh = TaskFactory(project=project, is_labeled=False)
        TaskWorkflow.objects.create(
            task=fresh,
            project=project,
            stage=TaskWorkflowStage.ANNOTATE,
            annotate_user_id=other_user.id,
            current_assignee_id=other_user.id,
        )

        rework = TaskFactory(project=project, is_labeled=True)
        Annotation.objects.create(task=rework, project=project, completed_by=user, result=[])
        TaskWorkflow.objects.create(
            task=rework,
            project=project,
            stage=TaskWorkflowStage.ANNOTATE,
            annotate_user_id=user.id,
            current_assignee_id=user.id,
            returned_to_annotation=True,
        )

        prepared = project.tasks.filter(pk=rework.pk)
        next_task, queue_info = get_next_task(user, prepared, project, dm_queue=False)

        self.assertEqual(next_task.pk, rework.pk)
        self.assertIn('Workflow rework queue', queue_info)
