"""父平台数据集绑定解析（project.parent_platform_dataset → md_data_set / data_database）。"""

from __future__ import annotations

from typing import Any

from parent_integration.models import DataDatabase, MdDataSet
from parent_integration.s3_sync import _normalize_prefix
from projects.models import Project
from rest_framework.exceptions import ValidationError


def binding_get(binding: dict, *keys: str) -> Any:
    for k in keys:
        if k in binding and binding[k] not in (None, ''):
            return binding[k]
    return None


def load_parent_dataset_context(project: Project):
    """校验绑定并返回 (dataset_id, source_id, md, db_row, prefix)。"""
    binding = project.parent_platform_dataset
    if not binding or not isinstance(binding, dict):
        raise ValidationError({'parent_platform_dataset': '请先在导入页选择父平台数据集并保存到项目'})

    dataset_id = binding_get(binding, 'dataset_id', 'datasetId')
    source_id = binding_get(binding, 'source_id', 'sourceId')
    if dataset_id is None or source_id is None:
        raise ValidationError({'parent_platform_dataset': '缺少 dataset_id 或 source_id'})
    try:
        dataset_id = int(dataset_id)
        source_id = int(source_id)
    except (TypeError, ValueError):
        raise ValidationError({'parent_platform_dataset': 'dataset_id / source_id 无效'})

    try:
        md = MdDataSet.objects.get(pk=dataset_id)
    except MdDataSet.DoesNotExist:
        raise ValidationError({'dataset_id': 'md_data_set 记录不存在'})

    if md.source_id and int(md.source_id) != source_id:
        raise ValidationError({'source_id': '数据源与数据集记录不一致'})

    try:
        db_row = DataDatabase.objects.get(pk=source_id)
    except DataDatabase.DoesNotExist:
        raise ValidationError({'source_id': 'data_database 记录不存在'})

    path_raw = md.path or binding_get(binding, 'path') or ''
    prefix = _normalize_prefix(str(path_raw))
    return dataset_id, source_id, md, db_row, prefix
