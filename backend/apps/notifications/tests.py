from unittest.mock import patch

from django.core import mail
from django.test import TestCase

from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.crypto import encrypt_value
from apps.tenancy.models import Organization, PlatformEmailSettings, PlatformSmsSettings

from .email import get_email_connection_and_sender
from .sms import get_sms_credentials, normalize_msisdn, send_sms


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


class NormalizeMsisdnTests(TestCase):
    """
    Onfon expects a bare '254...' MSISDN, but User.phone/Patient.contact_phone
    are free-text CharFields — proves the common Kenyan input shapes all
    normalize to the same wire format.
    """

    def test_leading_zero_becomes_254(self):
        self.assertEqual(normalize_msisdn("0712345678"), "254712345678")

    def test_plus_254_strips_to_254(self):
        self.assertEqual(normalize_msisdn("+254712345678"), "254712345678")

    def test_bare_254_is_unchanged(self):
        self.assertEqual(normalize_msisdn("254712345678"), "254712345678")

    def test_bare_msisdn_without_leading_zero_gets_254_prefixed(self):
        self.assertEqual(normalize_msisdn("712345678"), "254712345678")


class SmsCredentialResolutionTests(TestCase):
    """
    The org -> platform -> settings.py fallback chain behind the "each
    tenant configures their own SMS gateway" feature
    (apps/notifications/sms.py) — same shape as
    EmailConnectionResolutionTests above.
    """

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        self.addCleanup(lambda: PlatformSmsSettings.objects.all().delete())
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="SMS Fallback Org", slug="sms-fallback-org", facility_type="CLINIC"
            )

    def test_nothing_configured_anywhere_returns_none(self):
        self.assertIsNone(get_sms_credentials(self.org))
        self.assertIsNone(get_sms_credentials(None))

    def test_platform_settings_used_when_org_has_none(self):
        PlatformSmsSettings.objects.create(
            pk=1,
            sender_id="CITRAMAC",
            client_id="platform-client",
            access_key_encrypted=encrypt_value("platform-access-key"),
            api_key_encrypted=encrypt_value("platform-api-key"),
        )
        credentials = get_sms_credentials(self.org)
        self.assertEqual(credentials["sender_id"], "CITRAMAC")
        self.assertEqual(credentials["access_key"], "platform-access-key")

    def test_org_settings_take_priority_over_platform(self):
        PlatformSmsSettings.objects.create(
            pk=1,
            sender_id="CITRAMAC",
            client_id="platform-client",
            access_key_encrypted=encrypt_value("platform-access-key"),
            api_key_encrypted=encrypt_value("platform-api-key"),
        )
        self.org.sms_sender_id = "TENANT"
        self.org.sms_client_id = "tenant-client"
        self.org.sms_access_key_encrypted = encrypt_value("tenant-access-key")
        self.org.sms_api_key_encrypted = encrypt_value("tenant-api-key")
        with platform_admin_context():
            self.org.save()

        credentials = get_sms_credentials(self.org)
        self.assertEqual(credentials["sender_id"], "TENANT")
        self.assertEqual(credentials["client_id"], "tenant-client")
        self.assertEqual(credentials["access_key"], "tenant-access-key")
        self.assertEqual(credentials["api_key"], "tenant-api-key")

    def test_partial_org_configuration_is_treated_as_not_configured(self):
        # Sender ID alone (no keys) must fall through to the platform/env
        # tier, not be treated as "configured" with blank credentials.
        self.org.sms_sender_id = "TENANT"
        with platform_admin_context():
            self.org.save()
        self.assertIsNone(get_sms_credentials(self.org))


class SendSmsTests(TestCase):
    """
    apps.notifications.sms.send_sms actually calls Onfon's SendBulkSMS API
    with the resolved credentials, and degrades to an honest no-op when
    nothing is configured — the "make it actually take effect" half of
    per-tenant SMS, not just storing the settings.
    """

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        self.addCleanup(lambda: PlatformSmsSettings.objects.all().delete())
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Sms Org",
                slug="sms-org",
                facility_type="CLINIC",
                sms_sender_id="CITRAMAC",
                sms_client_id="client-123",
                sms_access_key_encrypted=encrypt_value("access-key-123"),
                sms_api_key_encrypted=encrypt_value("api-key-123"),
            )

    def test_returns_false_and_does_not_call_gateway_when_not_configured(self):
        unconfigured_org = Organization(name="No Sms", slug="no-sms", facility_type="CLINIC")
        with patch("apps.notifications.sms.requests.post") as mock_post:
            result = send_sms("0712345678", "Hello", organization=unconfigured_org)
        self.assertFalse(result)
        mock_post.assert_not_called()

    def test_sends_via_onfon_with_resolved_credentials(self):
        mock_response = type(
            "Resp",
            (),
            {
                "raise_for_status": lambda self: None,
                "json": lambda self: {"ErrorCode": 0, "ErrorDescription": "Success", "Data": []},
            },
        )()
        with patch("apps.notifications.sms.requests.post", return_value=mock_response) as mock_post:
            result = send_sms("0712345678", "Your code is 123456", organization=self.org)

        self.assertTrue(result)
        mock_post.assert_called_once()
        _, kwargs = mock_post.call_args
        self.assertEqual(kwargs["headers"]["AccessKey"], "access-key-123")
        self.assertEqual(kwargs["json"]["ApiKey"], "api-key-123")
        self.assertEqual(kwargs["json"]["ClientId"], "client-123")
        self.assertEqual(kwargs["json"]["SenderId"], "CITRAMAC")
        self.assertEqual(kwargs["json"]["MessageParameters"][0]["Number"], "254712345678")
        self.assertEqual(kwargs["json"]["MessageParameters"][0]["Text"], "Your code is 123456")

    def test_gateway_rejection_returns_false(self):
        mock_response = type(
            "Resp",
            (),
            {
                "raise_for_status": lambda self: None,
                "json": lambda self: {"ErrorCode": 4, "ErrorDescription": "Insufficient balance"},
            },
        )()
        with patch("apps.notifications.sms.requests.post", return_value=mock_response):
            result = send_sms("0712345678", "Hello", organization=self.org)
        self.assertFalse(result)


class SendOtpSmsTaskTests(TestCase):
    """
    apps.notifications.tasks.send_otp_sms actually routes through the
    resolved Onfon credentials rather than only logging a stub, mirroring
    SendOtpEmailTaskTests above.
    """

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        self.addCleanup(lambda: PlatformSmsSettings.objects.all().delete())
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Otp Sms Org",
                slug="otp-sms-org",
                facility_type="CLINIC",
                sms_sender_id="CITRAMAC",
                sms_client_id="client-123",
                sms_access_key_encrypted=encrypt_value("access-key-123"),
                sms_api_key_encrypted=encrypt_value("api-key-123"),
            )

    def test_calls_send_sms_with_resolved_organization(self):
        from .tasks import send_otp_sms

        with patch("apps.notifications.sms.send_sms") as mock_send_sms:
            send_otp_sms(
                phone="0712345678", code="654321", purpose="LOGIN_2FA", organization_id=self.org.id
            )

        mock_send_sms.assert_called_once()
        args, kwargs = mock_send_sms.call_args
        self.assertEqual(args[0], "0712345678")
        self.assertIn("654321", args[1])
        self.assertEqual(kwargs["organization"].id, self.org.id)
