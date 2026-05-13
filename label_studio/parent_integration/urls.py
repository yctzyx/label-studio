from django.urls import path

from parent_integration import api

urlpatterns = [
    path('api/parent-integration/databases/', api.ParentPlatformDatabaseListAPI.as_view(), name='parent-integration-databases'),
    path('api/parent-integration/datasets/', api.ParentPlatformDatasetListAPI.as_view(), name='parent-integration-datasets'),
    path(
        'api/parent-integration/sync-pub-directory/',
        api.PubDirectorySyncAPI.as_view(),
        name='parent-integration-sync-pub-directory',
    ),
]
