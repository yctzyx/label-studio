# Generated manually for pub_org directory sync

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("organizations", "0006_alter_organizationmember_deleted_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="organization",
            name="external_org_id",
            field=models.CharField(
                blank=True,
                db_index=True,
                help_text="父平台 pub_org.id，用于目录同步与幂等 upsert",
                max_length=64,
                null=True,
                unique=True,
                verbose_name="external organization id",
            ),
        ),
    ]
