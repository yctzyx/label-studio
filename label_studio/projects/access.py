"""Project visibility and management rules based on creator + optional team allocations."""

from __future__ import annotations

from django.db.models import Exists, OuterRef, Q

from projects.workflow_models import ProjectTeamAllocation, ProjectTeamRole


def apply_project_team_visibility(queryset, user):
    """Restrict projects inside *queryset* (already org-scoped) for labeling UI.

    - If a project has **no** ``ProjectTeamAllocation`` rows → any org member on that org may see it
      (legacy behavior).
    - If it has allocations → visible only to project ``created_by`` or users assigned to any role
      on that project (label / review / accept / admin).
    - Org owner (Organization.created_by) and superusers see all projects within the queryset.
    """
    if user is None or not user.is_authenticated:
        return queryset.none()

    if getattr(user, 'is_superuser', False):
        return queryset

    active_org = getattr(user, 'active_organization', None)
    if active_org is not None and getattr(active_org, 'created_by_id', None) == user.id:
        return queryset

    any_team_cfg = Exists(ProjectTeamAllocation.objects.filter(project_id=OuterRef('pk')))
    user_on_team = Exists(
        ProjectTeamAllocation.objects.filter(
            project_id=OuterRef('pk'),
            user_id=user.id,
        )
    )
    creator_or_member = Q(created_by_id=user.id) | user_on_team

    return queryset.filter(~any_team_cfg | creator_or_member).distinct()


def user_can_manage_project(user, project) -> bool:
    """Whether *user* may manage project-level settings / team allocations / distribute.

    Allowed: creators, explicit ``admin`` allocation row, organization owner, superuser.
    """
    if project is None or user is None or not user.is_authenticated:
        return False

    if getattr(user, 'is_superuser', False):
        return True

    active_org = getattr(user, 'active_organization', None)
    if active_org is not None and getattr(active_org, 'created_by_id', None) == user.id:
        return True

    if project.created_by_id == user.id:
        return True

    return ProjectTeamAllocation.objects.filter(
        project=project,
        user_id=user.id,
        role=ProjectTeamRole.ADMIN,
    ).exists()
