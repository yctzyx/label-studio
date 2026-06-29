from django.test import TestCase
from organizations.models import Organization, OrganizationMember
from projects.tests.factories import ProjectFactory
from rest_framework.authtoken.models import Token

from data_export.token_utils import get_export_access_token
from users.tests.factories import UserFactory


class TestExportAccessToken(TestCase):
    def test_prefers_authenticated_user(self):
        project = ProjectFactory()
        other = UserFactory()
        Token.objects.get_or_create(user=other)
        request_user = project.created_by
        Token.objects.get_or_create(user=request_user)
        self.assertEqual(get_export_access_token(project, user=request_user), Token.objects.get(user=request_user).key)

    def test_falls_back_when_org_created_by_missing(self):
        owner = UserFactory()
        Token.objects.get_or_create(user=owner)
        org = Organization.objects.create(title='Pub org', created_by=None)
        project = ProjectFactory(created_by=owner, organization=org)
        self.assertEqual(get_export_access_token(project), Token.objects.get(user=owner).key)

    def test_falls_back_to_org_member(self):
        org = Organization.objects.create(title='Pub org', created_by=None)
        member = UserFactory()
        Token.objects.get_or_create(user=member)
        project = ProjectFactory(organization=org)
        project.created_by = None
        project.save(update_fields=['created_by'])
        OrganizationMember.objects.create(user=member, organization=org)
        self.assertEqual(get_export_access_token(project), Token.objects.get(user=member).key)
