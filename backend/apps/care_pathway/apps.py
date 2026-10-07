from django.apps import AppConfig


class CarePathwayConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.care_pathway"
    label = "care_pathway"
    verbose_name = "Care pathway (Registration → Triage → Journey)"

    def ready(self):
        from . import signals  # noqa: F401
