from django.apps import AppConfig


class TenancyConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.tenancy"

    def ready(self):
        from .branch_scope import apply_branch_scope

        apply_branch_scope()
