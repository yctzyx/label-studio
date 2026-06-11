"""S3 兼容存储列举与预签名 URL，用于父平台数据集同步为 Label Studio 任务。"""

from __future__ import annotations

import json
import logging
import os
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

from botocore.client import Config
from core.utils.params import get_env
from django.conf import settings

if TYPE_CHECKING:
    from parent_integration.models import DataDatabase

logger = logging.getLogger(__name__)

# data_set_type 字典码 -> 扩展名白名单（小写，含点）
_TYPE_EXT: dict[int, frozenset[str]] = {
    1: frozenset({'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff'}),
    2: frozenset({'.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v'}),
    3: frozenset({'.pdf', '.txt', '.md', '.html', '.htm', '.doc', '.docx'}),
    4: frozenset({'.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'}),
    5: frozenset(
        {
            '.jpg',
            '.jpeg',
            '.png',
            '.webp',
            '.gif',
            '.pdf',
            '.txt',
            '.md',
            '.mp3',
            '.wav',
            '.mp4',
        }
    ),
}


def parse_type_code(raw: Any) -> int | None:
    if raw is None or raw == '':
        return None
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return None


def _normalize_prefix(path: str | None) -> str:
    if not path:
        return ''
    p = path.strip().replace('\\', '/').lstrip('/')
    return p


def key_allowed_under_prefix(object_key: str, prefix: str) -> bool:
    """防止越权读取：object_key 必须在数据集 path 前缀之下，且禁止路径穿越。"""
    if not object_key or '..' in object_key:
        return False
    nk = object_key.strip().replace('\\', '/').lstrip('/')
    if not prefix:
        return bool(nk)
    p = _normalize_prefix(prefix).rstrip('/')
    if not p:
        return bool(nk)
    return nk == p or nk.startswith(p + '/')


def build_parent_dataset_proxy_path(project_id: int, object_key: str) -> str:
    """同源代理相对路径（浏览器请求 Label Studio，无 MinIO CORS 问题）。"""
    return f'/api/projects/{project_id}/parent-dataset/object?key={quote(object_key, safe="")}'


def _parse_config_json(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        out = json.loads(raw)
        return out if isinstance(out, dict) else {}
    except json.JSONDecodeError:
        return {}


def resolve_s3_endpoint(db: DataDatabase) -> str:
    """从 config_json、环境变量或 data_database.database_ip + database_port 推断 S3 endpoint URL。"""
    cfg = _parse_config_json(db.config_json)
    for key in ('s3_endpoint', 'endpoint', 'endpoint_url', 'minio_endpoint', 's3Endpoint'):
        v = cfg.get(key)
        if v and isinstance(v, str) and v.strip():
            return v.strip().rstrip('/')

    default = (getattr(settings, 'PARENT_PLATFORM_S3_DEFAULT_ENDPOINT', None) or '').strip() or get_env(
        'PARENT_PLATFORM_S3_DEFAULT_ENDPOINT', ''
    )
    if str(default).strip():
        return str(default).strip().rstrip('/')

    host = (db.database_ip or '').strip()
    if not host:
        return ''
    # 优先使用父平台 data_database.database_port（如 9018），避免误用 MinIO 默认 9000
    port = (db.database_port or '').strip() or get_env('PARENT_PLATFORM_S3_PORT', '9000')
    use_ssl = get_env('PARENT_PLATFORM_S3_USE_SSL', 'false').lower() in ('1', 'true', 'yes')
    scheme = 'https' if use_ssl else 'http'
    return f'{scheme}://{host}:{port}'


def build_s3_client(db: DataDatabase):
    import boto3

    endpoint = resolve_s3_endpoint(db)
    if not endpoint:
        raise ValueError('无法解析 S3 endpoint：请在 data_database.config_json 中配置 s3_endpoint，或设置 PARENT_PLATFORM_S3_DEFAULT_ENDPOINT / 数据库 IP')

    access_key = (db.access_key or '').strip()
    secret_key = (db.secret_key or '').strip()
    if not access_key or not secret_key:
        raise ValueError('data_database.access_key / secret_key 为空，无法连接对象存储')

    region = get_env('PARENT_PLATFORM_S3_REGION', 'us-east-1')
    cfg = _parse_config_json(db.config_json)
    addressing = (cfg.get('s3_addressing_style') or cfg.get('addressing_style') or 'path').lower()
    if addressing not in ('path', 'virtual'):
        addressing = 'path'

    client = boto3.client(
        's3',
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(
            signature_version='s3v4',
            s3={'addressing_style': addressing},
        ),
        region_name=region,
    )
    return client


def _ext_allowed(key: str, type_code: int) -> bool:
    ext = os.path.splitext(key.lower())[1]
    allowed = _TYPE_EXT.get(type_code) or _TYPE_EXT[5]
    return ext in allowed


def task_data_for_parent_proxy(type_code: int, project_id: int, object_key: str) -> dict:
    """构造任务 data：媒体 URL 为 LS 同源代理路径，避免浏览器直连 MinIO 跨域。"""
    path = build_parent_dataset_proxy_path(project_id, object_key)
    if type_code == 5:
        ext = os.path.splitext(object_key.lower())[1]
        if ext in _TYPE_EXT[1]:
            return {'image': path}
        if ext in _TYPE_EXT[2]:
            return {'video': path}
        if ext in _TYPE_EXT[4]:
            return {'audio': path}
        return {'text': path}
    return _task_data_for_type(type_code, path)


def _task_data_for_type(type_code: int, url: str) -> dict:
    if type_code == 1:
        return {'image': url}
    if type_code == 2:
        return {'video': url}
    if type_code == 3:
        return {'text': url}
    if type_code == 4:
        return {'audio': url}
    if type_code == 5:
        ext = os.path.splitext(url.lower())[1]
        if ext in _TYPE_EXT[1]:
            return {'image': url}
        if ext in _TYPE_EXT[2]:
            return {'video': url}
        if ext in _TYPE_EXT[4]:
            return {'audio': url}
        return {'text': url}
    return {'image': url}


def iter_object_keys(
    client,
    bucket: str,
    prefix: str,
    type_code: int,
    max_keys: int,
    on_key=None,
) -> list[str]:
    """列举对象 key，按扩展名过滤，最多 max_keys 条。on_key(key, count) 可选进度回调。"""
    keys: list[str] = []
    paginator = client.get_paginator('list_objects_v2')
    kwargs = {'Bucket': bucket, 'Prefix': prefix}
    for page in paginator.paginate(**kwargs):
        for obj in page.get('Contents') or []:
            key = obj.get('Key') or ''
            if not key or key.endswith('/'):
                continue
            if not _ext_allowed(key, type_code):
                continue
            keys.append(key)
            if on_key:
                on_key(key, len(keys))
            if len(keys) >= max_keys:
                return keys
    return keys


def presign_get_url(client, bucket: str, key: str, expires: int = 604800) -> str:
    return client.generate_presigned_url(
        'get_object',
        Params={'Bucket': bucket, 'Key': key},
        ExpiresIn=expires,
    )
