import json
from datetime import date

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import ActivationInvite, User
from apps.accounts.tokens import issue_tokens
from apps.tenancy.context import clear_tenant_context, platform_admin_context, set_tenant_context
from apps.tenancy.models import (
    Branch,
    Organization,
    PlatformBranding,
    Subscription,
    SubscriptionPlan,
)


class TenantIsolationTests(TestCase):
    """
    Negative-path tenant isolation — docs/04-MULTI-TENANCY.md §4.6 checklist,
    docs/13-TESTING-QA-CHECKLIST.md §13.2 ("explicitly named, cannot be
    skipped"). Proves isolation holds at BOTH layers doc 04 §4.2 requires:
    the ORM's TenantScopedManager, and Postgres RLS itself — the second
    matters because it's what protects against an application bug in the
    first, so these tests deliberately try to bypass the ORM manager too.
    """

    def setUp(self):
        self.org_a = Organization.objects.create(name="Org A", slug="org-a", facility_type="CLINIC")
        self.org_b = Organization.objects.create(name="Org B", slug="org-b", facility_type="CLINIC")
        with platform_admin_context():
            self.branch_a = Branch.objects.create(
                organization=self.org_a, name="Branch A1", facility_level="L4"
            )
            self.branch_b = Branch.objects.create(
                organization=self.org_b, name="Branch B1", facility_level="L4"
            )
        self.addCleanup(clear_tenant_context)

    def test_no_tenant_bound_sees_nothing(self):
        clear_tenant_context()
        self.assertEqual(Branch.objects.count(), 0)
        self.assertEqual(Branch.all_objects.count(), 0)

    def test_scoped_manager_only_sees_own_org(self):
        set_tenant_context(organization_id=self.org_a.id)
        names = set(Branch.objects.values_list("name", flat=True))
        self.assertEqual(names, {"Branch A1"})

    def test_unfiltered_manager_still_blocked_by_rls(self):
        """The actual defense-in-depth claim: bypass the Python filter, RLS still blocks it."""
        set_tenant_context(organization_id=self.org_a.id)
        self.assertEqual(Branch.all_objects.count(), 1)
        self.assertIsNone(Branch.all_objects.filter(pk=self.branch_b.pk).first())

    def test_raw_sql_still_blocked_by_rls(self):
        """No Django ORM involved at all — proves this is a database-level control."""
        set_tenant_context(organization_id=self.org_a.id)
        with connection.cursor() as cursor:
            cursor.execute("SELECT name FROM tenancy_branch")
            rows = [row[0] for row in cursor.fetchall()]
        self.assertEqual(rows, ["Branch A1"])

    def test_cannot_write_a_row_in_another_org(self):
        """
        The USING clause hides org B's row from org A's session entirely, so
        an UPDATE targeting it by pk matches zero rows (Postgres doesn't
        raise — RLS makes the row invisible, not merely unwritable).
        """
        set_tenant_context(organization_id=self.org_a.id)
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE tenancy_branch SET name = 'hijacked' WHERE id = %s",
                [str(self.branch_b.pk)],
            )
            self.assertEqual(cursor.rowcount, 0)

        with platform_admin_context():
            self.branch_b.refresh_from_db()
        self.assertEqual(self.branch_b.name, "Branch B1")

    def test_platform_admin_context_sees_all_orgs(self):
        with platform_admin_context():
            names = set(Branch.objects.values_list("name", flat=True))
        self.assertEqual(names, {"Branch A1", "Branch B1"})


class OnboardTenantCommandTests(TestCase):
    """
    docs/11-ROADMAP-AND-PHASES.md Phase 9 ("Onboard CAfRIC Centre ... Org
    creation -> activation -> module bundle -> staff onboarding"). Covers
    the ops tool that drives that flow end-to-end, run from the CLI.
    """

    def _run(self, **overrides):
        options = {
            "name": "Test Centre",
            "slug": "test-centre",
            "admin_email": "admin@test-centre.invalid",
            "admin_first_name": "Ada",
            "admin_last_name": "Min",
            "dha_facility_code": "",
            "sha_provider_code": "",
            "branch_name": "",
            "branch_level": "L4",
            "county": "",
            "staff_file": "",
            "dry_run": False,
        }
        options.update(overrides)
        call_command("onboard_tenant", **options)

    def test_creates_org_admin_and_module_bundle(self):
        self._run(branch_name="Main Branch", county="Nairobi")

        with platform_admin_context():
            org = Organization.objects.get(slug="test-centre")
            admin = User.objects.get(email="admin@test-centre.invalid")

            self.assertEqual(org.facility_type, "MENTAL_HEALTH_CCP")
            self.assertIn("ccp_program", org.enabled_modules)
            self.assertIn("client_registry", org.enabled_modules)
            self.assertFalse(admin.is_active)
            self.assertTrue(admin.roles.filter(name="Org Admin").exists())
            self.assertTrue(
                Branch.all_objects.filter(organization=org, name="Main Branch").exists()
            )
            self.assertTrue(ActivationInvite.all_objects.filter(user=admin).exists())

    def test_rerun_is_idempotent(self):
        self._run(branch_name="Main Branch")
        self._run(branch_name="Main Branch")

        with platform_admin_context():
            self.assertEqual(Organization.objects.filter(slug="test-centre").count(), 1)
            self.assertEqual(User.objects.filter(email="admin@test-centre.invalid").count(), 1)
            self.assertEqual(Branch.all_objects.filter(name="Main Branch").count(), 1)
            self.assertEqual(
                ActivationInvite.all_objects.filter(
                    user__email="admin@test-centre.invalid"
                ).count(),
                1,
            )

    def test_dry_run_rolls_back_everything(self):
        self._run(dry_run=True)

        with platform_admin_context():
            self.assertFalse(Organization.objects.filter(slug="test-centre").exists())
            self.assertFalse(User.objects.filter(email="admin@test-centre.invalid").exists())

    def test_staff_file_bulk_invites(self):
        import os
        import tempfile

        fd, path = tempfile.mkstemp(suffix=".json")
        try:
            with os.fdopen(fd, "w") as fh:
                json.dump(
                    [
                        {
                            "email": "doctor@test-centre.invalid",
                            "first_name": "Dana",
                            "last_name": "Doctor",
                            "role": "Doctor",
                            "staff_id": "D-01",
                        }
                    ],
                    fh,
                )
            self._run(branch_name="Main Branch", staff_file=path)
        finally:
            os.remove(path)

        with platform_admin_context():
            staff = User.objects.get(email="doctor@test-centre.invalid")
            self.assertTrue(staff.roles.filter(name="Doctor").exists())
            self.assertEqual(staff.staff_id, "D-01")

    def test_unknown_staff_role_raises_command_error(self):
        import os
        import tempfile

        fd, path = tempfile.mkstemp(suffix=".json")
        try:
            with os.fdopen(fd, "w") as fh:
                json.dump(
                    [
                        {
                            "email": "ghost@test-centre.invalid",
                            "first_name": "Ghost",
                            "last_name": "Role",
                            "role": "Not A Real Role",
                        }
                    ],
                    fh,
                )
            with self.assertRaises(CommandError):
                self._run(staff_file=path)
        finally:
            os.remove(path)


class PlatformBrandingApiTests(APITestCase):
    """
    citramac_SUPER-ADMIN-v4.html sidebar logo, uploaded once by Super Admin
    and shown everywhere — every shell's sidebar plus the generic login
    screen for platform staff with no resolved tenant.
    """

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.super_admin = User.objects.create_superuser(
                email="branding-admin@platform.test", password="Password123!"
            )
            self.non_admin = User.objects.create_user(
                email="branding-staff@platform.test", password="Password123!", is_active=True
            )
        self.super_access, _ = issue_tokens(self.super_admin)
        self.non_admin_access, _ = issue_tokens(self.non_admin)
        self.addCleanup(lambda: PlatformBranding.objects.all().delete())

    def test_get_branding_requires_no_auth(self):
        response = self.client.get(reverse("platform-branding"))
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["logo"])

    def test_super_admin_can_upload_logo(self):
        logo = SimpleUploadedFile("logo.png", b"fake-png-bytes", content_type="image/png")
        response = self.client.post(
            reverse("platform-branding"),
            {"logo": logo},
            format="multipart",
            HTTP_AUTHORIZATION=f"Bearer {self.super_access}",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNotNone(response.data["logo"])
        self.assertIn("platform/branding/", response.data["logo"])

        # And it's now visible to anyone, unauthenticated, at the same GET.
        get_response = self.client.get(reverse("platform-branding"))
        self.assertEqual(get_response.data["logo"], response.data["logo"])

    def test_non_super_admin_cannot_upload_logo(self):
        logo = SimpleUploadedFile("logo.png", b"fake-png-bytes", content_type="image/png")
        response = self.client.post(
            reverse("platform-branding"),
            {"logo": logo},
            format="multipart",
            HTTP_AUTHORIZATION=f"Bearer {self.non_admin_access}",
        )
        self.assertEqual(response.status_code, 403)

    def test_rejects_disallowed_file_type(self):
        bad_file = SimpleUploadedFile("logo.exe", b"not-an-image", content_type="application/exe")
        response = self.client.post(
            reverse("platform-branding"),
            {"logo": bad_file},
            format="multipart",
            HTTP_AUTHORIZATION=f"Bearer {self.super_access}",
        )
        self.assertEqual(response.status_code, 400)

    def test_accepts_a_large_source_logo_up_to_30mb(self):
        """A high-res source logo up to the 30MB ceiling must be accepted, not just tiny files."""
        from apps.tenancy.views import LOGO_MAX_SIZE_BYTES

        large_logo = SimpleUploadedFile(
            "logo.png", b"x" * (LOGO_MAX_SIZE_BYTES - 1), content_type="image/png"
        )
        response = self.client.post(
            reverse("platform-branding"),
            {"logo": large_logo},
            format="multipart",
            HTTP_AUTHORIZATION=f"Bearer {self.super_access}",
        )
        self.assertEqual(response.status_code, 200, response.data)

    def test_rejects_a_logo_over_30mb(self):
        from apps.tenancy.views import LOGO_MAX_SIZE_BYTES

        oversized_logo = SimpleUploadedFile(
            "logo.png", b"x" * (LOGO_MAX_SIZE_BYTES + 1), content_type="image/png"
        )
        response = self.client.post(
            reverse("platform-branding"),
            {"logo": oversized_logo},
            format="multipart",
            HTTP_AUTHORIZATION=f"Bearer {self.super_access}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "FILE_TOO_LARGE")


class OrganizationConsoleApiTests(APITestCase):
    """Super Admin's Organizations screen — multi-vertical onboarding,
    search/filter, status transitions (citramac_SUPER-ADMIN.html)."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.super_admin = User.objects.create_superuser(
                email="root@platform.test", password="Password123!"
            )
        self.access, _ = issue_tokens(self.super_admin)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.access}"}

    def test_create_school_organization_defaults_to_pending_verification(self):
        response = self.client.post(
            reverse("platform-organizations"),
            {
                "name": "Greenview Primary School",
                "slug": "greenview-primary",
                "org_type": "SCHOOL",
                "dha_facility_code": "MOE-27-04-119",
                "org_admin": {
                    "email": "admin@greenview.test",
                    "first_name": "Grace",
                    "last_name": "Njeri",
                },
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], Organization.STATUS_PENDING)
        self.assertEqual(response.data["org_type"], "SCHOOL")

    def test_create_organization_with_subscription_and_branding(self):
        with platform_admin_context():
            plan = SubscriptionPlan.objects.create(
                name="Growth",
                code="growth-branding-test",
                max_branches=5,
                max_staff_seats=50,
                price_monthly="18500.00",
            )
        response = self.client.post(
            reverse("platform-organizations"),
            {
                "name": "Branded Wellness Centre",
                "slug": "branded-wellness",
                "org_type": "HOSPITAL",
                "facility_type": "MENTAL_HEALTH_CCP",
                "dha_facility_code": "MFL-77123",
                "subscription_plan_code": plan.code,
                "billing_cycle": "MONTHLY",
                "logo_url": "https://example.com/logo.png",
                "tagline": "Care that lasts",
                "primary_color": "#1a63c9",
                "support_email": "support@branded-wellness.test",
                "support_phone": "+254700000000",
                "website": "https://branded-wellness.test",
                "org_admin": {
                    "email": "admin@branded-wellness.test",
                    "first_name": "Ada",
                    "last_name": "Min",
                    "phone": "+254711111111",
                },
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["logo_url"], "https://example.com/logo.png")
        self.assertEqual(response.data["primary_color"], "#1a63c9")
        self.assertEqual(response.data["tagline"], "Care that lasts")

        with platform_admin_context():
            org = Organization.objects.get(slug="branded-wellness")
            self.assertEqual(org.subscription_plan_id, plan.id)
            subscription = Subscription.objects.get(organization=org)
            self.assertEqual(subscription.billing_cycle, "MONTHLY")
            admin_user = User.objects.get(email="admin@branded-wellness.test")
            self.assertEqual(admin_user.phone, "+254711111111")

    def test_super_admin_can_upload_organization_logo(self):
        with platform_admin_context():
            org = Organization.objects.create(
                name="Logo Org", slug="logo-org", facility_type="CLINIC"
            )
        logo = SimpleUploadedFile("logo.png", b"fake-png-bytes", content_type="image/png")
        response = self.client.post(
            reverse("platform-organization-logo", args=[org.id]),
            {"logo": logo},
            format="multipart",
            **self.auth,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("organizations/logos/logo-org", response.data["logo_url"])

        with platform_admin_context():
            org.refresh_from_db()
            self.assertIn("organizations/logos/logo-org", org.logo_url)

    def test_non_super_admin_cannot_upload_organization_logo(self):
        with platform_admin_context():
            org = Organization.objects.create(
                name="Locked Logo Org", slug="locked-logo-org", facility_type="CLINIC"
            )
            org_admin = User.objects.create_user(
                email="orgadmin@locked-logo-org.test",
                password="Password123!",
                organization=org,
                is_active=True,
            )
        org_admin_access, _ = issue_tokens(org_admin)
        logo = SimpleUploadedFile("logo.png", b"fake-png-bytes", content_type="image/png")
        response = self.client.post(
            reverse("platform-organization-logo", args=[org.id]),
            {"logo": logo},
            format="multipart",
            HTTP_AUTHORIZATION=f"Bearer {org_admin_access}",
        )
        self.assertEqual(response.status_code, 403)

    def test_hospital_requires_facility_type(self):
        response = self.client.post(
            reverse("platform-organizations"),
            {
                "name": "Missing Facility Type",
                "slug": "missing-facility-type",
                "org_type": "HOSPITAL",
                "org_admin": {"email": "a@b.test", "first_name": "A", "last_name": "B"},
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("facility_type", response.data)

    def test_invalid_identity_code_format_rejected(self):
        response = self.client.post(
            reverse("platform-organizations"),
            {
                "name": "Bad Code Clinic",
                "slug": "bad-code-clinic",
                "org_type": "HOSPITAL",
                "facility_type": "CLINIC",
                "dha_facility_code": "NOT-A-CODE",
                "org_admin": {"email": "c@d.test", "first_name": "C", "last_name": "D"},
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("dha_facility_code", response.data)

    def test_status_transition_sets_mfl_verified_at(self):
        with platform_admin_context():
            org = Organization.objects.create(
                name="Pending Org",
                slug="pending-org",
                facility_type="CLINIC",
                status=Organization.STATUS_PENDING,
            )
        response = self.client.post(
            reverse("platform-organization-status", args=[org.id]),
            {"status": "ACTIVE"},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNotNone(response.data["mfl_verified_at"])
        self.assertTrue(response.data["is_active"])

    def test_non_superuser_cannot_list_organizations(self):
        with platform_admin_context():
            org = Organization.objects.create(name="Org", slug="org-x", facility_type="CLINIC")
            staff = User.objects.create_user(
                email="staff@org-x.test", password="Password123!", organization=org, is_active=True
            )
        access, _ = issue_tokens(staff)
        response = self.client.get(
            reverse("platform-organizations"), HTTP_AUTHORIZATION=f"Bearer {access}"
        )
        self.assertEqual(response.status_code, 403)


class BranchAndSubscriptionScopingTests(APITestCase):
    """Branches/Subscriptions screens: Super Admin sees every tenant, Org
    Admin is confined to their own — same isolation contract as
    TenantIsolationTests above, exercised through the real API this time."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org_a = Organization.objects.create(
                name="Org A", slug="branch-org-a", facility_type="CLINIC"
            )
            self.org_b = Organization.objects.create(
                name="Org B", slug="branch-org-b", facility_type="CLINIC"
            )
            self.branch_a = Branch.objects.create(
                organization=self.org_a, name="Branch A1", facility_level="L4"
            )
            self.branch_b = Branch.objects.create(
                organization=self.org_b, name="Branch B1", facility_level="L4"
            )
            self.super_admin = User.objects.create_superuser(
                email="root2@platform.test", password="Password123!"
            )
            from apps.accounts.models import Role

            self.org_admin_role = Role.objects.filter(
                name="Org Admin", organization__isnull=True
            ).first()
            self.org_a_admin = User.objects.create_user(
                email="admin@org-a.test",
                password="Password123!",
                organization=self.org_a,
                is_active=True,
            )
            self.org_a_admin.roles.add(self.org_admin_role)
            self.plan = SubscriptionPlan.objects.create(
                name="Growth",
                code="growth-test",
                max_branches=5,
                max_staff_seats=50,
                price_monthly="18500.00",
            )
            self.sub_a = Subscription.objects.create(
                organization=self.org_a, plan=self.plan, current_period_end=date(2027, 1, 1)
            )
            Subscription.objects.create(
                organization=self.org_b, plan=self.plan, current_period_end=date(2027, 1, 1)
            )

        self.super_access, _ = issue_tokens(self.super_admin)
        self.org_a_access, _ = issue_tokens(self.org_a_admin)

    def test_super_admin_sees_all_branches(self):
        response = self.client.get(
            reverse("branch-list"), HTTP_AUTHORIZATION=f"Bearer {self.super_access}"
        )
        self.assertEqual(response.data["count"], 2)

    def test_org_admin_sees_only_own_branch(self):
        response = self.client.get(
            reverse("branch-list"), HTTP_AUTHORIZATION=f"Bearer {self.org_a_access}"
        )
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], str(self.branch_a.id))

    def test_org_admin_cannot_create_branch(self):
        response = self.client.post(
            reverse("branch-list"),
            {"organization": str(self.org_a.id), "name": "New Branch", "facility_level": "L3"},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org_a_access}",
        )
        self.assertEqual(response.status_code, 403)

    def test_org_admin_can_update_own_branch(self):
        response = self.client.patch(
            reverse("branch-detail", args=[self.branch_a.id]),
            {"phone": "+254700000000"},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org_a_access}",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["phone"], "+254700000000")

    def test_org_admin_cannot_update_other_orgs_branch(self):
        response = self.client.patch(
            reverse("branch-detail", args=[self.branch_b.id]),
            {"phone": "+254700000000"},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org_a_access}",
        )
        self.assertEqual(response.status_code, 404)

    def test_org_admin_sees_only_own_subscription(self):
        response = self.client.get(
            reverse("subscription-list"), HTTP_AUTHORIZATION=f"Bearer {self.org_a_access}"
        )
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], str(self.sub_a.id))

    def test_branch_sha_credentials_are_encrypted_at_rest(self):
        self.client.patch(
            reverse("branch-detail", args=[self.branch_a.id]),
            {"sha_api_credentials": "super-secret-api-key"},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org_a_access}",
        )
        with platform_admin_context():
            self.branch_a.refresh_from_db()
        self.assertNotIn("super-secret-api-key", self.branch_a.sha_api_credentials_encrypted)
        self.assertTrue(self.branch_a.has_sha_credentials)


class OrgDashboardStatsViewTests(APITestCase):
    """
    citramac_ORG-admin.html "Org Dashboard" stat cards + Ward Occupancy panel.
    Regression test for a real bug this suite didn't catch: the outpatient/CCP
    volume query filtered on `Patient.care_type`, a field that doesn't exist
    (the real field is `patient_category`) — every Org Admin's dashboard 500'd.
    """

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Dashboard Org", slug="dashboard-org", facility_type="CLINIC"
            )
            from apps.accounts.models import Role

            org_admin_role = Role.objects.filter(
                name="Org Admin", organization__isnull=True
            ).first()
            self.org_admin = User.objects.create_user(
                email="admin@dashboard-org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.org_admin.roles.add(org_admin_role)

        set_tenant_context(organization_id=self.org.id)
        from apps.client_registry.models import Patient

        Patient.objects.create(
            organization=self.org,
            first_name="Jane",
            last_name="Outpatient",
            gender="F",
            date_of_birth=date(1990, 1, 1),
            patient_category="OUTPATIENT",
        )
        clear_tenant_context()

        self.org_admin_access, _ = issue_tokens(self.org_admin)

    def test_dashboard_stats_returns_real_counts(self):
        response = self.client.get(
            reverse("org-dashboard-stats"),
            HTTP_AUTHORIZATION=f"Bearer {self.org_admin_access}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["outpatient_ccp_volume"], 1)


class InviteStaffCommandTests(TestCase):
    """
    Narrower alternative to onboard_tenant for adding one staff member to an
    *existing* org without risking an accidental Organization-level upsert.
    """

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Existing Centre", slug="existing-centre", facility_type="MENTAL_HEALTH_CCP"
            )
            self.branch = Branch.objects.create(organization=self.org, name="Main Branch")

    def test_invites_a_new_staff_member_with_a_valid_role(self):
        call_command(
            "invite_staff",
            org_slug="existing-centre",
            email="new.doctor@existing-centre.invalid",
            first_name="Grace",
            last_name="Otieno",
            role="Doctor",
            staff_id="",
            branch_name="",
        )

        with platform_admin_context():
            user = User.objects.get(email="new.doctor@existing-centre.invalid")
            self.assertFalse(user.is_active)
            self.assertEqual(user.organization_id, self.org.id)
            self.assertTrue(user.roles.filter(name="Doctor").exists())
            self.assertTrue(ActivationInvite.all_objects.filter(user=user).exists())

    def test_grants_branch_access_when_branch_name_given(self):
        call_command(
            "invite_staff",
            org_slug="existing-centre",
            email="branch.doctor@existing-centre.invalid",
            first_name="Kevin",
            last_name="Mwangi",
            role="Doctor",
            staff_id="",
            branch_name="Main Branch",
        )

        with platform_admin_context():
            user = User.objects.get(email="branch.doctor@existing-centre.invalid")
            self.assertTrue(user.branch_access.filter(id=self.branch.id).exists())

    def test_rejects_unknown_org_slug(self):
        with self.assertRaises(CommandError):
            call_command(
                "invite_staff",
                org_slug="does-not-exist",
                email="x@existing-centre.invalid",
                first_name="X",
                last_name="Y",
                role="Doctor",
                staff_id="",
                branch_name="",
            )

    def test_rejects_unknown_role(self):
        with self.assertRaises(CommandError):
            call_command(
                "invite_staff",
                org_slug="existing-centre",
                email="x@existing-centre.invalid",
                first_name="X",
                last_name="Y",
                role="Not A Real Role",
                staff_id="",
                branch_name="",
            )

    def test_does_not_re_invite_an_existing_user(self):
        with platform_admin_context():
            User.objects.create(
                organization=self.org,
                email="already.here@existing-centre.invalid",
                first_name="Already",
                last_name="Here",
                is_active=True,
            )

        call_command(
            "invite_staff",
            org_slug="existing-centre",
            email="already.here@existing-centre.invalid",
            first_name="Different",
            last_name="Name",
            role="Doctor",
            staff_id="",
            branch_name="",
        )

        with platform_admin_context():
            user = User.objects.get(email="already.here@existing-centre.invalid")
            # Untouched — still active, name unchanged, no new invite created.
            self.assertTrue(user.is_active)
            self.assertEqual(user.first_name, "Already")
            self.assertFalse(ActivationInvite.all_objects.filter(user=user).exists())
