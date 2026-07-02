"""Workflow progress detail API for project cards."""

from django.urls import reverse
from rest_framework.test import APITestCase

from organizations.tests.factories import OrganizationFactory
from projects.tests.factories import ProjectFactory
from projects.workflow_models import ProjectTeamAllocation, ProjectTeamRole, TaskWorkflow, TaskWorkflowStage
from projects.workflow_services import get_workflow_progress_detail, review_decision
from tasks.models import Annotation
from tasks.tests.factories import TaskFactory
from users.tests.factories import UserFactory


class TestWorkflowProgressDetail(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = OrganizationFactory()
        cls.annotator = UserFactory(
            active_organization=cls.org,
            first_name='标注',
            last_name='员',
            username='13800000001',
        )
        cls.reviewer = UserFactory(
            active_organization=cls.org,
            first_name='审核',
            last_name='员',
            username='13800000002',
        )
        cls.project = ProjectFactory(
            organization=cls.org,
            task_workflow_enabled=True,
            created_by=cls.annotator,
        )
        ProjectTeamAllocation.objects.create(
            project=cls.project,
            user=cls.annotator,
            role=ProjectTeamRole.LABEL,
            allocation_percent=100,
        )
        ProjectTeamAllocation.objects.create(
            project=cls.project,
            user=cls.reviewer,
            role=ProjectTeamRole.REVIEW,
            allocation_percent=0,
        )

    def test_label_progress_counts(self):
        task_done = TaskFactory(project=self.project)
        task_pending = TaskFactory(project=self.project)
        TaskWorkflow.objects.create(
            project=self.project,
            task=task_done,
            stage=TaskWorkflowStage.REVIEW,
            annotate_user=self.annotator,
            current_assignee=self.reviewer,
        )
        TaskWorkflow.objects.create(
            project=self.project,
            task=task_pending,
            stage=TaskWorkflowStage.ANNOTATE,
            annotate_user=self.annotator,
            current_assignee=self.annotator,
        )

        payload = get_workflow_progress_detail(self.project, 'label')
        self.assertEqual(payload['project_task_count'], 2)
        self.assertEqual(payload['stage_completed_count'], 1)
        member = payload['members'][0]
        self.assertEqual(member['user_id'], self.annotator.id)
        self.assertEqual(member['assigned_task_count'], 2)
        self.assertEqual(member['completed_task_count'], 1)
        self.assertEqual(member['pending_task_count'], 1)

    def test_review_progress_records_reviewer(self):
        task = TaskFactory(project=self.project)
        Annotation.objects.create(
            task=task,
            project=self.project,
            completed_by=self.annotator,
            result=[],
        )
        wf = TaskWorkflow.objects.create(
            project=self.project,
            task=task,
            stage=TaskWorkflowStage.REVIEW,
            annotate_user=self.annotator,
            current_assignee=self.reviewer,
        )
        review_decision(task.id, self.reviewer, approve=True)

        payload = get_workflow_progress_detail(self.project, 'review')
        member = next(m for m in payload['members'] if m['user_id'] == self.reviewer.id)
        self.assertEqual(member['completed_task_count'], 1)
        wf.refresh_from_db()
        self.assertEqual(wf.reviewed_by_id, self.reviewer.id)

    def test_progress_api(self):
        self.client.force_authenticate(user=self.annotator)
        url = reverse('projects:api:project-workflow-progress', kwargs={'pk': self.project.id})
        response = self.client.get(url, {'stage': 'label'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['stage'], 'label')
        self.assertIn('members', response.json())
