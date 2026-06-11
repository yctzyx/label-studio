"""Inline task media as base64 data URLs for ML backend predict requests."""
import base64
import logging
import mimetypes
import re
from copy import deepcopy
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, unquote, urlparse

from data_import.models import FileUpload
from tasks.models import Task

logger = logging.getLogger(__name__)

_IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg')
_PARENT_DATASET_OBJECT_RE = re.compile(r'^/api/projects/(?P<project_id>\d+)/parent-dataset/object/?$')


def _looks_like_image(value: str) -> bool:
    if value.startswith('data:image'):
        return True
    lower = value.lower().split('?')[0]
    return any(lower.endswith(ext) for ext in _IMAGE_EXTENSIONS)


def _parent_dataset_object_key(value: str, project) -> Optional[str]:
    """从 /api/projects/<id>/parent-dataset/object?key=... 解析 S3 object key。"""
    parsed = urlparse(value)
    path = parsed.path or value
    match = _PARENT_DATASET_OBJECT_RE.match(path)
    if not match:
        return None
    if int(match.group('project_id')) != project.pk:
        return None
    raw_key = parse_qs(parsed.query).get('key', [None])[0]
    if not raw_key:
        return None
    return unquote(raw_key)


def _looks_like_inlineable_media(value: str, project) -> bool:
    if _looks_like_image(value):
        return True
    object_key = _parent_dataset_object_key(value, project)
    return bool(object_key and _looks_like_image(object_key))


def _extract_upload_filepath(value: str) -> Optional[str]:
    if 'storage-data/uploaded' in value:
        parsed = urlparse(value)
        filepath = parse_qs(parsed.query).get('filepath', [None])[0]
        if filepath:
            return unquote(filepath)

    path = urlparse(value).path if '://' in value else value
    path = path.split('?')[0]
    prepared = Task.prepare_filename(path)
    if not prepared:
        return None
    if prepared.startswith('/'):
        prepared = prepared[1:]
    # prepare_filename expects "/data/upload/..."; bare "data/upload/..." may slip through
    if prepared.startswith('data/'):
        prepared = prepared[len('data/') :]
    return prepared


def _read_parent_dataset_object_bytes(project, object_key: str) -> Optional[bytes]:
    try:
        from parent_integration.parent_dataset_context import load_parent_dataset_context
        from parent_integration.s3_sync import build_s3_client, key_allowed_under_prefix

        _dataset_id, _source_id, _md, db_row, prefix = load_parent_dataset_context(project)
        if not key_allowed_under_prefix(object_key, prefix):
            logger.warning('Parent-dataset key not allowed for ML inline: %s', object_key)
            return None

        bucket = (db_row.bucket_name or '').strip()
        if not bucket:
            return None

        client = build_s3_client(db_row)
        resp = client.get_object(Bucket=bucket, Key=object_key)
        try:
            return resp['Body'].read()
        finally:
            try:
                resp['Body'].close()
            except Exception:
                pass
    except Exception:
        logger.warning('Could not read parent-dataset object for ML predict inline: %s', object_key, exc_info=True)
        return None


def _read_upload_file_bytes(project, filepath: str) -> Optional[bytes]:
    if not Task.is_upload_file(filepath):
        return None

    file_upload = FileUpload.objects.filter(project=project, file=filepath).first()
    if file_upload is None:
        return None

    if not file_upload.file.storage.exists(file_upload.file.name):
        return None

    with file_upload.file.open('rb') as file_obj:
        return file_obj.read()


def _to_data_url(content: bytes, filepath: str) -> str:
    content_type, _ = mimetypes.guess_type(filepath)
    content_type = content_type or 'application/octet-stream'
    encoded = base64.b64encode(content).decode('ascii')
    return f'data:{content_type};base64,{encoded}'


def _inline_value(project, value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _inline_value(project, item) for key, item in value.items()}

    if isinstance(value, list):
        return [_inline_value(project, item) for item in value]

    if not isinstance(value, str) or not _looks_like_inlineable_media(value, project):
        return value

    if value.startswith('data:'):
        return value

    object_key = _parent_dataset_object_key(value, project)
    if object_key:
        content = _read_parent_dataset_object_bytes(project, object_key)
        if content is None:
            logger.warning('Could not read parent-dataset object for ML predict inline: %s', object_key)
            return value
        return _to_data_url(content, object_key)

    filepath = _extract_upload_filepath(value)
    if not filepath:
        return value

    content = _read_upload_file_bytes(project, filepath)
    if content is None:
        logger.warning('Could not read upload file for ML predict inline: %s', filepath)
        return value

    return _to_data_url(content, filepath)


def inline_task_media_as_base64(tasks: List[Dict], project) -> List[Dict]:
    """Return a copy of tasks with image fields replaced by base64 data URLs."""
    inlined_tasks = []
    for task in tasks:
        task_copy = deepcopy(task)
        data = task_copy.get('data')
        if isinstance(data, dict):
            task_copy['data'] = _inline_value(project, data)
        inlined_tasks.append(task_copy)
    return inlined_tasks
