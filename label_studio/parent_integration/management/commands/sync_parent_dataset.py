"""从父平台库同步 data_database、md_data_set 到 Label Studio 本库。"""

from django.core.management.base import BaseCommand

from parent_integration.parent_dataset_sync import (
    parent_dataset_db,
    parent_dataset_source_db,
    sync_parent_dataset_counts,
    sync_parent_dataset_tables,
)


class Command(BaseCommand):
    help = '将 data_database、md_data_set 从父平台库同步到本库（源库见 PARENT_DATASET_SOURCE_DB，目标库见 PARENT_DATASET_DB）'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='在单事务内执行全部写入后回滚，用于演练',
        )
        parser.add_argument(
            '--prune',
            action='store_true',
            help='删除本库中父平台已不存在的 data_database / md_data_set 行',
        )
        parser.add_argument(
            '--counts-only',
            action='store_true',
            help='仅统计源库与本库行数，不写入',
        )

    def handle(self, *args, **options):
        source = parent_dataset_source_db()
        target = parent_dataset_db()
        self.stdout.write(f'PARENT_DATASET_SOURCE_DB={source}')
        self.stdout.write(f'PARENT_DATASET_DB={target}')

        if options['counts_only']:
            c = sync_parent_dataset_counts()
            self.stdout.write(
                f"源库 data_database: {c['source_databases']}, md_data_set: {c['source_datasets']}; "
                f"本库 data_database: {c['local_databases']}, md_data_set: {c['local_datasets']}"
            )
            return

        stats = sync_parent_dataset_tables(
            dry_run=options['dry_run'],
            prune=options['prune'],
        )
        for k, v in sorted(stats.items()):
            self.stdout.write(f'{k}: {v}')
        if options['dry_run']:
            self.stdout.write(self.style.WARNING('已回滚（dry-run），未持久化'))
