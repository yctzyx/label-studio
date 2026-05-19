# Task workflow: distinguish「被驳回」vs first-pass annotate

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0037_project_template_group"),
    ]

    operations = [
        migrations.AddField(
            model_name="taskworkflow",
            name="returned_to_annotation",
            field=models.BooleanField(
                default=False,
                help_text="True after review/accept rejection sent task back to annotator; cleared when annotator resubmits",
            ),
        ),
    ]
