"""将父平台数据集（桶路径）同步为项目任务；同源代理读取对象避免 MinIO CORS。"""

from __future__ import annotations

import logging
from typing import Any

from botocore.exceptions import ClientError
from core.permissions import ViewClassPermission, all_permissions
from django.db import transaction
from django.http import Http404, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from parent_integration.models import DataDatabase, MdDataSet
from parent_integration.s3_sync import (
    build_s3_client,
    iter_object_keys,
    key_allowed_under_prefix,
    parse_type_code,
    task_data_for_parent_proxy,
    _normalize_prefix,
)
from projects.access import user_can_manage_project
from projects.models import Project
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from tasks.models import Task

logger = logging.getLogger(__name__)


def _binding_get(binding: dict, *keys: str) -> Any:
    for k in keys:
        if k in binding and binding[k] not in (None, ''):
            return binding[k]
    return None


def _load_parent_dataset_context(project: Project):
    """校验绑定并返回 (dataset_id, source_id, md, db_row, prefix)。"""
    binding = project.parent_platform_dataset
    if not binding or not isinstance(binding, dict):
        raise ValidationError({'parent_platform_dataset': '请先在导入页选择父平台数据集并保存到项目'})

    dataset_id = _binding_get(binding, 'dataset_id', 'datasetId')
    source_id = _binding_get(binding, 'source_id', 'sourceId')
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

    path_raw = md.path or _binding_get(binding, 'path') or ''
    prefix = _normalize_prefix(str(path_raw))
    return dataset_id, source_id, md, db_row, prefix


class ParentPlatformDatasetObjectProxyAPI(APIView):
    """
    GET /api/projects/<pk>/parent-dataset/object?key=<urlencoded s3 key>

    经 Label Studio 从 MinIO/S3 GetObject 流式转发，同源访问，避免浏览器直连对象存储的 CORS。
    """

    permission_classes = (IsAuthenticated,)
    permission_required = ViewClassPermission(GET=all_permissions.projects_view)

    @extend_schema(
        summary='Proxy GET object from parent platform S3 (same-origin)',
        tags=['Projects', 'Parent integration'],
        parameters=[
            OpenApiParameter(
                name='key',
                type=str,
                location=OpenApiParameter.QUERY,
                required=True,
                description='S3 对象 key（须落在已绑定数据集 path 前缀下）',
            ),
        ],
    )
    def get(self, request, pk):
        object_key = (request.query_params.get('key') or '').strip()
        if not object_key:
            raise ValidationError({'key': '缺少 key 参数'})

        project = get_object_or_404(Project.objects.for_user(request.user), pk=pk)

        try:
            _dataset_id, _source_id, _md, db_row, prefix = _load_parent_dataset_context(project)
        except ValidationError:
            raise Http404('项目未绑定父平台数据集或绑定无效')

        if not key_allowed_under_prefix(object_key, prefix):
            raise Http404('key 不在允许的路径前缀内')

        bucket = (db_row.bucket_name or '').strip()
        if not bucket:
            raise Http404('未配置 bucket')

        try:
            client = build_s3_client(db_row)
        except ValueError as e:
            logger.warning('build_s3_client: %s', e)
            raise Http404('无法连接对象存储配置')

        try:
            resp = client.get_object(Bucket=bucket, Key=object_key)
        except ClientError as e:
            code = (e.response.get('Error') or {}).get('Code', '')
            if code in ('NoSuchKey', '404', 'NotFound'):
                raise Http404('对象不存在')
            logger.exception('S3 get_object failed: %s', e)
            raise Http404('读取对象失败')

        body = resp['Body']
        content_type = resp.get('ContentType') or 'application/octet-stream'

        def stream():
            try:
                for chunk in body.iter_chunks(chunk_size=64 * 1024):
                    if chunk:
                        yield chunk
            finally:
                try:
                    body.close()
                except Exception:
                    pass

        django_response = StreamingHttpResponse(stream(), content_type=content_type)
        if resp.get('ContentLength') is not None:
            django_response['Content-Length'] = str(resp['ContentLength'])
        django_response['Cache-Control'] = 'private, max-age=3600'
        django_response['X-Content-Type-Options'] = 'nosniff'
        return django_response


class ParentPlatformDatasetSyncAPI(APIView):
    """
    POST /api/projects/<pk>/parent-dataset/sync/

    根据项目已保存的 parent_platform_dataset，连接 S3 兼容存储，列举前缀下对象并创建任务。
    可选 JSON body: { "max_tasks": 2000 }
    """

    permission_classes = (IsAuthenticated,)
    permission_required = ViewClassPermission(POST=all_permissions.projects_change)

    @extend_schema(
        summary='Sync parent platform dataset from S3 to tasks',
        tags=['Projects', 'Parent integration'],
    )
    def post(self, request, pk):
        project = get_object_or_404(Project.objects.for_user(request.user), pk=pk)
        if not user_can_manage_project(request.user, project):
            raise PermissionDenied('只有项目创建者或项目管理员可以同步父平台数据集。')
        binding = project.parent_platform_dataset or {}

        max_tasks = 2000
        if request.data and isinstance(request.data, dict):
            try:
                max_tasks = int(request.data.get('max_tasks', max_tasks))
            except (TypeError, ValueError):
                max_tasks = 2000
        max_tasks = max(1, min(max_tasks, 10000))

        dataset_id, source_id, md, db_row, prefix = _load_parent_dataset_context(project)

        bucket = (db_row.bucket_name or '').strip()
        if not bucket:
            raise ValidationError({'bucket': 'data_database.bucket_name 为空'})
        type_code = parse_type_code(md.data_set_type) or parse_type_code(
            _binding_get(binding, 'data_set_type', 'dataSetType')
        )
        if type_code is None or type_code not in (1, 2, 3, 4, 5):
            type_code = 5

        try:
            client = build_s3_client(db_row)
        except ValueError as e:
            raise ValidationError({'s3': str(e)})

        try:
            keys = iter_object_keys(client, bucket, prefix, type_code, max_tasks * 2)
        except Exception as e:
            logger.exception('S3 list_objects failed: %s', e)
            raise ValidationError({'s3': f'列举对象存储失败: {e}'})

        if not keys:
            return Response(
                {
                    'created': 0,
                    'skipped': 0,
                    'message': '前缀下没有匹配类型的文件',
                    'prefix': prefix,
                    'bucket': bucket,
                }
            )

        existing = set(
            Task.objects.filter(project=project, meta__has_key='parent_s3_key').values_list(
                'meta__parent_s3_key', flat=True
            )
        )
        existing.discard(None)

        to_create: list[Task] = []
        skipped = 0
        for key in keys:
            if key in existing:
                skipped += 1
                continue
            if len(to_create) >= max_tasks:
                break
            data = task_data_for_parent_proxy(type_code, project.id, key)
            meta = {'parent_s3_key': key, 'parent_dataset_id': dataset_id, 'parent_source_id': source_id}
            to_create.append(Task(project=project, data=data, meta=meta))

        if not to_create:
            return Response(
                {
                    'created': 0,
                    'skipped': skipped,
                    'message': '没有新任务（可能已全部同步过）',
                    'prefix': prefix,
                    'bucket': bucket,
                }
            )

        with transaction.atomic():
            Task.objects.bulk_create(to_create, batch_size=500)

        key_list = [t.meta['parent_s3_key'] for t in to_create]
        new_tasks = Task.objects.filter(project=project, meta__parent_s3_key__in=key_list)

        project.update_tasks_counters_and_task_states(
            new_tasks,
            maximum_annotations_changed=False,
            overlap_cohort_percentage_changed=False,
            tasks_number_changed=True,
            from_scratch=True,
        )

        # 回写同步摘要
        pp = dict(project.parent_platform_dataset) if project.parent_platform_dataset else {}

        pp['last_sync_at'] = timezone.now().isoformat()
        pp['last_sync_created'] = len(to_create)
        project.parent_platform_dataset = pp
        project.save(update_fields=['parent_platform_dataset', 'updated_at'])

        return Response(
            {
                'created': len(to_create),
                'skipped': skipped,
                'prefix': prefix,
                'bucket': bucket,
                'type_code': type_code,
            }
        )
