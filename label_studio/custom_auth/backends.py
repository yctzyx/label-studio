"""
自定义认证后端
支持外部系统认证（LDAP, OAuth, SSO 等）
"""
from django.contrib.auth.backends import ModelBackend
from django.contrib.auth import get_user_model
from django.utils import timezone
import logging

logger = logging.getLogger(__name__)
User = get_user_model()


class ExternalAuthBackend(ModelBackend):
    """
    外部系统认证后端
    支持通过外部 API 验证用户
    """
    
    def authenticate(self, request, username=None, password=None, **kwargs):
        """
        认证用户
        1. 先尝试外部系统认证
        2. 如果成功，同步或创建本地用户
        3. 返回用户对象
        """
        if username is None or password is None:
            return None
        
        # 调用外部认证 API
        external_user = self._authenticate_external(username, password)
        
        if not external_user:
            # 外部认证失败，回退到本地认证
            return super().authenticate(request, username=username, password=password, **kwargs)
        
        # 外部认证成功，同步本地用户
        user = self._sync_or_create_user(external_user)
        return user
    
    def _authenticate_external(self, username, password):
        """
        调用外部系统进行认证
        返回外部用户信息或 None
        """
        # 示例：调用外部 API
        # try:
        #     import requests
        #     response = requests.post(
        #         'https://your-api.com/auth/login',
        #         json={'username': username, 'password': password},
        #         timeout=5
        #     )
        #     
        #     if response.status_code == 200:
        #         return response.json()  # 返回用户信息
        # except Exception as e:
        #     logger.error(f'External auth failed: {e}')
        
        return None
    
    def _sync_or_create_user(self, external_user):
        """
        根据外部用户信息同步或创建本地用户
        """
        external_id = external_user.get('id')
        email = external_user.get('email')
        
        try:
            # 尝试通过 external_user_id 查找
            user = User.objects.get(external_user_id=external_id)
        except User.DoesNotExist:
            # 尝试通过 email 查找
            try:
                user = User.objects.get(email=email)
                user.external_user_id = external_id
            except User.DoesNotExist:
                # 创建新用户
                user = User.objects.create_user(
                    email=email,
                    username=external_user.get('username', email),
                    first_name=external_user.get('first_name', ''),
                    last_name=external_user.get('last_name', ''),
                )
                user.external_user_id = external_id
        
        # 更新用户信息
        user.external_source = 'custom_api'
        user.external_synced_at = timezone.now()
        user.first_name = external_user.get('first_name', user.first_name)
        user.last_name = external_user.get('last_name', user.last_name)
        user.save()
        
        # 同步组织关系
        self._sync_user_organizations(user, external_user)
        
        return user
    
    def _sync_user_organizations(self, user, external_user):
        """
        同步用户的组织关系
        """
        from organizations.models import Organization
        
        external_orgs = external_user.get('organizations', [])
        
        for org_data in external_orgs:
            external_org_id = org_data.get('id')
            org_name = org_data.get('name')
            
            # 查找或创建组织
            org, created = Organization.objects.get_or_create(
                external_org_id=external_org_id,
                defaults={'title': org_name, 'created_by': user}
            )
            
            # 添加用户到组织
            if not org.has_user(user):
                org.add_user(user)
            
            # 设置为活跃组织（如果用户还没有）
            if not user.active_organization:
                user.active_organization = org
                user.save()


class LDAPAuthBackend(ModelBackend):
    """
    LDAP 认证后端示例
    """
    
    def authenticate(self, request, username=None, password=None, **kwargs):
        """
        通过 LDAP 认证用户
        """
        # 需要安装: pip install python-ldap django-auth-ldap
        
        # try:
        #     import ldap
        #     from django_auth_ldap.backend import LDAPBackend
        #     
        #     ldap_backend = LDAPBackend()
        #     user = ldap_backend.authenticate(request, username=username, password=password)
        #     
        #     if user:
        #         # 同步 LDAP 信息到自定义字段
        #         user.external_source = 'ldap'
        #         user.external_user_id = username
        #         user.external_synced_at = timezone.now()
        #         user.save()
        #     
        #     return user
        # except Exception as e:
        #     logger.error(f'LDAP auth failed: {e}')
        
        return None


class OAuth2Backend(ModelBackend):
    """
    OAuth2 认证后端示例
    """
    
    def authenticate(self, request, token=None, **kwargs):
        """
        通过 OAuth2 token 认证用户
        """
        # 需要安装: pip install social-auth-app-django
        
        # try:
        #     import requests
        #     
        #     # 验证 token
        #     response = requests.get(
        #         'https://oauth-provider.com/userinfo',
        #         headers={'Authorization': f'Bearer {token}'}
        #     )
        #     
        #     if response.status_code == 200:
        #         user_info = response.json()
        #         
        #         # 创建或更新用户
        #         user, created = User.objects.get_or_create(
        #             email=user_info['email'],
        #             defaults={
        #                 'username': user_info.get('username', user_info['email']),
        #                 'first_name': user_info.get('given_name', ''),
        #                 'last_name': user_info.get('family_name', ''),
        #             }
        #         )
        #         
        #         user.external_source = 'oauth2'
        #         user.external_user_id = user_info.get('sub')
        #         user.external_synced_at = timezone.now()
        #         user.save()
        #         
        #         return user
        # except Exception as e:
        #     logger.error(f'OAuth2 auth failed: {e}')
        
        return None
