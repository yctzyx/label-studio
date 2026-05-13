"""
主平台/网关认证（无界集成）
- GatewayJwtUserAuth: 请求头 jwt-user 为 Base64(JSON 用户信息)，网关解析 token 后注入，LS 直接解析映射用户。
- MainPlatformBearerAuth: 请求头 Authorization: Bearer <token>，LS 调主平台接口校验并映射用户。
"""
import base64
import json
import logging

import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import authentication
from rest_framework.exceptions import AuthenticationFailed

logger = logging.getLogger(__name__)


class GatewayJwtUserAuth(authentication.BaseAuthentication):
    """
    从请求头 jwt-user 读取网关注入的用户信息（Base64 编码的 JSON），
    解析后映射到 LS 用户。网关在鉴权后可将用户信息 Base64 放入此头转发给 LS。
    """

    header_name = "jwt-user"

    def authenticate(self, request):
        raw = request.META.get(f"HTTP_{self.header_name.upper().replace('-', '_')}") or request.META.get(
            "HTTP_JWT_USER"
        )
        if not raw or not raw.strip():
            return None

        user_info = self._decode_user_info(raw.strip())
        if not user_info:
            return None

        logger.info("[LS-embed] jwt-user auth success user_info=%s", user_info)
        user = _get_or_create_user_from_info(user_info)
        return (user, raw)

    def _decode_user_info(self, raw):
        """Base64 解码后解析为 JSON，返回用户信息 dict 或 None。"""
        try:
            decoded = base64.b64decode(raw)
            if isinstance(decoded, bytes):
                decoded = decoded.decode("utf-8")
            data = json.loads(decoded)
            return data if isinstance(data, dict) else None
        except (ValueError, TypeError, json.JSONDecodeError) as e:
            logger.warning("jwt-user decode/parse failed: %s", e)
            return None


class MainPlatformBearerAuth(authentication.BaseAuthentication):
    """
    从 Authorization: Bearer <token> 读取主平台 token，
    调用主平台用户信息接口校验并映射到 Label Studio User。
    """

    keyword = "Bearer"

    def authenticate(self, request):
        auth_header = authentication.get_authorization_header(request)
        if not auth_header:
            return None

        parts = auth_header.decode("utf-8").split()
        if len(parts) != 2 or parts[0] != self.keyword:
            return None

        token = parts[1].strip()
        if not token:
            return None

        if not getattr(settings, "MAIN_PLATFORM_AUTH_ENABLED", False):
            return None

        user_url = getattr(settings, "MAIN_PLATFORM_AUTH_USER_URL", "") or ""
        if not user_url.strip():
            return None

        user_info = self._validate_token_and_get_user(user_url, token, request)
        if not user_info:
            raise AuthenticationFailed("主平台 Token 无效或已过期")

        user = _get_or_create_user_from_info(user_info)
        return (user, token)

    def _validate_token_and_get_user(self, url, token, request):
        """调用主平台接口，携带 Bearer token，返回用户信息 dict 或 None。"""
        timeout = getattr(settings, "MAIN_PLATFORM_AUTH_TIMEOUT", 5)
        try:
            resp = requests.get(
                url.strip(),
                headers={"Authorization": f"Bearer {token}"},
                timeout=timeout,
            )
            if resp.status_code != 200:
                logger.warning("Main platform auth returned status %s for %s", resp.status_code, url)
                return None
            data = resp.json()
            if not isinstance(data, dict):
                return None
            return data
        except requests.RequestException as e:
            logger.warning("Main platform auth request failed: %s", e)
            return None


def _get_or_create_user_from_info(user_info):
    """根据用户信息 dict 获取或创建 LS User。支持多种字段名：id/userId/user_id/sub, email/username/userName, first_name/last_name 等。"""
    User = get_user_model()
    external_id = (
        user_info.get("id")
        or user_info.get("userId")
        or user_info.get("user_id")
        or user_info.get("sub")
    )
    email = (
        user_info.get("email")
        or user_info.get("username")
        or user_info.get("userName")
        or user_info.get("user_name")
    )
    # 若无 email/username，尝试用 userId/id 作为唯一标识（LS 的 username 必填）
    if not email:
        email = str(external_id) if external_id else None
    if not email:
        logger.warning("jwt-user 缺少用户标识，收到的 keys: %s", list(user_info.keys()))
        raise AuthenticationFailed("未返回用户标识(email/username/userId)")

    username = (
        user_info.get("username")
        or user_info.get("userName")
        or user_info.get("user_name")
        or email
    )
    first_name = user_info.get("first_name") or user_info.get("given_name") or ""
    last_name = user_info.get("last_name") or user_info.get("family_name") or ""

    user = None
    if external_id and hasattr(User, "external_user_id"):
        try:
            user = User.objects.get(external_user_id=str(external_id))
        except User.DoesNotExist:
            pass

    if user is None:
        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            user = User.objects.create_user(
                email=email,
                password=None,
                username=username[:256] if username else email[:256],
                first_name=first_name[:256] if first_name else "",
                last_name=last_name[:256] if last_name else "",
            )

    if external_id and hasattr(user, "external_user_id"):
        user.external_user_id = str(external_id)
    if hasattr(user, "external_source"):
        user.external_source = "main_platform"
    if hasattr(user, "external_synced_at"):
        user.external_synced_at = timezone.now()
    user.first_name = first_name or user.first_name
    user.last_name = last_name or user.last_name
    if getattr(user, "username", None) is not None:
        user.username = username
    user.save()

    if not user.active_organization_id:
        from organizations.functions import create_organization
        from organizations.models import Organization, OrganizationMember

        # 已有未删除的成员关系（仅 active_organization 未同步时）
        active_membership = (
            OrganizationMember.objects.filter(user=user, deleted_at__isnull=True)
            .select_related("organization")
            .order_by("pk")
            .first()
        )
        if active_membership is not None:
            user.active_organization = active_membership.organization
            user.save(update_fields=["active_organization"])
        else:
            org = Organization.objects.order_by("pk").first()
            if org is not None:
                org.add_user(user)
                user.active_organization = org
                user.save(update_fields=["active_organization"])
            else:
                # 初次安装空库：无组织时创建默认组织并关联当前用户（与原生注册行为一致）
                org = create_organization(created_by=user, title="Label Studio")
                user.active_organization = org
                user.save(update_fields=["active_organization"])

    return user
