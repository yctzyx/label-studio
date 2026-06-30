"""REST API for task workflow: team allocations, distribute, my-tasks, transitions."""

from core.permissions import ViewClassPermission, all_permissions
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from projects.access import apply_project_team_visibility, user_can_manage_project
from projects.models import Project
from projects.workflow_models import ProjectTeamAllocation, ProjectTeamRole, TaskWorkflow, TaskWorkflowStage
from projects.workflow_services import (
    accept_decision,
    distribute_tasks_for_project,
    queryset_my_tasks,
    release_workflows_after_team_allocation_removed,
    review_decision,
    serialize_workflow_for_api,
    submit_annotation_after_labeling,
    workflow_stream_next_task,
)
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from tasks.models import Task
from tasks.serializers import TaskSerializer

User = get_user_model()


def _visible_org_project(request, pk):
    qs = Project.objects.filter(organization=request.user.active_organization, pk=pk)
    return get_object_or_404(apply_project_team_visibility(qs, request.user), pk=pk)


def _ensure_project_manager(request, project):
    """Only creator / project admin (or org owner) may manage allocations and distribute."""
    if not user_can_manage_project(request.user, project):
        raise PermissionDenied('只有项目创建者或项目管理员可以管理人员与分发。')


def _visible_org_task(request, pk):
    visible_projects = apply_project_team_visibility(
        Project.objects.filter(organization=request.user.active_organization),
        request.user,
    )
    return get_object_or_404(
        Task.objects.filter(project__in=visible_projects),
        pk=pk,
    )


class TeamAllocationSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(read_only=True)
    username = serializers.CharField(source='user.username', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    last_name = serializers.CharField(source='user.last_name', read_only=True)
    phone = serializers.CharField(source='user.phone', read_only=True)
    email = serializers.EmailField(source='user.email', read_only=True)

    class Meta:
        model = ProjectTeamAllocation
        fields = (
            'id',
            'user_id',
            'username',
            'first_name',
            'last_name',
            'phone',
            'email',
            'role',
            'allocation_percent',
        )


class TeamAllocationWriteSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    role = serializers.ChoiceField(choices=ProjectTeamRole.choices)
    allocation_percent = serializers.DecimalField(max_digits=6, decimal_places=2, default=0)


class ProjectTeamAllocationListCreateAPI(APIView):
    """GET list allocations; POST upsert one allocation row (project managers only)."""

    permission_required = ViewClassPermission(
        GET=all_permissions.projects_view,
        POST=all_permissions.projects_change,
    )

    def get(self, request, pk):
        project = _visible_org_project(request, pk)
        _ensure_project_manager(request, project)
        qs = ProjectTeamAllocation.objects.filter(project=project).select_related('user')
        ser = TeamAllocationSerializer(qs, many=True)
        data = list(ser.data)

        project_task_count = Task.objects.filter(project=project).count()

        label_counts = {
            row['annotate_user_id']: row['c']
            for row in TaskWorkflow.objects.filter(project=project)
            .values('annotate_user_id')
            .annotate(c=Count('task_id'))
            if row['annotate_user_id'] is not None
        }
        review_counts = {
            row['current_assignee_id']: row['c']
            for row in TaskWorkflow.objects.filter(
                project=project,
                stage=TaskWorkflowStage.REVIEW,
                current_assignee_id__isnull=False,
            )
            .values('current_assignee_id')
            .annotate(c=Count('task_id'))
        }
        accept_counts = {
            row['current_assignee_id']: row['c']
            for row in TaskWorkflow.objects.filter(
                project=project,
                stage=TaskWorkflowStage.ACCEPT,
                current_assignee_id__isnull=False,
            )
            .values('current_assignee_id')
            .annotate(c=Count('task_id'))
        }
        # 标注人已提交标注（工作流已离开 annotate）：按 annotate_user 汇总
        label_completed_counts = {
            row['annotate_user_id']: row['c']
            for row in TaskWorkflow.objects.filter(project=project)
            .exclude(stage=TaskWorkflowStage.ANNOTATE)
            .values('annotate_user_id')
            .annotate(c=Count('task_id'))
            if row['annotate_user_id'] is not None
        }
        project_annotation_completed_count = TaskWorkflow.objects.filter(project=project).exclude(
            stage=TaskWorkflowStage.ANNOTATE
        ).count()

        for row in data:
            uid = row['user_id']
            role = row['role']
            if role == ProjectTeamRole.LABEL:
                row['assigned_task_count'] = label_counts.get(uid, 0)
                row['completed_task_count'] = label_completed_counts.get(uid, 0)
            elif role == ProjectTeamRole.REVIEW:
                row['assigned_task_count'] = review_counts.get(uid, 0)
                row['completed_task_count'] = 0
            elif role == ProjectTeamRole.ACCEPT:
                row['assigned_task_count'] = accept_counts.get(uid, 0)
                row['completed_task_count'] = 0
            else:
                row['assigned_task_count'] = 0
                row['completed_task_count'] = 0

        return Response(
            {
                'results': data,
                'project_task_count': project_task_count,
                'project_annotation_completed_count': project_annotation_completed_count,
            }
        )

    def post(self, request, pk):
        project = _visible_org_project(request, pk)
        _ensure_project_manager(request, project)
        ser = TeamAllocationWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        uid = ser.validated_data['user_id']
        get_object_or_404(User, pk=uid)
        # 项目团队可包含各组织成员（由具备 projects_change 权限的管理员配置）；不再限制须为本项目 organization 成员
        role = ser.validated_data['role']
        pct = ser.validated_data['allocation_percent']
        obj, _ = ProjectTeamAllocation.objects.update_or_create(
            project=project,
            user_id=uid,
            role=role,
            defaults={'allocation_percent': pct},
        )
        return Response(TeamAllocationSerializer(obj).data, status=status.HTTP_200_OK)


class ProjectTeamAllocationDeleteAPI(APIView):
    permission_required = ViewClassPermission(DELETE=all_permissions.projects_change)

    def delete(self, request, pk, allocation_id):
        project = _visible_org_project(request, pk)
        _ensure_project_manager(request, project)
        row = get_object_or_404(ProjectTeamAllocation, pk=allocation_id, project=project)
        removed_user_id = row.user_id
        removed_role = row.role
        with transaction.atomic():
            row.delete()
            release_workflows_after_team_allocation_removed(project, removed_user_id, removed_role)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectWorkflowDistributeAPI(APIView):
    permission_required = ViewClassPermission(POST=all_permissions.projects_change)

    def post(self, request, pk):
        project = _visible_org_project(request, pk)
        _ensure_project_manager(request, project)
        n = distribute_tasks_for_project(project)
        return Response({'created': n})


class ProjectWorkflowMyTasksAPI(APIView):
    permission_required = ViewClassPermission(GET=all_permissions.projects_view)

    @extend_schema(
        parameters=[
            OpenApiParameter(name='stage', required=True, enum=['annotate', 'review', 'accept']),
            OpenApiParameter(
                name='search',
                required=False,
                description='Filter by task id substring and/or task data text',
            ),
            OpenApiParameter(
                name='status',
                required=False,
                enum=['annotating', 'rejected', 'in_review', 'in_accept', 'done'],
                description='Pipeline UI status (workflow-enabled projects)',
            ),
        ],
    )
    def get(self, request, pk):
        project = _visible_org_project(request, pk)
        stage = request.query_params.get('stage')
        if not stage:
            return Response({'detail': 'stage is required (annotate|review|accept)'}, status=400)
        search = (request.query_params.get('search') or '').strip()
        status_filter = (request.query_params.get('status') or '').strip()
        try:
            qs = queryset_my_tasks(
                project,
                request.user,
                stage,
                search=search or None,
                status=status_filter or None,
            )
        except ValidationError as err:
            return Response({'detail': err.detail}, status=status.HTTP_400_BAD_REQUEST)
        page = TaskSerializer(qs[:100], many=True, context={'request': request})
        return Response({'results': page.data, 'count': qs.count()})


class TaskWorkflowSubmitAnnotationAPI(APIView):
    permission_required = ViewClassPermission(POST=all_permissions.tasks_change)

    def post(self, request, pk):
        _visible_org_task(request, pk)
        wf = submit_annotation_after_labeling(pk, request.user)
        return Response(
            {
                'task_id': wf.task_id,
                'stage': wf.stage,
                'current_assignee_id': wf.current_assignee_id,
            }
        )


class TaskWorkflowReviewAPI(APIView):
    # Align with Accept / Submit: reviewers normally have tasks.change, not projects.change
    permission_required = ViewClassPermission(POST=all_permissions.tasks_change)

    class Body(serializers.Serializer):
        approve = serializers.BooleanField()
        comment = serializers.CharField(required=False, allow_blank=True, max_length=500)

    def post(self, request, pk):
        _visible_org_task(request, pk)
        body = self.Body(data=request.data)
        body.is_valid(raise_exception=True)
        wf = review_decision(
            pk,
            request.user,
            body.validated_data['approve'],
            comment=body.validated_data.get('comment'),
        )
        return Response(
            {
                'task_id': wf.task_id,
                'stage': wf.stage,
                'current_assignee_id': wf.current_assignee_id,
                'workflow': serialize_workflow_for_api(wf),
            }
        )


class TaskWorkflowAcceptAPI(APIView):
    permission_required = ViewClassPermission(POST=all_permissions.tasks_change)

    class Body(serializers.Serializer):
        approve = serializers.BooleanField()
        comment = serializers.CharField(required=False, allow_blank=True, max_length=500)

    def post(self, request, pk):
        _visible_org_task(request, pk)
        body = self.Body(data=request.data)
        body.is_valid(raise_exception=True)
        wf = accept_decision(
            pk,
            request.user,
            body.validated_data['approve'],
            comment=body.validated_data.get('comment'),
        )
        return Response(
            {
                'task_id': wf.task_id,
                'stage': wf.stage,
                'current_assignee_id': wf.current_assignee_id,
                'workflow': serialize_workflow_for_api(wf),
            }
        )


class TaskWorkflowDetailAPI(APIView):
    permission_required = ViewClassPermission(GET=all_permissions.projects_view)

    def get(self, request, pk):
        task = _visible_org_task(request, pk)
        wf = getattr(task, 'workflow', None)
        if not wf:
            return Response({'workflow': None})
        return Response({'workflow': serialize_workflow_for_api(wf)})


class ProjectWorkflowStreamNextAPI(APIView):
    """Workflow stream mode: return the next task for the current user filtered by stage."""

    permission_required = ViewClassPermission(GET=all_permissions.tasks_view)

    @extend_schema(
        parameters=[
            OpenApiParameter(name='stage', required=True, enum=['annotate', 'review', 'accept']),
        ],
    )
    def get(self, request, pk):
        project = _visible_org_project(request, pk)
        stage = request.query_params.get('stage')
        if not stage:
            return Response({'detail': 'stage is required (annotate|review|accept)'}, status=400)
        try:
            task = workflow_stream_next_task(project, request.user, stage)
        except ValidationError as err:
            return Response({'detail': err.detail}, status=status.HTTP_400_BAD_REQUEST)
        if task is None:
            return Response({'detail': 'No tasks available'}, status=status.HTTP_404_NOT_FOUND)

        from tasks.serializers import (
            NextTaskSerializer,
            TaskWithAnnotationsAndPredictionsAndDraftsSerializer,
        )

        context = {'request': request, 'project': project, 'resolve_uri': True}
        is_review_stage = stage in ('review', 'accept')

        if is_review_stage:
            # Reviewers / accepters need to see the annotator's submitted annotations
            data = TaskWithAnnotationsAndPredictionsAndDraftsSerializer(task, context=context).data
        else:
            context['annotations'] = False
            data = NextTaskSerializer(task, context=context).data

        data['queue'] = f'workflow_stream_{stage}'
        return Response(data)
