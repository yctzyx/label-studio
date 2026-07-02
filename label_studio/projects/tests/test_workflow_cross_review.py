"""Cross-review: prefer assigning review/accept to someone other than the annotator."""

from django.test import TestCase

from organizations.tests.factories import OrganizationFactory
from projects.tests.factories import ProjectFactory
from projects.workflow_models import ProjectTeamAllocation, ProjectTeamRole, TaskWorkflow, TaskWorkflowStage
from projects.workflow_services import pick_next_round_robin, submit_annotation_after_labeling
from tasks.models import Annotation
from tasks.tests.factories import TaskFactory
from users.tests.factories import UserFactory


class TestCrossReviewAssignment(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = OrganizationFactory()
        cls.project = ProjectFactory(organization=cls.org, task_workflow_enabled=True)

    def _add_label(self, user, percent=100):
        ProjectTeamAllocation.objects.create(
            project=self.project,
            user=user,
            role=ProjectTeamRole.LABEL,
            allocation_percent=percent,
        )

    def _add_review(self, user):
        ProjectTeamAllocation.objects.create(
            project=self.project,
            user=user,
            role=ProjectTeamRole.REVIEW,
            allocation_percent=0,
        )

    def test_prefers_other_reviewer_when_available(self):
        annotator = UserFactory(active_organization=self.org)
        other_reviewer = UserFactory(active_organization=self.org)
        self._add_label(annotator, 100)
        self._add_review(annotator)
        self._add_review(other_reviewer)

        task = TaskFactory(project=self.project)
        TaskWorkflow.objects.create(
            project=self.project,
            task=task,
            stage=TaskWorkflowStage.ANNOTATE,
            annotate_user_id=annotator.id,
            current_assignee_id=annotator.id,
        )
        Annotation.objects.create(task=task, project=self.project, completed_by=annotator, result=[])

        wf = submit_annotation_after_labeling(task.id, annotator)
        self.assertEqual(wf.stage, TaskWorkflowStage.REVIEW)
        self.assertEqual(wf.current_assignee_id, other_reviewer.id)

    def test_fallback_self_review_when_only_reviewer_is_annotator(self):
        solo = UserFactory(active_organization=self.org)
        self._add_label(solo, 100)
        self._add_review(solo)

        task = TaskFactory(project=self.project)
        TaskWorkflow.objects.create(
            project=self.project,
            task=task,
            stage=TaskWorkflowStage.ANNOTATE,
            annotate_user_id=solo.id,
            current_assignee_id=solo.id,
        )
        Annotation.objects.create(task=task, project=self.project, completed_by=solo, result=[])

        wf = submit_annotation_after_labeling(task.id, solo)
        self.assertEqual(wf.stage, TaskWorkflowStage.REVIEW)
        self.assertEqual(wf.current_assignee_id, solo.id)

    def test_round_robin_skips_excluded_then_advances(self):
        a = UserFactory(active_organization=self.org)
        b = UserFactory(active_organization=self.org)
        self._add_review(a)
        self._add_review(b)

        first = pick_next_round_robin(self.project, ProjectTeamRole.REVIEW, exclude_user_ids=[a.id])
        self.assertEqual(first.id, b.id)
        second = pick_next_round_robin(self.project, ProjectTeamRole.REVIEW, exclude_user_ids=[b.id])
        self.assertEqual(second.id, a.id)
