"""Workflow reject reason stored on TaskWorkflow and exposed via review/accept APIs."""

from django.test import TestCase
from django.urls import reverse
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from organizations.tests.factories import OrganizationFactory
from projects.tests.factories import ProjectFactory
from projects.workflow_models import ProjectTeamAllocation, ProjectTeamRole, TaskWorkflow, TaskWorkflowStage
from projects.workflow_services import accept_decision, review_decision, submit_annotation_after_labeling
from tasks.models import Annotation
from tasks.tests.factories import TaskFactory
from users.tests.factories import UserFactory


class TestWorkflowRejectReason(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = OrganizationFactory()
        cls.project = ProjectFactory(organization=cls.org, task_workflow_enabled=True)
        cls.annotator = UserFactory(active_organization=cls.org)
        cls.reviewer = UserFactory(active_organization=cls.org)
        cls.acceptor = UserFactory(active_organization=cls.org)
        ProjectTeamAllocation.objects.create(
            project=cls.project, user=cls.reviewer, role=ProjectTeamRole.REVIEW, allocation_percent=0
        )
        ProjectTeamAllocation.objects.create(
            project=cls.project, user=cls.acceptor, role=ProjectTeamRole.ACCEPT, allocation_percent=0
        )

    def _task_in_review(self):
        task = TaskFactory(project=self.project, is_labeled=True)
        Annotation.objects.create(task=task, project=self.project, completed_by=self.annotator, result=[])
        wf = TaskWorkflow.objects.create(
            task=task,
            project=self.project,
            stage=TaskWorkflowStage.REVIEW,
            annotate_user_id=self.annotator.id,
            current_assignee_id=self.reviewer.id,
        )
        return task, wf

    def test_review_reject_stores_comment(self):
        task, wf = self._task_in_review()
        review_decision(task.id, self.reviewer, approve=False, comment='  漏标区域  ')
        wf.refresh_from_db()
        self.assertEqual(wf.stage, TaskWorkflowStage.ANNOTATE)
        self.assertTrue(wf.returned_to_annotation)
        self.assertEqual(wf.last_reject_reason, '漏标区域')
        self.assertEqual(wf.last_rejected_by_id, self.reviewer.id)
        self.assertIsNotNone(wf.last_rejected_at)
        task.refresh_from_db()
        self.assertFalse(task.is_labeled)

    def test_review_reject_requires_comment(self):
        task, _ = self._task_in_review()
        with self.assertRaises(ValidationError):
            review_decision(task.id, self.reviewer, approve=False, comment='   ')

    def test_resubmit_clears_returned_flag_keeps_reason(self):
        task, wf = self._task_in_review()
        review_decision(task.id, self.reviewer, approve=False, comment='需修改')
        wf.refresh_from_db()
        wf.current_assignee_id = self.annotator.id
        wf.save(update_fields=['current_assignee_id'])
        submit_annotation_after_labeling(task.id, self.annotator)
        wf.refresh_from_db()
        self.assertFalse(wf.returned_to_annotation)
        self.assertEqual(wf.last_reject_reason, '需修改')

    def test_review_api_reject_with_comment(self):
        task, _ = self._task_in_review()
        client = APIClient()
        client.force_authenticate(user=self.reviewer)
        url = reverse('tasks:api:task-workflow-review', kwargs={'pk': task.id})
        res = client.post(url, {'approve': False, 'comment': '类别错误'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['workflow']['last_reject_reason'], '类别错误')

    def test_accept_reject_stores_comment(self):
        task = TaskFactory(project=self.project, is_labeled=True)
        Annotation.objects.create(task=task, project=self.project, completed_by=self.annotator, result=[])
        wf = TaskWorkflow.objects.create(
            task=task,
            project=self.project,
            stage=TaskWorkflowStage.ACCEPT,
            annotate_user_id=self.annotator.id,
            current_assignee_id=self.acceptor.id,
        )
        accept_decision(task.id, self.acceptor, approve=False, comment='验收不通过')
        wf.refresh_from_db()
        self.assertEqual(wf.last_reject_reason, '验收不通过')
        self.assertEqual(wf.stage, TaskWorkflowStage.ANNOTATE)
