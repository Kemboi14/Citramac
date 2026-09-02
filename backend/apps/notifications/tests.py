from django.core import mail
from django.test import TestCase

from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.crypto import encrypt_value
from apps.tenancy.models import Organization, PlatformEmailSettings

from .email import get_email_connection_and_sender


class EmailConnectionResolutionTests(TestCase):
    """
    The org -> platform -> settings.py fallback chain behind the "each
    tenant configures their own email" feature (apps/notifications/email.py).
    Uses locmem so no real SMTP dial happens, but still proves each layer
    picks its own from_email and only falls through when the layer above
    has nothing configured.
    """

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        self.addCleanup(lambda: PlatformEmailSettings.objects.all().delete())
        self.addCleanup(mail.outbox.clear)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Fallback Org", slug="fallback-org", facility_type="CLINIC"
            )

    def test_no_org_and_no_platform_settings_uses_default_backend(self):
        connection, from_email = get_email_connection_and_sender(None)
        self.assertIsNone(connection)
        from django.conf import settings

        self.assertEqual(from_email, settings.DEFAULT_FROM_EMAIL)

    def test_platform_settings_used_when_org_has_none(self):
        PlatformEmailSettings.objects.create(
            pk=1,
            host="smtp.platform.example",
            port=587,
            host_user="platform@example.com",
            host_password_encrypted=encrypt_value("platform-password"),
            use_tls=True,
            default_from_email="CITRAMAC <platform@example.com>",
        )
        connection, from_email = get_email_connection_and_sender(self.org)
        self.assertIsNotNone(connection)
        self.assertEqual(connection.host, "smtp.platform.example")
        self.assertEqual(from_email, "CITRAMAC <platform@example.com>")

    def test_org_settings_take_priority_over_platform(self):
        PlatformEmailSettings.objects.create(
            pk=1, host="smtp.platform.example", port=587, default_from_email="platform@example.com"
        )
        self.org.email_host = "mail.tenant.example"
        self.org.email_port = 465
        self.org.email_use_tls = False
        self.org.email_use_ssl = True
        self.org.email_host_user = "tenant@example.com"
        self.org.email_host_password_encrypted = encrypt_value("tenant-password")
        self.org.email_from_address = "Tenant <tenant@example.com>"
        with platform_admin_context():
            self.org.save()

        connection, from_email = get_email_connection_and_sender(self.org)
        self.assertEqual(connection.host, "mail.tenant.example")
        self.assertEqual(connection.port, 465)
        self.assertTrue(connection.use_ssl)
        self.assertEqual(from_email, "Tenant <tenant@example.com>")


class SendOtpEmailTaskTests(TestCase):
    """
    apps.notifications.tasks.send_otp_email actually routes through the
    resolved connection/from_email rather than always using Django's
    globally configured backend — the "make it actually take effect" half
    of per-tenant SMTP, not just storing the settings.
    """

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        self.addCleanup(lambda: PlatformEmailSettings.objects.all().delete())
        with platform_admin_context():
            # Deliberately no email_host: proves the org's own from_email
            # applies even when it's only relaying through the platform's
            # SMTP (or, in this test, the locmem default) rather than a
            # server of its own.
            self.org = Organization.objects.create(
                name="Otp Org",
                slug="otp-org",
                facility_type="CLINIC",
                email_from_address="Otp Org <notifications@otp-org.example>",
            )

    def test_uses_organizations_own_from_address_when_configured(self):
        from .tasks import send_otp_email

        send_otp_email(
            email="staff@otp-org.example",
            code="123456",
            purpose="LOGIN_2FA",
            organization_id=self.org.id,
        )
        self.assertEqual(mail.outbox[-1].from_email, "Otp Org <notifications@otp-org.example>")
        self.assertEqual(mail.outbox[-1].to, ["staff@otp-org.example"])
