"""将父平台数据集（桶路径）同步为项目任务；同源代理读取对象避免 MinIO CORS。"""

from __future__ import annotations

import logging

from botocore.exceptions import ClientError
from core.permissions import ViewClassPermission, all_permissions
from django.http import Http404, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from parent_integration.parent_dataset_context import load_parent_dataset_context
from parent_integration.parent_dataset_sync_runner import (
    get_parent_dataset_sync_job,
    start_parent_dataset_sync_job,
)
from parent_integration.s3_sync import build_s3_client, key_allowed_under_prefix
from projects.access import user_can_manage_project
from projects.models import Project
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)


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
            _dataset_id, _source_id, _md, db_row, prefix = load_parent_dataset_context(project)
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
    POST /api/projects/<pk>/parent-dataset/sync/ — 启动异步同步，返回 job_id。
    GET  /api/projects/<pk>/parent-dataset/sync/?job_id=... — 查询同步进度。
    """

    permission_classes = (IsAuthenticated,)
    permission_required = ViewClassPermission(
        GET=all_permissions.projects_view,
        POST=all_permissions.projects_change,
    )

    def _get_project(self, request, pk):
        project = get_object_or_404(Project.objects.for_user(request.user), pk=pk)
        if not user_can_manage_project(request.user, project):
            raise PermissionDenied('只有项目创建者或项目管理员可以同步父平台数据集。')
        return project

    @extend_schema(
        summary='Query parent platform dataset sync job progress',
        tags=['Projects', 'Parent integration'],
        parameters=[
            OpenApiParameter(
                name='job_id',
                type=str,
                location=OpenApiParameter.QUERY,
                required=True,
                description='POST 启动同步时返回的 job_id',
            ),
        ],
    )
    def get(self, request, pk):
        project = self._get_project(request, pk)
        job_id = (request.query_params.get('job_id') or '').strip()
        if not job_id:
            raise ValidationError({'job_id': '缺少 job_id 参数'})
        job = get_parent_dataset_sync_job(project.pk, job_id)
        if not job:
            raise ValidationError({'job_id': '任务不存在或已过期'})
        return Response(job)

    @extend_schema(
        summary='Start async sync of parent platform dataset from S3 to tasks',
        tags=['Projects', 'Parent integration'],
    )
    def post(self, request, pk):
        project = self._get_project(request, pk)

        max_tasks = 2000
        if request.data and isinstance(request.data, dict):
            try:
                max_tasks = int(request.data.get('max_tasks', max_tasks))
            except (TypeError, ValueError):
                max_tasks = 2000
        max_tasks = max(1, min(max_tasks, 10000))

        try:
            load_parent_dataset_context(project)
        except ValidationError:
            raise

        job_id = start_parent_dataset_sync_job(project, max_tasks=max_tasks)
        return Response({'job_id': job_id, 'status': 'queued'})
