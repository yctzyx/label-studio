# Label Studio 自定义用户组织集成 - 快速配置指南

## 📋 目录

1. [组织用户设计分析](#组织用户设计分析)
2. [集成方案](#集成方案)
3. [快速开始](#快速开始)
4. [实际案例](#实际案例)

---

## 组织用户设计分析

### 核心架构

Label Studio 采用 **多租户 + 软删除** 的组织用户设计：

```
┌─────────────────────────────────────────────────────────┐
│                      Organization                        │
│  - id, title, token                                     │
│  - created_by (创建者)                                  │
│  - users (多对多关系)                                   │
└─────────────────────────────────────────────────────────┘
                         ↕ (多对多)
┌─────────────────────────────────────────────────────────┐
│                  OrganizationMember                      │
│  - user_id, organization_id                             │
│  - deleted_at (软删除标记)                              │
│  - external_role (扩展字段)                             │
└─────────────────────────────────────────────────────────┘
                         ↕ (多对多)
┌─────────────────────────────────────────────────────────┐
│                         User                             │
│  - id, email, username                                  │
│  - active_organization (当前激活组织)                   │
│  - external_user_id (扩展字段)                          │
│  - external_source (扩展字段)                           │
└─────────────────────────────────────────────────────────┘
```

### 设计特点

✅ **多租户隔离**: 一个用户可以属于多个组织  
✅ **软删除**: 通过 `deleted_at` 字段标记删除，不真正删除数据  
✅ **扩展性**: 使用 Mixin 模式，可以无侵入式扩展  
✅ **权限控制**: 基于组织的数据隔离和权限管理  

---

## 集成方案

### 方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **Mixin 扩展** | 无侵入、易维护 | 需要重启服务 | ⭐ 推荐，适合大多数场景 |
| **自定义认证后端** | 灵活、支持多种认证 | 配置复杂 | 企业 SSO、LDAP |
| **API 中间件** | 实时同步 | 性能开销 | 需要实时验证的场景 |
| **定时同步** | 简单、可靠 | 有延迟 | 用户信息变化不频繁 |

### 推荐架构

```
外部系统 (LDAP/OAuth/自定义API)
         ↓
   认证后端 (backends.py)
         ↓ 认证成功
   同步用户信息 (mixins.py)
         ↓
   创建/更新本地用户
         ↓
   同步组织关系
         ↓
   Label Studio 正常使用
```

---

## 快速开始

### 步骤 1: 启用自定义认证模块

编辑 `label_studio/core/settings/base.py`，在文件**末尾**添加：

```python
# ============================================
# 自定义用户组织集成
# ============================================
try:
    from custom_auth.settings import *
    logger.info('✓ Custom authentication module loaded')
except ImportError:
    logger.warning('Custom authentication module not found')
```

### 步骤 2: 配置外部 API

编辑 `label_studio/custom_auth/settings.py`:

```python
# 外部认证 API 配置
EXTERNAL_AUTH_API_URL = 'https://your-company-api.com'
EXTERNAL_AUTH_API_TOKEN = 'your-secret-token'
EXTERNAL_AUTH_ENABLED = True
```

### 步骤 3: 实现认证逻辑

编辑 `label_studio/custom_auth/backends.py`，实现 `_authenticate_external` 方法：

```python
def _authenticate_external(self, username, password):
    """调用你的外部 API 进行认证"""
    import requests
    from django.conf import settings
    
    try:
        response = requests.post(
            f'{settings.EXTERNAL_AUTH_API_URL}/api/v1/auth/login',
            json={
                'username': username,
                'password': password
            },
            headers={
                'Authorization': f'Bearer {settings.EXTERNAL_AUTH_API_TOKEN}',
                'Content-Type': 'application/json'
            },
            timeout=5
        )
        
        if response.status_code == 200:
            data = response.json()
            return {
                'id': data['user_id'],              # 必需
                'email': data['email'],              # 必需
                'username': data.get('username'),    # 可选
                'first_name': data.get('first_name'), # 可选
                'last_name': data.get('last_name'),  # 可选
                'organizations': data.get('orgs', []) # 可选
            }
    except Exception as e:
        logger.error(f'External auth failed: {e}')
    
    return None
```

### 步骤 4: 运行迁移

```bash
cd label_studio
python manage.py makemigrations
python manage.py migrate
```

### 步骤 5: 测试认证

```bash
# 启动服务
python manage.py runserver

# 访问 http://localhost:8080
# 使用外部系统的用户名密码登录
```

---

## 实际案例

### 案例 1: 对接公司内部 API

**场景**: 公司有自己的用户管理系统，提供 REST API

**实现**:

```python
# custom_auth/backends.py

def _authenticate_external(self, username, password):
    """对接公司内部 API"""
    import requests
    
    # 1. 调用公司认证接口
    auth_response = requests.post(
        'https://internal.company.com/api/auth',
        json={'username': username, 'password': password},
        headers={'X-API-Key': 'company-api-key'}
    )
    
    if auth_response.status_code != 200:
        return None
    
    user_id = auth_response.json()['user_id']
    
    # 2. 获取用户详细信息
    user_response = requests.get(
        f'https://internal.company.com/api/users/{user_id}',
        headers={'X-API-Key': 'company-api-key'}
    )
    
    user_data = user_response.json()
    
    # 3. 获取用户所属部门（映射为组织）
    dept_response = requests.get(
        f'https://internal.company.com/api/users/{user_id}/departments',
        headers={'X-API-Key': 'company-api-key'}
    )
    
    departments = dept_response.json()
    
    return {
        'id': user_id,
        'email': user_data['email'],
        'first_name': user_data['name'].split()[0],
        'last_name': user_data['name'].split()[-1],
        'organizations': [
            {'id': dept['id'], 'name': dept['name']}
            for dept in departments
        ]
    }
```

### 案例 2: LDAP/AD 集成

**场景**: 企业使用 Active Directory 管理用户

**实现**:

```bash
# 1. 安装依赖
pip install python-ldap django-auth-ldap
```

```python
# custom_auth/settings.py

import ldap
from django_auth_ldap.config import LDAPSearch, GroupOfNamesType

# LDAP 服务器配置
AUTH_LDAP_SERVER_URI = 'ldap://ad.company.com'
AUTH_LDAP_BIND_DN = 'cn=labelstudio,ou=services,dc=company,dc=com'
AUTH_LDAP_BIND_PASSWORD = 'service-password'

# 用户搜索配置
AUTH_LDAP_USER_SEARCH = LDAPSearch(
    'ou=employees,dc=company,dc=com',
    ldap.SCOPE_SUBTREE,
    '(sAMAccountName=%(user)s)'  # AD 用户名字段
)

# 字段映射
AUTH_LDAP_USER_ATTR_MAP = {
    'first_name': 'givenName',
    'last_name': 'sn',
    'email': 'mail',
}

# 组映射（部门 → 组织）
AUTH_LDAP_GROUP_SEARCH = LDAPSearch(
    'ou=departments,dc=company,dc=com',
    ldap.SCOPE_SUBTREE,
    '(objectClass=group)'
)

AUTH_LDAP_GROUP_TYPE = GroupOfNamesType()

# 启用 LDAP 后端
AUTHENTICATION_BACKENDS = [
    'custom_auth.backends.LDAPAuthBackend',
    'django.contrib.auth.backends.ModelBackend',
]
```

### 案例 3: OAuth2/Google SSO

**场景**: 使用 Google Workspace 作为身份提供商

**实现**:

```bash
# 1. 安装依赖
pip install social-auth-app-django
```

```python
# custom_auth/settings.py

# Google OAuth2 配置
SOCIAL_AUTH_GOOGLE_OAUTH2_KEY = 'your-client-id.apps.googleusercontent.com'
SOCIAL_AUTH_GOOGLE_OAUTH2_SECRET = 'your-client-secret'

# 限制域名
SOCIAL_AUTH_GOOGLE_OAUTH2_WHITELISTED_DOMAINS = ['company.com']

# 字段映射
SOCIAL_AUTH_GOOGLE_OAUTH2_SCOPE = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
]

# 添加到认证后端
AUTHENTICATION_BACKENDS = [
    'social_core.backends.google.GoogleOAuth2',
    'django.contrib.auth.backends.ModelBackend',
]

# 添加到 INSTALLED_APPS
INSTALLED_APPS += ['social_django']
```

```python
# urls.py

urlpatterns = [
    # ... 其他路由
    path('oauth/', include('social_django.urls', namespace='social')),
]
```

### 案例 4: 定时同步用户信息

**场景**: 每小时从外部系统同步用户信息

**实现**:

```python
# custom_auth/tasks.py (Celery 任务)

from celery import shared_task
from django.contrib.auth import get_user_model
from organizations.models import Organization
import logging

logger = logging.getLogger(__name__)
User = get_user_model()

@shared_task
def sync_all_users():
    """同步所有用户信息"""
    users = User.objects.filter(external_user_id__isnull=False)
    
    for user in users:
        try:
            user.sync_from_external_system()
            logger.info(f'Synced user: {user.email}')
        except Exception as e:
            logger.error(f'Failed to sync user {user.email}: {e}')

@shared_task
def sync_all_organizations():
    """同步所有组织成员"""
    orgs = Organization.objects.filter(external_org_id__isnull=False)
    
    for org in orgs:
        try:
            org.sync_members_from_external()
            logger.info(f'Synced org: {org.title}')
        except Exception as e:
            logger.error(f'Failed to sync org {org.title}: {e}')
```

```python
# celery.py

from celery.schedules import crontab

app.conf.beat_schedule = {
    'sync-users-hourly': {
        'task': 'custom_auth.tasks.sync_all_users',
        'schedule': crontab(minute=0),  # 每小时
    },
    'sync-orgs-daily': {
        'task': 'custom_auth.tasks.sync_all_organizations',
        'schedule': crontab(hour=2, minute=0),  # 每天凌晨2点
    },
}
```

---

## 常见问题

### Q1: 如何处理用户在外部系统被删除？

**A**: 在同步时检查用户状态，软删除本地用户：

```python
def sync_from_external_system(self):
    response = requests.get(f'{API_URL}/users/{self.external_user_id}')
    
    if response.status_code == 404:
        # 用户在外部系统已删除
        self.is_active = False
        self.save()
        return
    
    # 正常同步...
```

### Q2: 如何实现单点登出（SSO Logout）？

**A**: 在用户登出时调用外部 API：

```python
# custom_auth/views.py

from django.contrib.auth import logout
from django.http import HttpResponseRedirect

def custom_logout(request):
    user = request.user
    
    # 调用外部登出 API
    if user.external_user_id:
        requests.post(
            f'{settings.EXTERNAL_AUTH_API_URL}/logout',
            json={'user_id': user.external_user_id}
        )
    
    logout(request)
    return HttpResponseRedirect('/login')
```

### Q3: 如何处理权限同步？

**A**: 在 Mixin 中实现权限检查：

```python
class CustomUserMixin:
    def has_project_permission(self, project, action='view'):
        """实时检查外部系统权限"""
        response = requests.get(
            f'{settings.EXTERNAL_AUTH_API_URL}/permissions',
            params={
                'user_id': self.external_user_id,
                'resource': f'project:{project.id}',
                'action': action
            }
        )
        return response.json().get('allowed', False)
```

---

## 总结

Label Studio 的组织用户设计非常灵活，通过 **Mixin 扩展 + 自定义认证后端** 的方式，可以无侵入地接入任何外部用户系统。

**核心要点**:
1. ✅ 使用 Mixin 扩展模型字段
2. ✅ 实现自定义认证后端
3. ✅ 同步用户和组织信息
4. ✅ 保持数据一致性

**下一步**:
- 根据你的实际需求选择合适的集成方案
- 实现认证逻辑和同步逻辑
- 测试和部署

如有问题，请查看 `label_studio/custom_auth/README.md` 获取更多详细信息。
