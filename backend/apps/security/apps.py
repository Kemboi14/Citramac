from django.apps import AppConfig


class SecurityConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.security"
    label = "platform_security"
    verbose_name = "Security & Compliance"

    def ready(self):
        import structlog

        from .evaluate import default_secret_problems

        problems = default_secret_problems()
        if problems:
            structlog.get_logger(__name__).error(
                "security.default_secrets_in_use", secrets=problems
            )
