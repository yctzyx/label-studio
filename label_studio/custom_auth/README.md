# Label Studio 自定义用户组织集成方案

## 概述

本模块提供了将 Label Studio 与外部用户系统集成的完整方案，支持：

- ✅ 外部 API 认证
- ✅ LDAP/AD 认证
- ✅ OAuth2/SSO 认证
- ✅ 用户信息自动同步
- ✅ 组织关系同步
- ✅ 自定义权限控制

## 架构设计

```
外部用户系统 (LDAP/OAuth/API)
         ↓
   认证后端 (backends.py)
         ↓
   用户模型 (User + CustomUserMixin)
         ↓
   组织模型 (Organization + CustomOrganizationMixin)
         ↓
   Label Studio 权限系统
```

## 快速开始

### 1. 启用自定义认证

编辑 `label_studio/core/settings/base.py`，添加：

```python
# 在文件末尾添加
from custom_auth.settings import *
```

### 2. 运行数据库迁移

```bash
python manage.py makemigrations
python manage.py migrate
```

### 3. 配置外部 API

编辑 `custom_auth/settings.py`：

```python
EXTERNAL_AUTH_API_URL = 'https://your-company-api.com'
EXTERNAL_AUTH_API_TOKEN = 'your-secret-token'
EXTERNAL_AUTH_ENABLED = True
```

### 4. 实现认证逻辑

编辑 `custom_auth/backends.py` 中的 `_authenticate_external` 方法：

```python
def _authenticate_external(self, username, password):
    """调用你的外部 API"""
    import requests
    
    try:
        response = requests.post(
            f'{settings.EXTERNAL_AUTH_API_URL}/auth/login',
            json={'username': username, 'password': password},
            headers={'Authorization': f'Bearer {settings.EXTERNAL_AUTH_API_TOKEN}'},
            timeout=settings.EXTERNAL_AUTH_TIMEOUT
        )
        
        if response.status_code == 200:
            return response.json()  # 返回用户信息
    except Exception as e:
        logger.error(f'External auth failed: {e}')
    
    return None
```

### 5. 同步用户

```bash
# 同步所有组织的用户
python manage.py sync_external_users

# 同步指定组织
python manage.py sync_external_users --org-id=ORG123

# 强制同步
python manage.py sync_external_users --force
```

## 使用场景

### 场景 1: 企业内部 LDAP 认证

```python
# 1. 安装依赖
pip install python-ldap django-auth-ldap

# 2. 在 custom_auth/settings.py 中配置
import ldap
from django_auth_ldap.config import LDAPSearch

AUTH_LDAP_SERVER_URI = 'ldap://ldap.company.com'
AUTH_LDAP_BIND_DN = 'cn=admin,dc=company,dc=com'
AUTH_LDAP_BIND_PASSWORD = 'password'
AUTH_LDAP_USER_SEARCH = LDAPSearch(
    'ou=users,dc=company,dc=com',
    ldap.SCOPE_SUBTREE,
    '(uid=%(user)s)'
)

# 3. 启用 LDAP 后端
AUTHENTICATION_BACKENDS = [
    'custom_auth.backends.LDAPAuthBackend',
    'django.contrib.auth.backends.ModelBackend',
]
```

### 场景 2: OAuth2/SSO 单点登录

```python
# 1. 安装依赖
pip install social-auth-app-django

# 2. 配置 OAuth2 提供商
SOCIAL_AUTH_GOOGLE_OAUTH2_KEY = 'your-client-id'
SOCIAL_AUTH_GOOGLE_OAUTH2_SECRET = 'your-client-secret'

# 3. 添加 URL 路由
# 在 urls.py 中添加
path('oauth/', include('social_django.urls', namespace='social')),
```

### 场景 3: 自定义 API 认证

```python
# 实现 custom_auth/backends.py 中的方法

def _authenticate_external(self, username, password):
    """调用公司内部 API"""
    response = requests.post(
        'https://internal-api.company.com/v1/auth',
        json={
            'username': username,
            'password': password,
            'app': 'label-studio'
        },
        headers={'X-API-Key': settings.INTERNAL_API_KEY}
    )
    
    if response.status_code == 200:
        user_data = response.json()
        return {
            'id': user_data['user_id'],
            'email': user_data['email'],
            'first_name': user_data['first_name'],
            'last_name': user_data['last_name'],
            'organizations': user_data.get('departments', [])
        }
    
    return None
```

## 数据模型扩展

### User 模型新增字段

```python
- external_user_id: 外部系统用户 ID
- external_source: 认证来源 (ldap/oauth/api)
- external_synced_at: 最后同步时间
```

### Organization 模型新增字段

```python
- external_org_id: 外部组织 ID
- external_source: 组织来源
```

### OrganizationMember 模型新增字段

```python
- external_role: 外部系统中的角色
```

## API 接口

### 手动触发用户同步

```python
from django.contrib.auth import get_user_model

User = get_user_model()
user = User.objects.get(email='user@example.com')

# 从外部系统同步用户信息
user.sync_from_external_system()
```

### 手动触发组织同步

```python
from organizations.models import Organization

org = Organization.objects.get(id=1)

# 从外部系统同步组织成员
org.sync_members_from_external()
```

## 定时任务

使用 Celery 定时同步用户信息：

```python
# 在 celery.py 中添加

from celery import shared_task
from django.contrib.auth import get_user_model

@shared_task
def sync_all_users():
    """定时同步所有用户"""
    User = get_user_model()
    
    for user in User.objects.filter(external_user_id__isnull=False):
        user.sync_from_external_system()

# 配置定时任务
from celery.schedules import crontab

app.conf.beat_schedule = {
    'sync-users-every-hour': {
        'task': 'tasks.sync_all_users',
        'schedule': crontab(minute=0),  # 每小时执行
    },
}
```

## 权限控制

### 自定义权限检查

```python
# 在 custom_auth/mixins.py 中扩展

class CustomUserMixin:
    def has_project_permission(self, project, permission='view'):
        """检查用户对项目的权限"""
        # 调用外部 API 检查权限
        response = requests.get(
            f'{settings.EXTERNAL_AUTH_API_URL}/permissions/check',
            params={
                'user_id': self.external_user_id,
                'project_id': project.id,
                'permission': permission
            }
        )
        
        return response.json().get('has_permission', False)
```

## 故障排查

### 问题 1: 认证失败

```bash
# 检查日志
tail -f label_studio/logs/label_studio.log | grep "External auth"

# 测试外部 API 连接
python manage.py shell
>>> from custom_auth.backends import ExternalAuthBackend
>>> backend = ExternalAuthBackend()
>>> result = backend._authenticate_external('username', 'password')
>>> print(result)
```

### 问题 2: 用户同步失败

```bash
# 查看同步日志
python manage.py sync_external_users --verbosity=2

# 手动测试同步
python manage.py shell
>>> from django.contrib.auth import get_user_model
>>> User = get_user_model()
>>> user = User.objects.first()
>>> user.sync_from_external_system()
```

## 安全建议

1. ✅ 使用 HTTPS 连接外部 API
2. ✅ 定期轮换 API Token
3. ✅ 设置合理的超时时间
4. ✅ 记录所有认证失败日志
5. ✅ 实现速率限制防止暴力破解
6. ✅ 加密存储敏感配置

## 更多资源

- [Django Authentication Backends](https://docs.djangoproject.com/en/stable/topics/auth/customizing/)
- [django-auth-ldap Documentation](https://django-auth-ldap.readthedocs.io/)
- [social-auth-app-django Documentation](https://python-social-auth.readthedocs.io/)
