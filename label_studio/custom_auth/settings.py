"""
自定义认证配置
在 label_studio/core/settings/base.py 中导入此配置
"""

# ============================================
# 自定义 Mixin 配置
# ============================================

# 用户 Mixin
USER_MIXIN = 'custom_auth.mixins.CustomUserMixin'

# 组织 Mixin
ORGANIZATION_MIXIN = 'custom_auth.mixins.CustomOrganizationMixin'

# 组织成员 Mixin
ORGANIZATION_MEMBER_MIXIN = 'custom_auth.mixins.CustomOrganizationMemberMixin'


# ============================================
# 认证后端配置
# ============================================

AUTHENTICATION_BACKENDS = [
    # 自定义外部认证后端（优先级最高）
    'custom_auth.backends.ExternalAuthBackend',
    
    # LDAP 认证（可选）
    # 'custom_auth.backends.LDAPAuthBackend',
    
    # OAuth2 认证（可选）
    # 'custom_auth.backends.OAuth2Backend',
    
    # Django 权限后端
    'rules.permissions.ObjectPermissionBackend',
    
    # Django 默认认证后端（兜底）
    'django.contrib.auth.backends.ModelBackend',
]


# ============================================
# 外部 API 配置
# ============================================

# 外部认证 API 配置
EXTERNAL_AUTH_API_URL = 'https://your-api.com'
EXTERNAL_AUTH_API_TOKEN = 'your-api-token'
EXTERNAL_AUTH_TIMEOUT = 5  # 秒

# 是否启用外部认证
EXTERNAL_AUTH_ENABLED = True

# 是否自动同步用户信息
EXTERNAL_AUTH_AUTO_SYNC = True

# 同步间隔（秒）
EXTERNAL_AUTH_SYNC_INTERVAL = 3600  # 1小时


# ============================================
# 主平台 Token 认证（无界/网关集成）
# ============================================
# 启用后，请求头 Authorization: Bearer <主平台token> 会优先由此认证类处理并映射到 LS 用户
MAIN_PLATFORM_AUTH_ENABLED = False  # 可通过环境变量 MAIN_PLATFORM_AUTH_ENABLED=1 开启
# 主平台校验 token 并返回用户信息的接口 URL，例如 https://main-platform.com/api/user/me
MAIN_PLATFORM_AUTH_USER_URL = ''  # 或设置环境变量 MAIN_PLATFORM_AUTH_USER_URL
MAIN_PLATFORM_AUTH_TIMEOUT = 5  # 秒


# ============================================
# LDAP 配置（如果使用 LDAP）
# ============================================

# import ldap
# from django_auth_ldap.config import LDAPSearch, GroupOfNamesType
# 
# AUTH_LDAP_SERVER_URI = 'ldap://ldap.example.com'
# AUTH_LDAP_BIND_DN = 'cn=admin,dc=example,dc=com'
# AUTH_LDAP_BIND_PASSWORD = 'password'
# AUTH_LDAP_USER_SEARCH = LDAPSearch(
#     'ou=users,dc=example,dc=com',
#     ldap.SCOPE_SUBTREE,
#     '(uid=%(user)s)'
# )
# 
# AUTH_LDAP_USER_ATTR_MAP = {
#     'first_name': 'givenName',
#     'last_name': 'sn',
#     'email': 'mail',
# }


# ============================================
# OAuth2 配置（如果使用 OAuth2）
# ============================================

# SOCIAL_AUTH_GOOGLE_OAUTH2_KEY = 'your-client-id'
# SOCIAL_AUTH_GOOGLE_OAUTH2_SECRET = 'your-client-secret'
# 
# SOCIAL_AUTH_GITHUB_KEY = 'your-client-id'
# SOCIAL_AUTH_GITHUB_SECRET = 'your-client-secret'
