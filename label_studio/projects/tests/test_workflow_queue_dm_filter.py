"""DM task list workflow_queue param should match my-tasks queue filtering."""

from django.test import RequestFactory, TestCase

from data_manager.prepare_params import PrepareParams
from projects.tests.factories import ProjectFactory
from projects.workflow_models import TaskWorkflow, TaskWorkflowStage
from projects.workflow_services import apply_workflow_queue_filter, queryset_my_tasks
from tasks.models import Task
from tasks.tests.factories import TaskFactory
from users.tests.factories import UserFactory


class TestWorkflowQueueDMFilter(TestCase):
    def setUp(self):
        self.project = ProjectFactory(task_workflow_enabled=True)
        self.annotator = UserFactory()
        self.other = UserFactory()
        self.mine = TaskFactory(project=self.project)
        self.theirs = TaskFactory(project=self.project)
        TaskWorkflow.objects.create(
            task=self.mine,
            project=self.project,
            stage=TaskWorkflowStage.ANNOTATE,
            annotate_user_id=self.annotator.id,
            current_assignee_id=self.annotator.id,
        )
        TaskWorkflow.objects.create(
            task=self.theirs,
            project=self.project,
            stage=TaskWorkflowStage.ANNOTATE,
            annotate_user_id=self.other.id,
            current_assignee_id=self.other.id,
        )

    def test_apply_workflow_queue_filter_limits_to_my_tasks(self):
        base = Task.objects.filter(project=self.project)
        request = RequestFactory().get('/api/dm/tasks', {'workflow_queue': 'annotate'})
        request.user = self.annotator
        prepare_params = PrepareParams(project=self.project.id, request=request)

        filtered = apply_workflow_queue_filter(base, request, prepare_params)

        self.assertEqual(list(filtered.values_list('id', flat=True)), [self.mine.id])

    def test_without_workflow_queue_param_unchanged(self):
        base = Task.objects.filter(project=self.project)
        request = RequestFactory().get('/api/dm/tasks')
        request.user = self.annotator
        prepare_params = PrepareParams(project=self.project.id, request=request)

        filtered = apply_workflow_queue_filter(base, request, prepare_params)

        self.assertCountEqual(
            list(filtered.values_list('id', flat=True)),
            [self.mine.id, self.theirs.id],
        )

    def test_matches_queryset_my_tasks_ids(self):
        base = Task.objects.filter(project=self.project)
        request = RequestFactory().get('/api/dm/tasks', {'workflow_queue': 'annotate'})
        request.user = self.annotator
        prepare_params = PrepareParams(project=self.project.id, request=request)

        filtered = apply_workflow_queue_filter(base, request, prepare_params)
        my_ids = list(queryset_my_tasks(self.project, self.annotator, 'annotate').values_list('id', flat=True))

        self.assertEqual(list(filtered.values_list('id', flat=True)), my_ids)
