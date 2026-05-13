# Generated manually for task workflow (annotate → review → accept)

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0035_project_parent_platform_dataset"),
        ("tasks", "0059_task_completion_id_updated_at_idx_async"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="task_workflow_enabled",
            field=models.BooleanField(
                default=False,
                help_text="When true, tasks use annotate → review → accept flow with pool round-robin for review/accept",
                verbose_name="task workflow enabled",
            ),
        ),
        migrations.CreateModel(
            name="ProjectWorkflowSettings",
            fields=[
                (
                    "project",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        primary_key=True,
                        related_name="workflow_settings",
                        serialize=False,
                        to="projects.project",
                    ),
                ),
                ("rr_review_index", models.PositiveIntegerField(default=0)),
                ("rr_accept_index", models.PositiveIntegerField(default=0)),
            ],
            options={
                "db_table": "project_workflow_settings",
            },
        ),
        migrations.CreateModel(
            name="ProjectTeamAllocation",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "role",
                    models.CharField(
                        choices=[
                            ("label", "Label"),
                            ("review", "Review"),
                            ("accept", "Accept"),
                            ("admin", "Admin"),
                        ],
                        db_index=True,
                        max_length=16,
                    ),
                ),
                (
                    "allocation_percent",
                    models.DecimalField(
                        decimal_places=2,
                        default=0,
                        help_text="Label share for distribution (0–100); ignored for non-label roles",
                        max_digits=6,
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="team_allocations",
                        to="projects.project",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="project_team_allocations",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "project_team_allocation",
            },
        ),
        migrations.AddConstraint(
            model_name="projectteamallocation",
            constraint=models.UniqueConstraint(fields=("project", "user", "role"), name="uniq_project_user_team_role"),
        ),
        migrations.CreateModel(
            name="TaskWorkflow",
            fields=[
                (
                    "task",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        primary_key=True,
                        related_name="workflow",
                        serialize=False,
                        to="tasks.task",
                    ),
                ),
                (
                    "stage",
                    models.CharField(
                        choices=[
                            ("annotate", "Annotate"),
                            ("review", "Review"),
                            ("accept", "Accept"),
                            ("done", "Done"),
                        ],
                        db_index=True,
                        max_length=16,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "annotate_user",
                    models.ForeignKey(
                        help_text="Annotator; reject returns here",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "current_assignee",
                    models.ForeignKey(
                        blank=True,
                        help_text="Who must act at the current stage (null when done)",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="task_workflows",
                        to="projects.project",
                    ),
                ),
            ],
            options={
                "db_table": "task_workflow",
            },
        ),
    ]
