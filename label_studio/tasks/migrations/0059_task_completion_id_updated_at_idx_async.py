from django.db import migrations

from core.migration_helpers import make_sql_migration

sql_forwards = (
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS task_completion_id_updated_at_idx '
    'ON task_completion (id, updated_at);'
)
sql_backwards = (
    'DROP INDEX CONCURRENTLY IF EXISTS task_completion_id_updated_at_idx;'
)

sql_mysql_forwards = (
    'CREATE INDEX `task_completion_id_updated_at_idx` '
    'ON `task_completion` (`id`, `updated_at`);'
)
sql_mysql_backwards = (
    'DROP INDEX `task_completion_id_updated_at_idx` ON `task_completion`;'
)


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ('tasks', '0058_task_precomputed_agreement'),
    ]
    operations = [
        migrations.RunPython(
            *make_sql_migration(
                sql_forwards,
                sql_backwards,
                apply_on_sqlite=False,
                execute_immediately=False,
                migration_name=__name__,
                sql_mysql_forwards=sql_mysql_forwards,
                sql_mysql_backwards=sql_mysql_backwards,
            )
        ),
    ]
