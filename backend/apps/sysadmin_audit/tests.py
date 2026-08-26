from django.test import Client, TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.tokens import issue_tokens
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .models import AuditLogEntry


class HealthzTests(TestCase):
    def test_healthz_returns_ok(self):
        response = Client().get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")


class SecurityHeadersTests(TestCase):
    """docs/09-SECURITY-COMPLIANCE.md §9.7 — headers set on all HTTP responses."""

    def test_response_carries_hardening_headers(self):
        response = Client().get("/healthz")
        self.assertIn("Content-Security-Policy", response)
        self.assertEqual(response["Referrer-Policy"], "strict-origin-when-cross-origin")
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response["X-Frame-Options"], "DENY")


class AuditLogApiTests(APITestCase):
    """docs/09-SECURITY-COMPLIANCE.md §9.4 — Super Admin sees every
    organization's trail, Org Admin only their own."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org_a = Organization.objects.create(
                name="Org A", slug="audit-org-a", facility_type="CLINIC"
            )
            self.org_b = Organization.objects.create(
                name="Org B", slug="audit-org-b", facility_type="CLINIC"
            )
            AuditLogEntry.objects.create(
                organization_id=self.org_a.id, action=AuditLogEntry.ACTION_LOGIN
            )
            AuditLogEntry.objects.create(
                organization_id=self.org_b.id, action=AuditLogEntry.ACTION_LOGIN_FAILED
            )
            self.super_admin = User.objects.create_superuser(
                email="root@platform.test", password="Password123!"
            )
            self.org_a_user = User.objects.create_user(
                email="staff@org-a.test",
                password="Password123!",
                organization=self.org_a,
                is_active=True,
            )
        self.super_access, _ = issue_tokens(self.super_admin)
        self.org_a_access, _ = issue_tokens(self.org_a_user)

    def test_super_admin_sees_cross_tenant_entries(self):
        response = self.client.get(
            reverse("audit-log-list"), HTTP_AUTHORIZATION=f"Bearer {self.super_access}"
        )
        self.assertGreaterEqual(response.data["count"], 2)

    def test_org_scoped_user_sees_only_their_org(self):
        response = self.client.get(
            reverse("audit-log-list"), HTTP_AUTHORIZATION=f"Bearer {self.org_a_access}"
        )
        org_ids = {row["organization_id"] for row in response.data["results"]}
        self.assertEqual(org_ids, {str(self.org_a.id)})

    def test_security_category_filters_to_security_relevant_actions(self):
        with platform_admin_context():
            AuditLogEntry.objects.create(
                organization_id=self.org_a.id,
                action=AuditLogEntry.ACTION_UPDATE,
                model="tenancy.branch",
            )
        response = self.client.get(
            reverse("audit-log-list") + "?category=security",
            HTTP_AUTHORIZATION=f"Bearer {self.org_a_access}",
        )
        actions = {row["action"] for row in response.data["results"]}
        self.assertTrue(actions.issubset({"LOGIN", "LOGIN_FAILED", "ERASURE"}))
