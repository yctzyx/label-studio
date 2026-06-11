from django.conf import settings

_PARENT_DATASET_MODELS = frozenset({'DataDatabase', 'MdDataSet'})


class ParentPlatformRouter:
    """Route parent_integration unmanaged models to configured database aliases."""

    route_app_labels = {'parent_integration'}

    def _route(self, model):
        if model.__name__ in _PARENT_DATASET_MODELS:
            return getattr(settings, 'PARENT_DATASET_DB', 'default') or 'default'
        if 'parent_platform' in settings.DATABASES:
            return 'parent_platform'
        return 'default'

    def db_for_read(self, model, **hints):
        if model._meta.app_label == 'parent_integration':
            return self._route(model)
        return None

    def db_for_write(self, model, **hints):
        if model._meta.app_label == 'parent_integration':
            return self._route(model)
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
