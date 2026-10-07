from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.tenancy.context import platform_admin_context
from apps.tenancy.models import Organization

from .models import BillingService
from .valuesets import seed_billing_services


@receiver(post_save, sender=Organization)
def seed_organization_billing_services(sender, instance, created, **kwargs):
    """Every new facility starts with the mockup's service list, unpriced.
    Creating an organisation is a platform operation, hence the admin context."""
    if created:
        with platform_admin_context():
            seed_billing_services(BillingService, instance.id)
