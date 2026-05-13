from django.apps import AppConfig


class ParentIntegrationConfig(AppConfig):
    default_auto_field = 'django.db.models.AutoField'
    name = 'parent_integration'
    verbose_name = 'Parent platform integration'
