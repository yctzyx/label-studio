from django.db import migrations, connections
from django.db.utils import OperationalError, ProgrammingError
from core.redis import start_job_async_or_sync
from core.models import AsyncMigrationStatus
import logging

logger = logging.getLogger(__name__)
migration_name = '0033_projects_soft_delete_indexes_async'


def forward_migration(migration_name, db_alias):
    rec = AsyncMigrationStatus.objects.using(db_alias).create(name=migration_name, status=AsyncMigrationStatus.STATUS_STARTED)
    conn = connections[db_alias]
    if conn.vendor == 'postgresql':
        sqls = [
            'CREATE INDEX CONCURRENTLY IF NOT EXISTS project_org_deleted_idx ON project (organization_id, deleted_at)',
            'CREATE INDEX CONCURRENTLY IF NOT EXISTS project_deleted_at_idx ON project (deleted_at)',
            'CREATE INDEX CONCURRENTLY IF NOT EXISTS project_purge_at_idx ON project (purge_at)',
        ]
    elif conn.vendor == 'mysql':
        sqls = [
            'CREATE INDEX `project_org_deleted_idx` ON `project` (`organization_id`, `deleted_at`)',
            'CREATE INDEX `project_deleted_at_idx` ON `project` (`deleted_at`)',
            'CREATE INDEX `project_purge_at_idx` ON `project` (`purge_at`)',
        ]
    else:
        sqls = [
            'CREATE INDEX IF NOT EXISTS project_org_deleted_idx ON project (organization_id, deleted_at)',
            'CREATE INDEX IF NOT EXISTS project_deleted_at_idx ON project (deleted_at)',
            'CREATE INDEX IF NOT EXISTS project_purge_at_idx ON project (purge_at)',
        ]
    with conn.cursor() as c:
        for sql in sqls:
            try:
                c.execute(sql)
            except (OperationalError, ProgrammingError) as e:
                if conn.vendor != 'mysql' or (not e.args or e.args[0] != 1061):
                    raise
    rec.status = AsyncMigrationStatus.STATUS_FINISHED
    rec.save(using=db_alias)


def reverse_migration(migration_name, db_alias):
    rec = AsyncMigrationStatus.objects.using(db_alias).create(name=migration_name, status=AsyncMigrationStatus.STATUS_STARTED)
    conn = connections[db_alias]
    if conn.vendor == 'postgresql':
        sqls = [
            'DROP INDEX CONCURRENTLY IF EXISTS project_org_deleted_idx',
            'DROP INDEX CONCURRENTLY IF EXISTS project_deleted_at_idx',
            'DROP INDEX CONCURRENTLY IF EXISTS project_purge_at_idx',
        ]
    elif conn.vendor == 'mysql':
        sqls = [
            'DROP INDEX `project_org_deleted_idx` ON `project`',
            'DROP INDEX `project_deleted_at_idx` ON `project`',
            'DROP INDEX `project_purge_at_idx` ON `project`',
        ]
    else:
        sqls = [
            'DROP INDEX IF EXISTS project_org_deleted_idx',
            'DROP INDEX IF EXISTS project_deleted_at_idx',
            'DROP INDEX IF EXISTS project_purge_at_idx',
        ]
    with conn.cursor() as c:
        for sql in sqls:
            try:
                c.execute(sql)
            except (OperationalError, ProgrammingError) as e:
                if conn.vendor != 'mysql' or (not e.args or e.args[0] != 1091):
                    raise
    rec.status = AsyncMigrationStatus.STATUS_FINISHED
    rec.save(using=db_alias)


def forwards(apps, schema_editor):
    db_alias = schema_editor.connection.alias
    start_job_async_or_sync(forward_migration, migration_name=migration_name, db_alias=db_alias)


def backwards(apps, schema_editor):
    db_alias = schema_editor.connection.alias
    start_job_async_or_sync(reverse_migration, migration_name=migration_name, db_alias=db_alias)


class Migration(migrations.Migration):
    atomic = False
    dependencies = [
        ('projects', '0032_project_deleted_at_project_deleted_by_and_more'),
    ]
    operations = [
        migrations.RunPython(forwards, backwards),
    ]

