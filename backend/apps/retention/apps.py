from django.apps import AppConfig


class RetentionConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.retention"

    def ready(self):
        from .guards import connect_archive_guards

        connect_archive_guards()
        _lock_admin_deletion()


def _lock_admin_deletion():
    """
    Clinical records are archived, never deleted (docs/06-DATA-MODEL.md
    §6.7: "never hard-delete patient data"). Django admin's per-object and
    bulk "delete selected" actions are removed for every model in the client
    record registry, including where one appears as an inline. Admin
    autodiscovery has already run by the time this app's ready() is called
    (django.contrib.admin precedes LOCAL_APPS in INSTALLED_APPS).
    """
    from django.contrib import admin

    from .registry import patient_models

    protected = {model for model, _ in patient_models()}

    def _no_delete(self, request, obj=None):
        return False

    for model, model_admin in admin.site._registry.items():
        if model in protected:
            model_admin.has_delete_permission = _no_delete.__get__(model_admin)
        for inline in getattr(model_admin, "inlines", []):
            if inline.model in protected:
                inline.can_delete = False
                inline.has_delete_permission = _no_delete
