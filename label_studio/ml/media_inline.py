"""Inline task media as base64 data URLs for ML backend predict requests."""
import base64
import logging
import mimetypes
from copy import deepcopy
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, unquote, urlparse

from data_import.models import FileUpload
from tasks.models import Task

logger = logging.getLogger(__name__)

_IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg')


def _looks_like_image(value: str) -> bool:
    if value.startswith('data:image'):
        return True
    lower = value.lower().split('?')[0]
    return any(lower.endswith(ext) for ext in _IMAGE_EXTENSIONS)


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

    if not isinstance(value, str) or not _looks_like_image(value):
        return value

    if value.startswith('data:'):
        return value

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
