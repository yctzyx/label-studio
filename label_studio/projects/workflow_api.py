"""REST API for task workflow: team allocations, distribute, my-tasks, transitions."""

from core.permissions import ViewClassPermission, all_permissions
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from projects.access import apply_project_team_visibility, user_can_manage_project
from projects.models import Project
from projects.workflow_models import ProjectTeamAllocation, ProjectTeamRole
from projects.workflow_services import (
    accept_decision,
    distribute_tasks_for_project,
    queryset_my_tasks,
    review_decision,
    submit_annotation_after_labeling,
)
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied
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
    email = serializers.EmailField(source='user.email', read_only=True)

    class Meta:
        model = ProjectTeamAllocation
        fields = ('id', 'user_id', 'username', 'email', 'role', 'allocation_percent')


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
        return Response(ser.data)

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
        row.delete()
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
        ],
    )
    def get(self, request, pk):
        project = _visible_org_project(request, pk)
        stage = request.query_params.get('stage')
        if not stage:
            return Response({'detail': 'stage is required (annotate|review|accept)'}, status=400)
        qs = queryset_my_tasks(project, request.user, stage)
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

    def post(self, request, pk):
        _visible_org_task(request, pk)
        body = self.Body(data=request.data)
        body.is_valid(raise_exception=True)
        wf = review_decision(pk, request.user, body.validated_data['approve'])
        return Response(
            {
                'task_id': wf.task_id,
                'stage': wf.stage,
                'current_assignee_id': wf.current_assignee_id,
            }
        )


class TaskWorkflowAcceptAPI(APIView):
    permission_required = ViewClassPermission(POST=all_permissions.tasks_change)

    class Body(serializers.Serializer):
        approve = serializers.BooleanField()

    def post(self, request, pk):
        _visible_org_task(request, pk)
        body = self.Body(data=request.data)
        body.is_valid(raise_exception=True)
        wf = accept_decision(pk, request.user, body.validated_data['approve'])
        return Response(
            {
                'task_id': wf.task_id,
                'stage': wf.stage,
                'current_assignee_id': wf.current_assignee_id,
            }
        )


class TaskWorkflowDetailAPI(APIView):
    permission_required = ViewClassPermission(GET=all_permissions.projects_view)

    def get(self, request, pk):
        task = _visible_org_task(request, pk)
        wf = getattr(task, 'workflow', None)
        if not wf:
            return Response({'workflow': None})
        return Response(
            {
                'workflow': {
                    'stage': wf.stage,
                    'annotate_user_id': wf.annotate_user_id,
                    'current_assignee_id': wf.current_assignee_id,
                }
            }
        )
