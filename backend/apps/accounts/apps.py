from django.apps import AppConfig
from django.db.models.signals import post_save


def _provision_roles(sender, instance, created, raw=False, **kwargs):
    """A new organisation starts with its own copy of the standard roles."""
    if created and not raw:
        from .roles import provision_organization_roles

        provision_organization_roles(instance)


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.accounts"

    def ready(self):
        from apps.tenancy.models import Organization

        post_save.connect(
            _provision_roles, sender=Organization, weak=False, dispatch_uid="provision_org_roles"
        )
