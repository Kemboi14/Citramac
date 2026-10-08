from django.test import Client, TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
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
    organization's trail; Org Admin and Auditor only their own organization's;
    nobody else (clinicians included) can open it."""

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
                organization_id=self.org_a.id,
                action=AuditLogEntry.ACTION_LOGIN,
            )
            AuditLogEntry.objects.create(
                organization_id=self.org_b.id, action=AuditLogEntry.ACTION_LOGIN_FAILED
            )
            AuditLogEntry.objects.create(
                organization_id=self.org_a.id,
                action=AuditLogEntry.ACTION_UPDATE,
                model="mhp_program.psychotherapysession",
                object_id="1",
                field_diff={"session_notes": {"old": "SECRET-OLD", "new": "SECRET-NEW"}},
            )
            self.super_admin = User.objects.create_superuser(
                email="root@platform.test", password="Password123!"
            )
            self.org_admin = self._user("admin@org-a.test", self.org_a, "Org Admin")
            self.auditor = self._user("auditor@org-a.test", self.org_a, "Auditor")
            self.clinician = self._user("staff@org-a.test", self.org_a, None)
            self.other_org_admin = self._user("admin@org-b.test", self.org_b, "Org Admin")
        self.url = reverse("audit-log-list")

    @staticmethod
    def _user(email, organization, role_name):
        user = User.objects.create_user(
            email=email, password="Password123!", organization=organization, is_active=True
        )
        if role_name:
            user.roles.add(Role.objects.get(name=role_name, organization__isnull=True))
        return user

    def _get(self, user, query=""):
        access, _ = issue_tokens(user)
        return self.client.get(self.url + query, HTTP_AUTHORIZATION=f"Bearer {access}")

    def test_super_admin_sees_cross_tenant_entries(self):
        response = self._get(self.super_admin)
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(response.data["count"], 3)

    def test_clinician_without_audit_role_is_refused(self):
        self.assertEqual(self._get(self.clinician).status_code, 403)

    def test_org_admin_sees_only_their_org(self):
        response = self._get(self.org_admin)
        self.assertEqual(response.status_code, 200)
        org_ids = {row["organization_id"] for row in response.data["results"]}
        self.assertEqual(org_ids, {str(self.org_a.id)})

    def test_auditor_sees_only_their_org(self):
        response = self._get(self.auditor)
        self.assertEqual(response.status_code, 200)
        org_ids = {row["organization_id"] for row in response.data["results"]}
        self.assertEqual(org_ids, {str(self.org_a.id)})

    def test_org_admin_never_sees_another_orgs_rows(self):
        response = self._get(self.other_org_admin)
        org_ids = {row["organization_id"] for row in response.data["results"]}
        self.assertEqual(org_ids, {str(self.org_b.id)})

    def test_field_values_are_never_returned(self):
        for user in (self.super_admin, self.org_admin, self.auditor):
            response = self._get(user)
            self.assertNotIn("SECRET", str(response.data))
            self.assertTrue(all("field_diff" not in row for row in response.data["results"]))
        update = next(
            row
            for row in self._get(self.org_admin).data["results"]
            if row["model"] == "mhp_program.psychotherapysession"
        )
        self.assertEqual(update["changed_fields"], ["session_notes"])

    def test_reading_the_log_is_itself_audited(self):
        before = AuditLogEntry.objects.filter(model="sysadmin_audit.auditlogentry").count()
        response = self._get(self.org_admin, "?action=UPDATE&q=psycho")
        self.assertEqual(response.status_code, 200)
        entry = AuditLogEntry.objects.filter(model="sysadmin_audit.auditlogentry").latest(
            "timestamp"
        )
        self.assertEqual(
            AuditLogEntry.objects.filter(model="sysadmin_audit.auditlogentry").count(),
            before + 1,
        )
        self.assertEqual(entry.action, AuditLogEntry.ACTION_VIEW)
        self.assertEqual(entry.actor_user_id, self.org_admin.id)
        self.assertEqual(entry.organization_id, self.org_a.id)
        self.assertEqual(entry.field_diff["filters"], {"action": "UPDATE", "q": "psycho"})
        self.assertNotIn("SECRET", str(entry.field_diff))

    def test_date_filter_and_bad_date(self):
        future = self._get(self.org_admin, "?from=2999-01-01")
        self.assertEqual(future.data["count"], 0)
        self.assertEqual(self._get(self.org_admin, "?from=not-a-date").status_code, 400)

    def test_security_category_filters_to_security_relevant_actions(self):
        response = self._get(self.org_admin, "?category=security")
        actions = {row["action"] for row in response.data["results"]}
        self.assertTrue(actions.issubset({"LOGIN", "LOGIN_FAILED", "ERASURE"}))


class AppendOnlyAndCoverageTests(TestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)

    def test_database_rejects_update_and_delete_of_audit_rows(self):
        from django.db import connection, transaction
        from django.db.utils import DatabaseError

        with platform_admin_context():
            org = Organization.objects.create(
                name="Audit Org", slug="audit-org", facility_type="CLINIC"
            )
        entry = AuditLogEntry.objects.filter(object_id=str(org.id)).first()
        self.assertIsNotNone(entry)
        for sql in (
            "UPDATE sysadmin_audit_auditlogentry SET action = 'VIEW' WHERE id = %s",
            "DELETE FROM sysadmin_audit_auditlogentry WHERE id = %s",
        ):
            with self.assertRaises(DatabaseError), transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute(sql, [str(entry.id)])

    def test_security_policy_changes_are_audited(self):
        """apps.security's app_label is platform_security — it used to fall
        outside the audit wiring entirely."""
        from apps.security.models import SecurityPolicy

        policy = SecurityPolicy.get_solo()
        policy.data_retention_years = policy.data_retention_years + 1
        policy.save()
        self.assertTrue(
            AuditLogEntry.objects.filter(
                model="platform_security.securitypolicy", action=AuditLogEntry.ACTION_UPDATE
            ).exists()
        )

    def test_delete_entries_keep_the_deleted_values(self):
        from apps.tenancy.models import SubscriptionPlan

        plan = SubscriptionPlan.objects.create(
            name="Doomed", code="doomed", max_branches=1, price_monthly="1.00"
        )
        plan_id = plan.pk
        plan.delete()
        entry = AuditLogEntry.objects.get(
            model="tenancy.subscriptionplan",
            object_id=str(plan_id),
            action=AuditLogEntry.ACTION_DELETE,
        )
        self.assertEqual(entry.field_diff["name"]["old"], "Doomed")
