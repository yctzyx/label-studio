"""Project API exposes workflow pipeline config for project cards."""

from django.urls import reverse
from rest_framework.test import APITestCase

from organizations.tests.factories import OrganizationFactory
from projects.tests.factories import ProjectFactory
from projects.workflow_models import ProjectTeamAllocation, ProjectTeamRole
from projects.workflow_services import get_workflow_pipeline_config
from users.tests.factories import UserFactory


class TestWorkflowPipelineConfig(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.org = OrganizationFactory()
        cls.user = UserFactory(active_organization=cls.org)
        cls.reviewer = UserFactory(active_organization=cls.org)
        cls.accepter = UserFactory(active_organization=cls.org)

    def test_pipeline_disabled_when_workflow_off(self):
        project = ProjectFactory(organization=self.org, task_workflow_enabled=False)
        self.assertEqual(
            get_workflow_pipeline_config(project),
            {'has_review': False, 'has_accept': False},
        )

    def test_pipeline_reflects_team_allocations(self):
        project = ProjectFactory(organization=self.org, task_workflow_enabled=True)
        ProjectTeamAllocation.objects.create(
            project=project,
            user=self.user,
            role=ProjectTeamRole.LABEL,
            allocation_percent=100,
        )
        ProjectTeamAllocation.objects.create(
            project=project,
            user=self.reviewer,
            role=ProjectTeamRole.REVIEW,
            allocation_percent=0,
        )
        self.assertEqual(
            get_workflow_pipeline_config(project),
            {'has_review': True, 'has_accept': False},
        )

        ProjectTeamAllocation.objects.create(
            project=project,
            user=self.accepter,
            role=ProjectTeamRole.ACCEPT,
            allocation_percent=0,
        )
        self.assertEqual(
            get_workflow_pipeline_config(project),
            {'has_review': True, 'has_accept': True},
        )

    def test_project_list_includes_workflow_pipeline(self):
        project = ProjectFactory(
            organization=self.org,
            task_workflow_enabled=True,
            created_by=self.user,
        )
        ProjectTeamAllocation.objects.create(
            project=project,
            user=self.user,
            role=ProjectTeamRole.LABEL,
            allocation_percent=100,
        )
        ProjectTeamAllocation.objects.create(
            project=project,
            user=self.reviewer,
            role=ProjectTeamRole.REVIEW,
            allocation_percent=0,
        )

        self.client.force_authenticate(user=self.user)
        url = reverse('projects:api:project-list')
        response = self.client.get(url, {'ids': str(project.id)})
        self.assertEqual(response.status_code, 200)
        row = next(item for item in response.json()['results'] if item['id'] == project.id)
        self.assertEqual(row['workflow_pipeline'], {'has_review': True, 'has_accept': False})
