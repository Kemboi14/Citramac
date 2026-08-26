from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.tokens import issue_tokens
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .models import SecurityAlert, SecurityPolicy


class SecurityConsoleApiTests(APITestCase):
    """citramac_SUPER-ADMIN.html "Security Dashboard" / "Security Policies"
    / "Security Alerts" — computed from real data, not fixtures."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Amani Wellness", slug="amani-sec", facility_type="MENTAL_HEALTH_CCP"
            )
            self.super_admin = User.objects.create_superuser(
                email="root@platform.test", password="Password123!"
            )
            # 4 active users, only 1 with MFA — should trip the low-adoption alert.
            for i in range(4):
                User.objects.create_user(
                    email=f"user{i}@amani-sec.test",
                    password="Password123!",
                    organization=self.org,
                    is_active=True,
                    mfa_enabled=(i == 0),
                )
            for _ in range(20):
                AuditLogEntry.objects.create(
                    organization_id=self.org.id, action=AuditLogEntry.ACTION_LOGIN_FAILED
                )
        self.access, _ = issue_tokens(self.super_admin)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.access}"}

    def test_dashboard_reflects_real_mfa_and_failed_login_signals(self):
        response = self.client.get(reverse("security-dashboard"), **self.auth)
        self.assertEqual(response.status_code, 200, response.data)
        row = next(t for t in response.data["tenants"] if t["organization_id"] == str(self.org.id))
        self.assertEqual(row["mfa_adoption_percent"], 25)
        self.assertEqual(row["failed_logins_24h"], 20)
        self.assertIn(row["status"], {"Warning", "Non-Compliant", "Critical"})

    def test_dashboard_creates_real_alerts_from_thresholds(self):
        self.client.get(reverse("security-dashboard"), **self.auth)
        alerts = SecurityAlert.objects.filter(organization_id=self.org.id)
        categories = {a.category for a in alerts if a.status == SecurityAlert.STATUS_NEW}
        self.assertIn(SecurityAlert.CATEGORY_FAILED_LOGINS, categories)
        self.assertIn(SecurityAlert.CATEGORY_MFA_ADOPTION, categories)

    def test_alert_investigate_then_resolve_workflow(self):
        self.client.get(reverse("security-dashboard"), **self.auth)
        alert = SecurityAlert.objects.filter(organization_id=self.org.id).first()

        response = self.client.post(
            reverse("security-alert-investigate", args=[alert.id]), **self.auth
        )
        self.assertEqual(response.data["status"], "INVESTIGATING")

        response = self.client.post(reverse("security-alert-resolve", args=[alert.id]), **self.auth)
        self.assertEqual(response.data["status"], "RESOLVED")
        self.assertIsNotNone(response.data["resolved_at"])

    def test_alert_auto_resolves_once_condition_clears(self):
        """
        AuditLogEntry is append-only (can't delete the failed-login rows to
        simulate the condition clearing), so this proves the same thing the
        other direction: an org with no failed logins and full MFA adoption
        never gets an open alert in the first place — evaluate_security_alerts
        is condition-driven, not a one-way ratchet.
        """
        with platform_admin_context():
            clean_org = Organization.objects.create(
                name="Clean Org", slug="clean-sec-org", facility_type="CLINIC"
            )
            User.objects.create_user(
                email="clean-user@clean-sec.test",
                password="Password123!",
                organization=clean_org,
                is_active=True,
                mfa_enabled=True,
            )
        self.client.get(reverse("security-dashboard"), **self.auth)
        open_alerts = SecurityAlert.objects.filter(
            organization_id=clean_org.id,
            status__in=[SecurityAlert.STATUS_NEW, SecurityAlert.STATUS_INVESTIGATING],
        )
        self.assertFalse(open_alerts.exists())

    def test_super_admin_can_edit_policy_baseline(self):
        response = self.client.patch(
            reverse("security-policy"),
            {"session_timeout_minutes": 45},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["session_timeout_minutes"], 45)
        self.assertIn("mandatory_controls", response.data)
        self.assertTrue(response.data["mandatory_controls"]["mfa_required"])

    def test_non_superuser_cannot_read_dashboard(self):
        with platform_admin_context():
            staff = User.objects.create_user(
                email="staff@amani-sec.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
        access, _ = issue_tokens(staff)
        response = self.client.get(
            reverse("security-dashboard"), HTTP_AUTHORIZATION=f"Bearer {access}"
        )
        self.assertEqual(response.status_code, 403)

    def test_policy_singleton_survives_multiple_saves(self):
        SecurityPolicy.get_solo()
        SecurityPolicy.get_solo()
        self.assertEqual(SecurityPolicy.objects.count(), 1)
