from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('projects', '0040_taskworkflow_reject_reason'),
    ]

    operations = [
        migrations.AddField(
            model_name='taskworkflow',
            name='reviewed_by',
            field=models.ForeignKey(
                blank=True,
                help_text='Reviewer who approved the task out of review stage',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='+',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='taskworkflow',
            name='accepted_by',
            field=models.ForeignKey(
                blank=True,
                help_text='Acceptor who approved the task out of accept stage',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='+',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
