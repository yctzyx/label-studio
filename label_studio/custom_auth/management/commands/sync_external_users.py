
"""
同步外部系统用户的管理命令
使用方法: python manage.py sync_external_users
"""
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from organizations.models import Organization
import logging

logger = logging.getLogger(__name__)
User = get_user_model()


class Command(BaseCommand):
    help = '从外部系统同步用户和组织信息'
    
    def add_arguments(self, parser):
        parser.add_argument(
            '--org-id',
            type=str,
            help='只同步指定组织的用户',
        )
        
        parser.add_argument(
            '--force',
            action='store_true',
            help='强制同步所有用户（忽略同步时间）',
        )
    
    def handle(self, *args, **options):
        org_id = options.get('org_id')
        force = options.get('force')
        
        self.stdout.write('开始同步外部用户...')
        
        if org_id:
            # 同步指定组织
            try:
                org = Organization.objects.get(external_org_id=org_id)
                self.sync_organization(org, force)
            except Organization.DoesNotExist:
                self.stdout.write(self.style.ERROR(f'组织不存在: {org_id}'))
        else:
            # 同步所有组织
            orgs = Organization.objects.filter(external_org_id__isnull=False)
            for org in orgs:
                self.sync_organization(org, force)
        
        self.stdout.write(self.style.SUCCESS('同步完成！'))
    
    def sync_organization(self, org, force=False):
        """同步单个组织"""
        self.stdout.write(f'同步组织: {org.title} (ID: {org.external_org_id})')
        
        try:
            # 调用组织的同步方法
            org.sync_members_from_external()
            
            # 同步每个用户的详细信息
            for member in org.active_members:
                user = member.user
                if force or self._should_sync(user):
                    self.stdout.write(f'  同步用户: {user.email}')
                    user.sync_from_external_system()
            
            self.stdout.write(self.style.SUCCESS(f'  ✓ 组织 {org.title} 同步成功'))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'  ✗ 同步失败: {e}'))
            logger.error(f'Failed to sync org {org.id}: {e}', exc_info=True)
    
    def _should_sync(self, user):
        """判断是否需要同步用户"""
        from django.utils import timezone
        from datetime import timedelta
        
        if not user.external_synced_at:
            return True
        
        # 超过 1 小时未同步
        return timezone.now() - user.external_synced_at > timedelta(hours=1)
