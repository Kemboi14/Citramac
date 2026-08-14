import json

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TestCase

from apps.accounts.models import ActivationInvite, User
from apps.tenancy.context import clear_tenant_context, platform_admin_context, set_tenant_context
from apps.tenancy.models import Branch, Organization


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
