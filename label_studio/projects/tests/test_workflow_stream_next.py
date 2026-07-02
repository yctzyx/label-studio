"""Workflow annotate stream returns existing annotations for rework resume."""

from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from organizations.tests.factories import OrganizationFactory
from projects.tests.factories import ProjectFactory
from projects.workflow_models import ProjectTeamAllocation, ProjectTeamRole, TaskWorkflow, TaskWorkflowStage
from projects.workflow_services import default_annotation_id_for_stream, review_decision
from tasks.models import Annotation
from tasks.tests.factories import TaskFactory
from users.tests.factories import UserFactory


class TestWorkflowStreamNextAnnotate(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = OrganizationFactory()
        cls.annotator = UserFactory(active_organization=cls.org)
        cls.reviewer = UserFactory(active_organization=cls.org)
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

    def _rework_task_with_annotation(self):
        task = TaskFactory(project=self.project, is_labeled=True)
        ann = Annotation.objects.create(
            task=task,
            project=self.project,
            completed_by=self.annotator,
            result=[],
        )
        TaskWorkflow.objects.create(
            task=task,
            project=self.project,
            stage=TaskWorkflowStage.ANNOTATE,
            annotate_user_id=self.annotator.id,
            current_assignee_id=self.annotator.id,
            returned_to_annotation=True,
        )
        return task, ann

    def test_default_annotation_id_for_stream(self):
        task, ann = self._rework_task_with_annotation()
        self.assertEqual(default_annotation_id_for_stream(task, self.annotator), ann.id)
        self.assertIsNone(default_annotation_id_for_stream(task, self.reviewer))

    def test_stream_next_annotate_includes_user_annotation(self):
        task, ann = self._rework_task_with_annotation()
        client = APIClient()
        client.force_authenticate(user=self.annotator)
        url = reverse('projects:api:project-workflow-stream-next', kwargs={'pk': self.project.id})
        res = client.get(url, {'stage': 'annotate'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['id'], task.id)
        self.assertEqual(res.data['default_selected_annotation'], ann.id)
        self.assertTrue(res.data['workflow']['returned_to_annotation'])
        self.assertEqual(len(res.data['annotations']), 1)
        self.assertEqual(res.data['annotations'][0]['id'], ann.id)

    def test_stream_next_annotate_after_reject_from_review(self):
        task = TaskFactory(project=self.project, is_labeled=True)
        ann = Annotation.objects.create(task=task, project=self.project, completed_by=self.annotator, result=[])
        TaskWorkflow.objects.create(
            task=task,
            project=self.project,
            stage=TaskWorkflowStage.REVIEW,
            annotate_user_id=self.annotator.id,
            current_assignee_id=self.reviewer.id,
        )
        review_decision(task.id, self.reviewer, approve=False, comment='需修改')
        client = APIClient()
        client.force_authenticate(user=self.annotator)
        url = reverse('projects:api:project-workflow-stream-next', kwargs={'pk': self.project.id})
        res = client.get(url, {'stage': 'annotate'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['default_selected_annotation'], ann.id)
        self.assertEqual(len(res.data['annotations']), 1)

    def test_stream_next_fresh_task_no_default_annotation(self):
        task = TaskFactory(project=self.project, is_labeled=False)
        TaskWorkflow.objects.create(
            task=task,
            project=self.project,
            stage=TaskWorkflowStage.ANNOTATE,
            annotate_user_id=self.annotator.id,
            current_assignee_id=self.annotator.id,
        )
        client = APIClient()
        client.force_authenticate(user=self.annotator)
        url = reverse('projects:api:project-workflow-stream-next', kwargs={'pk': self.project.id})
        res = client.get(url, {'stage': 'annotate'})
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data['default_selected_annotation'])
        self.assertEqual(res.data['annotations'], [])
