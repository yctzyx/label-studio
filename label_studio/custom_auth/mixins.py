"""
自定义用户和组织 Mixin
用于接入外部用户系统
"""
from django.db import models
from django.utils.functional import cached_property
import requests


class CustomUserMixin:
    """
    扩展用户模型，添加外部系统集成字段
    """
    # 外部系统用户 ID
    external_user_id = models.CharField(
        max_length=256, 
        blank=True, 
        null=True,
        db_index=True,
        help_text='External system user ID'
    )
    
    # 外部系统来源
    external_source = models.CharField(
        max_length=64,
        blank=True,
        null=True,
        help_text='External authentication source (e.g., ldap, oauth, custom)'
    )
    
    # 同步时间
    external_synced_at = models.DateTimeField(
        blank=True,
        null=True,
        help_text='Last sync time with external system'
    )
    
    @property
    def is_annotator(self):
        """从外部系统获取角色"""
        # 可以调用外部 API 获取用户角色
        return self._get_external_role() == 'annotator'
    
    def is_project_annotator(self, project):
        """检查用户在特定项目中的角色"""
        # 可以调用外部 API 检查项目权限
        return self._check_external_project_permission(project.id)
    
    def _get_external_role(self):
        """从外部系统获取用户角色"""
        if not self.external_user_id:
            return None
        
        # 示例：调用外部 API
        # try:
        #     response = requests.get(
        #         f'https://your-api.com/users/{self.external_user_id}/role',
        #         headers={'Authorization': 'Bearer YOUR_TOKEN'}
        #     )
        #     return response.json().get('role')
        # except:
        #     return None
        
        return None
    
    def _check_external_project_permission(self, project_id):
        """检查外部系统中的项目权限"""
        # 示例：调用外部 API
        return False
    
    def sync_from_external_system(self):
        """从外部系统同步用户信息"""
        if not self.external_user_id:
            return
        
        # 示例：从外部系统同步用户信息
        # try:
        #     response = requests.get(
        #         f'https://your-api.com/users/{self.external_user_id}',
        #         headers={'Authorization': 'Bearer YOUR_TOKEN'}
        #     )
        #     data = response.json()
        #     
        #     self.first_name = data.get('first_name', '')
        #     self.last_name = data.get('last_name', '')
        #     self.email = data.get('email', self.email)
        #     self.external_synced_at = timezone.now()
        #     self.save()
        # except Exception as e:
        #     logger.error(f'Failed to sync user {self.id}: {e}')
        pass


class CustomOrganizationMixin:
    """
    扩展组织模型，添加外部系统集成字段
    """
    # 外部组织 ID
    external_org_id = models.CharField(
        max_length=256,
        blank=True,
        null=True,
        db_index=True,
        help_text='External system organization ID'
    )
    
    # 外部系统来源
    external_source = models.CharField(
        max_length=64,
        blank=True,
        null=True,
        help_text='External organization source'
    )
    
    @cached_property
    def active_members(self):
        """获取活跃成员（可以从外部系统同步）"""
        return self.members.filter(deleted_at__isnull=True)
    
    def sync_members_from_external(self):
        """从外部系统同步组织成员"""
        if not se
            return
        
        # 示例：从外部系统同步成员
        # try:
        #     response = requests.get(
        #         f'https://your-api.com/orgs/{self.external_org_id}/members',
        #         headers={'Authorization': 'Bearer YOUR_TOKEN'}
        #lf.external_org_id:     )
        #     members = response.json()
        #     
        #     for member_data in members:
        #         # 创建或更新用户
        #         user, created = User.objects.get_or_create(
        #             external_user_id=member_data['id'],
        #             defaults={
        #                 'email': member_data['email'],
        #                 'first_name': member_data['first_name'],
        #                 'last_name': member_data['last_name'],
        #             }
        #         )
        #         
        #         # 添加到组织
        #         if not self.has_user(user):
        #             self.add_user(user)
        # except Exception as e:
        #     logger.error(f'Failed to sync org {self.id}: {e}')
        pass


class CustomOrganizationMemberMixin:
    """
    扩展组织成员关系
    """
    # 外部角色
    external_role = models.CharField(
        max_length=64,
        blank=True,
        null=True,
        help_text='Role from external system'
    )
    
    def has_permission(self, user):
        """检查权限（可以集成外部权限系统）"""
        if user.active_organization_id == self.organization_id:
            return True
        
        # 可以添加额外的外部权限检查
        return False
