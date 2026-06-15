"""This file and its contents are licensed under the Apache License 2.0. Please see the included NOTICE for copyright information and LICENSE for a copy of the license.
"""
from django.urls import include, path
from rest_framework import routers

from . import api
from projects import workflow_api

app_name = 'tasks'

router = routers.DefaultRouter()
router.register(r'predictions', api.PredictionAPI, basename='prediction')

_api_urlpatterns = [
    # CRUD
    path('', api.TaskListAPI.as_view(), name='task-list'),
    path('<int:pk>/', api.TaskAPI.as_view(), name='task-detail'),
    path(
        '<int:pk>/retrieve-predictions/',
        api.TaskRetrievePredictionsAPI.as_view(),
        name='task-retrieve-predictions',
    ),
    path('<int:pk>/workflow/', workflow_api.TaskWorkflowDetailAPI.as_view(), name='task-workflow-detail'),
    path(
        '<int:pk>/workflow/submit-annotation/',
        workflow_api.TaskWorkflowSubmitAnnotationAPI.as_view(),
        name='task-workflow-submit-annotation',
    ),
    path('<int:pk>/workflow/review/', workflow_api.TaskWorkflowReviewAPI.as_view(), name='task-workflow-review'),
    path('<int:pk>/workflow/accept/', workflow_api.TaskWorkflowAcceptAPI.as_view(), name='task-workflow-accept'),
    path('<int:pk>/annotations/', api.AnnotationsListAPI.as_view(), name='task-annotations'),
    path('<int:pk>/drafts', api.AnnotationDraftListAPI.as_view(), name='task-drafts'),
    path(
        '<int:pk>/annotations/<int:annotation_id>/drafts',
        api.AnnotationDraftListAPI.as_view(),
        name='task-annotations-drafts',
    ),
]

_api_annotations_urlpatterns = [
    path('<int:pk>/', api.AnnotationAPI.as_view(), name='annotation-detail'),
    path('<int:pk>/convert-to-draft', api.AnnotationConvertAPI.as_view(), name='annotation-convert-to-draft'),
]

_api_drafts_urlpatterns = [
    path('<int:pk>/', api.AnnotationDraftAPI.as_view(), name='draft-detail'),
]

_api_predictions_urlpatterns = router.urls


urlpatterns = [
    path('api/tasks/', include((_api_urlpatterns, app_name), namespace='api')),
    # TODO: these should be moved to the separate apps
    path('api/annotations/', include((_api_annotations_urlpatterns, app_name), namespace='api-annotations')),
    path('api/drafts/', include((_api_drafts_urlpatterns, app_name), namespace='api-drafts')),
    path('api/', include((_api_predictions_urlpatterns, app_name), namespace='api-predictions')),
]
