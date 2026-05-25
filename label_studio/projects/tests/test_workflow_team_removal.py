"""Removing project team allocations releases or reassigns task_workflow rows."""

from django.test import TestCase

from projects.tests.factories import ProjectFactory
from projects.workflow_models import ProjectTeamAllocation, ProjectTeamRole, TaskWorkflow, TaskWorkflowStage
from projects.workflow_services import distribute_tasks_for_project, release_workflows_after_team_allocation_removed
from tasks.tests.factories import TaskFactory
from users.tests.factories import UserFactory


class TestReleaseWorkflowsAfterTeamRemoval(TestCase):
    def test_remove_label_deletes_annotate_workflows_for_that_annotator_then_redistribute(self):
        project = ProjectFactory(task_workflow_enabled=True)
        u1 = UserFactory()
        u2 = UserFactory()
        ProjectTeamAllocation.objects.create(
            project=project, user=u1, role=ProjectTeamRole.LABEL, allocation_percent=50
        )
        ProjectTeamAllocation.objects.create(
            project=project, user=u2, role=ProjectTeamRole.LABEL, allocation_percent=50
        )
        task = TaskFactory(project=project)
        TaskWorkflow.objects.create(
            task=task,
            project=project,
            stage=TaskWorkflowStage.ANNOTATE,
            annotate_user_id=u1.id,
            current_assignee_id=u1.id,
        )

        ProjectTeamAllocation.objects.filter(project=project, user=u1, role=ProjectTeamRole.LABEL).delete()
        stats = release_workflows_after_team_allocation_removed(project, u1.id, ProjectTeamRole.LABEL)
        self.assertEqual(stats['annotate_workflows_deleted'], 1)
        self.assertFalse(TaskWorkflow.objects.filter(task=task).exists())

        created = distribute_tasks_for_project(project)
        self.assertEqual(created, 1)
        wf = TaskWorkflow.objects.get(task=task)
        self.assertEqual(wf.stage, TaskWorkflowStage.ANNOTATE)
        self.assertEqual(wf.annotate_user_id, u2.id)

    def test_remove_review_reassigns_to_another_reviewer(self):
        project = ProjectFactory(task_workflow_enabled=True)
        ann = UserFactory()
        r1 = UserFactory()
        r2 = UserFactory()
        ProjectTeamAllocation.objects.create(
            project=project, user=ann, role=ProjectTeamRole.LABEL, allocation_percent=100
        )
        ProjectTeamAllocation.objects.create(
            project=project, user=r1, role=ProjectTeamRole.REVIEW, allocation_percent=0
        )
        ProjectTeamAllocation.objects.create(
            project=project, user=r2, role=ProjectTeamRole.REVIEW, allocation_percent=0
        )
        task = TaskFactory(project=project)
        TaskWorkflow.objects.create(
            task=task,
            project=project,
            stage=TaskWorkflowStage.REVIEW,
            annotate_user_id=ann.id,
            current_assignee_id=r1.id,
        )

        ProjectTeamAllocation.objects.filter(project=project, user=r1, role=ProjectTeamRole.REVIEW).delete()
        release_workflows_after_team_allocation_removed(project, r1.id, ProjectTeamRole.REVIEW)

        wf = TaskWorkflow.objects.get(task=task)
        self.assertEqual(wf.stage, TaskWorkflowStage.REVIEW)
        self.assertEqual(wf.current_assignee_id, r2.id)
