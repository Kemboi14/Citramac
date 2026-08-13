from django.apps import AppConfig


class SysadminAuditConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.sysadmin_audit"

    def ready(self):
        from .signals import connect_audit_signals

        connect_audit_signals()
