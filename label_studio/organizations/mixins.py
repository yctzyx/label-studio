from django.utils.functional import cached_property


class OrganizationMixin:
    @cached_property
    def active_members(self):
        return self.members


class OrganizationMemberMixin:
    def has_permission(self, user):
        if getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False):
            return True
        if user.active_organization_id == self.organization_id:
            return True
        return False
