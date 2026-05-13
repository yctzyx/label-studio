"""Team allocation hooks: creator is stored as explicit project admin for new projects."""

from django.db.models.signals import post_save
from django.dispatch import receiver

from projects.models import Project
from projects.workflow_models import ProjectTeamAllocation, ProjectTeamRole


@receiver(post_save, sender=Project)
def ensure_creator_registered_as_team_admin(sender, instance, created, **kwargs):
    """New projects: persist creator as workflow team `admin` (visible in 人员分配, management checks)."""
    if not created or not instance.created_by_id:
        return
    ProjectTeamAllocation.objects.update_or_create(
        project=instance,
        user_id=instance.created_by_id,
        role=ProjectTeamRole.ADMIN,
        defaults={'allocation_percent': 0},
    )
