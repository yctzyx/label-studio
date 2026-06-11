"""REST API：读取本库镜像表 `data_database` / `md_data_set`（由定时同步从父平台库写入）。"""

import logging

from django.conf import settings
from django.db import OperationalError, ProgrammingError
from django.db.models import Q
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from parent_integration.models import DataDatabase, MdDataSet

logger = logging.getLogger(__name__)

# md_data_set.data_set_type 字典值 -> 中文（与业务枚举 IMAGE(1)…GENERAL(5) 一致）
_DATA_SET_TYPE_CN = {
    1: '图像',
    2: '视频',
    3: '文档',
    4: '音频',
    5: '通用',
}


def _parse_data_set_type_code(raw) -> int | None:
    if raw is None or raw == '':
        return None
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return None


def _data_set_type_label_cn(code: int | None) -> str | None:
    if code is None:
        return None
    return _DATA_SET_TYPE_CN.get(code)


def _ok(data: dict):
    return Response({'data': data})


def _db_error(exc: Exception):
    logger.exception('parent_integration database error: %s', exc)
    return Response({'detail': '查询父平台数据失败，请检查数据库连接与表是否存在。', 'code': 'PARENT_DB_ERROR'}, status=503)


class ParentPlatformDatabaseListAPI(APIView):
    """
    数据源列表（对应表 `data_database`）。
    查询参数：page（默认 1）、limit（默认 500）、projectId（可选）。
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        summary='List parent platform databases (data_database)',
        tags=['Parent integration'],
    )
    def get(self, request):
        try:
            page = max(1, int(request.query_params.get('page') or 1))
            limit = min(2000, max(1, int(request.query_params.get('limit') or 500)))
        except (TypeError, ValueError):
            page, limit = 1, 500

        project_id = request.query_params.get('projectId') or request.query_params.get('project_id')
        qs = DataDatabase.objects.filter(Q(deleted__isnull=True) | Q(deleted=0)).order_by('-id')
        if project_id not in (None, ''):
            try:
                qs = qs.filter(project_id=int(project_id))
            except (TypeError, ValueError):
                pass

        try:
            total = qs.count()
            offset = (page - 1) * limit
            rows = qs[offset : offset + limit]
        except (OperationalError, ProgrammingError) as e:
            return _db_error(e)

        items = [
            {
                'id': r.id,
                'name': r.name,
                'databaseType': r.database_type,
            }
            for r in rows
        ]
        return _ok({'list': items, 'totalCount': total, 'total': total, 'count': total})


class ParentPlatformDatasetListAPI(APIView):
    """
    数据集分页（对应表 `md_data_set`）。
    查询参数：pageNum、pageSize、sourceId（可选，对应 source_id）。
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        summary='List parent platform datasets (md_data_set)',
        tags=['Parent integration'],
    )
    def get(self, request):
        try:
            page_num = max(1, int(request.query_params.get('pageNum') or request.query_params.get('page') or 1))
            page_size = min(500, max(1, int(request.query_params.get('pageSize') or request.query_params.get('limit') or 20)))
        except (TypeError, ValueError):
            page_num, page_size = 1, 20

        source_id = request.query_params.get('sourceId') or request.query_params.get('source_id')
        qs = MdDataSet.objects.filter(Q(is_deleted__isnull=True) | Q(is_deleted=0)).order_by('-id')
        if source_id not in (None, ''):
            try:
                qs = qs.filter(source_id=int(source_id))
            except (TypeError, ValueError):
                pass

        try:
            total = qs.count()
            offset = (page_num - 1) * page_size
            rows = list(qs[offset : offset + page_size])
        except (OperationalError, ProgrammingError) as e:
            return _db_error(e)

        source_ids = [sid for r in rows if (sid := r.source_id)]
        name_by_source = {}
        if source_ids:
            try:
                for db in DataDatabase.objects.filter(id__in=set(source_ids)).only('id', 'name'):
                    name_by_source[db.id] = db.name or ''
            except (OperationalError, ProgrammingError) as e:
                return _db_error(e)

        items = []
        for r in rows:
            sid = r.source_id or 0
            type_code = _parse_data_set_type_code(r.data_set_type)
            items.append(
                {
                    'id': r.id,
                    'dataSetName': r.data_set_name or '',
                    'sourceId': sid,
                    'sourceName': name_by_source.get(sid, '') if sid else '',
                    'path': r.path or '',
                    'dataSetType': r.data_set_type or None,
                    'dataSetTypeLabel': _data_set_type_label_cn(type_code),
                }
            )
        return _ok({'list': items, 'totalCount': total, 'total': total, 'count': total})


class PubDirectorySyncAPI(APIView):
    """
    触发 `sync_pub_directory`：将 pub_org / pub_user / pub_user_org 同步到 Label Studio。
    仅 Django staff / superuser 可调用。
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        summary='Sync pub_org/pub_user/pub_user_org to organizations and users',
        tags=['Parent integration'],
    )
    def post(self, request):
        user = request.user
        if not (getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False)):
            raise PermissionDenied('仅管理员可执行目录同步')
        from parent_integration.pub_directory_sync import sync_pub_directory

        try:
            stats = sync_pub_directory(dry_run=False, prune_memberships=False)
        except Exception as e:
            logger.exception('sync_pub_directory failed')
            return Response(
                {'detail': str(e), 'code': 'SYNC_PUB_DIRECTORY_FAILED'},
                status=500,
            )
        return Response({'ok': True, **stats})


class ParentDatasetSyncAPI(APIView):
    """
    触发 `sync_parent_dataset_tables`：将 data_database / md_data_set 从父平台库同步到本库。
    仅 Django staff / superuser 可调用。
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        summary='Sync data_database/md_data_set from parent platform DB to local mirror',
        tags=['Parent integration'],
    )
    def post(self, request):
        user = request.user
        if not (getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False)):
            raise PermissionDenied('仅管理员可执行数据集元数据同步')
        from parent_integration.parent_dataset_sync import sync_parent_dataset_tables

        prune = bool(getattr(settings, 'PARENT_DATASET_SYNC_PRUNE', False))
        try:
            stats = sync_parent_dataset_tables(dry_run=False, prune=prune)
        except Exception as e:
            logger.exception('sync_parent_dataset_tables failed')
            return Response(
                {'detail': str(e), 'code': 'SYNC_PARENT_DATASET_FAILED'},
                status=500,
            )
        return Response({'ok': True, **stats})
