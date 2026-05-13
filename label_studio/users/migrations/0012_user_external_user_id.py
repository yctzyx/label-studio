# Generated manually for pub_user directory sync

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0011_user_custom_hotkeys"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="external_user_id",
            field=models.CharField(
                blank=True,
                db_index=True,
                help_text="父平台 pub_user.id，用于目录同步与幂等 upsert",
                max_length=64,
                null=True,
                unique=True,
                verbose_name="external user id",
            ),
        ),
    ]
