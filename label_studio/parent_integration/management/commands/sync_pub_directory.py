"""从父平台 pub_org / pub_user / pub_user_org 同步目录到 Label Studio。"""

from django.core.management.base import BaseCommand

from parent_integration.pub_directory_sync import (
    pub_directory_db,
    sync_pub_directory,
    sync_pub_directory_counts,
)


class Command(BaseCommand):
    help = '将 pub_org、pub_user、pub_user_org 同步为 Organization、User、OrganizationMember（读取库见 PUB_DIRECTORY_DB）'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='在单事务内执行全部写入后回滚，用于演练；统计数字仍反映本会执行的操作量',
        )
        parser.add_argument(
            '--prune-memberships',
            action='store_true',
            help='对同时带有 external_org_id / external_user_id 的成员关系，若父平台已无对应关联则 soft_delete',
        )
        parser.add_argument(
            '--counts-only',
            action='store_true',
            help='仅统计父库可读行数，不写 Label Studio',
        )

    def handle(self, *args, **options):
        pdb = pub_directory_db()
        self.stdout.write(f'PUB_DIRECTORY_DB={pdb}')

        if options['counts_only']:
            c = sync_pub_directory_counts()
            self.stdout.write(
                f"pub_org 有效行: {c['pub_org_active']}, pub_user 有效行: {c['pub_user_active']}, "
                f"pub_user_org 行数: {c['pub_user_org_rows']}"
            )
            return

        stats = sync_pub_directory(
            dry_run=options['dry_run'],
            prune_memberships=options['prune_memberships'],
        )
        for k, v in sorted(stats.items()):
            self.stdout.write(f'{k}: {v}')
        if options['dry_run']:
            self.stdout.write(self.style.WARNING('已回滚（dry-run），未持久化'))
