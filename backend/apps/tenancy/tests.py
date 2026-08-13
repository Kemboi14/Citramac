from django.db import connection
from django.test import TestCase

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
