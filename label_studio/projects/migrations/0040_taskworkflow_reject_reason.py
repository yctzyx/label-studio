from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('projects', '0039_project_data_type_category'),
    ]

    operations = [
        migrations.AddField(
            model_name='taskworkflow',
            name='last_reject_reason',
            field=models.TextField(
                blank=True,
                help_text='Most recent review/accept rejection comment for the annotator',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='taskworkflow',
            name='last_rejected_at',
            field=models.DateTimeField(
                blank=True,
                help_text='When the task was last rejected back to annotate',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='taskworkflow',
            name='last_rejected_by',
            field=models.ForeignKey(
                blank=True,
                help_text='User who last rejected the task to annotate',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='+',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
