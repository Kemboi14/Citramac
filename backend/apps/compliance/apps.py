from django.apps import AppConfig


class ComplianceConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.compliance"
    label = "compliance"
    verbose_name = "Data protection & digital-health compliance"

    def ready(self):
        from .admin_lock import hide_clinical_models_from_admin

        hide_clinical_models_from_admin()
