from django.conf import settings


class ParentPlatformRouter:
    """Route parent_integration unmanaged models to `parent_platform` when configured, else `default`."""

    route_app_labels = {'parent_integration'}

    def db_for_read(self, model, **hints):
        if model._meta.app_label == 'parent_integration':
            return 'parent_platform' if 'parent_platform' in settings.DATABASES else 'default'
        return None

    def db_for_write(self, model, **hints):
        if model._meta.app_label == 'parent_integration':
            return 'parent_platform' if 'parent_platform' in settings.DATABASES else 'default'
        return None

    def allow_relation(self, obj1, obj2, **hints):
        labels = {obj1._meta.app_label, obj2._meta.app_label}
        if 'parent_integration' in labels:
            return labels == {'parent_integration'}
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        if app_label == 'parent_integration':
            return False
        return None
