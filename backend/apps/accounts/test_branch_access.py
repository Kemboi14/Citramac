"""Role-per-branch assignments, branch isolation and the staff-roster write guard."""

from django.core.cache import cache
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.client_registry.models import Appointment, Patient
from apps.tenancy.context import (
    clear_tenant_context,
    platform_admin_context,
    set_branch_scope,
    set_tenant_context,
)
from apps.tenancy.models import Branch, Organization

from .access import active_roles, set_assignments, visible_branch_ids
from .models import Role, RoleAssignment, User
from .tokens import issue_tokens


class BranchAccessTestCase(APITestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Cafric", slug="cafric", facility_type="MENTAL_HEALTH_MHP"
            )
            self.thika = Branch.objects.create(organization=self.org, name="Thika", facility_level="L3")
            self.ruiru = Branch.objects.create(organization=self.org, name="Ruiru", facility_level="L3")
            self.org_admin_role = Role.objects.get(name="Org Admin", organization__isnull=True)
            self.nurse_role = Role.objects.get(name="Nurse", organization__isnull=True)
            self.cashier_role = Role.objects.get(name="Cashier/Billing Clerk", organization__isnull=True)
            self.therapist_role = Role.objects.get(
                name="Clinical Psychologist/Therapist", organization__isnull=True
            )
            self.admin = self._user("admin@cafric.test", [(self.org_admin_role, None)])
            self.nurse = self._user("nurse@cafric.test", [(self.nurse_role, self.thika)])
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Faith",
                last_name="Mwangi",
                gender="FEMALE",
                date_of_birth="1997-03-14",
            )
            when = timezone.now() + timezone.timedelta(days=1)
            self.at_thika = Appointment.objects.create(
                organization=self.org, patient=self.patient, branch=self.thika, scheduled_for=when
            )
            self.at_ruiru = Appointment.objects.create(
                organization=self.org, patient=self.patient, branch=self.ruiru, scheduled_for=when
            )

    def _user(self, email, pairs):
        user = User.objects.create_user(
            email=email, password="Password123!", organization=self.org, is_active=True
        )
        set_tenant_context(organization_id=self.org.id)
        set_assignments(user, pairs)
        set_tenant_context(is_platform_admin=True)
        return user

    def auth(self, user, branch=None):
        access, _ = issue_tokens(user)
        headers = {"HTTP_AUTHORIZATION": f"Bearer {access}"}
        if branch is not None:
            headers["HTTP_X_BRANCH_ID"] = str(branch)
        return headers

    def appointment_ids(self, user, branch=None):
        response = self.client.get(reverse("appointment-list"), **self.auth(user, branch))
        self.assertEqual(response.status_code, 200, response.data)
        rows = response.data["results"] if isinstance(response.data, dict) else response.data
        return {row["id"] for row in rows}


class StaffRosterWriteGuardTests(BranchAccessTestCase):
    def test_staff_member_cannot_make_themselves_org_admin(self):
        response = self.client.patch(
            reverse("staff-detail", args=[self.nurse.id]),
            {"assignments": [{"role": self.org_admin_role.id, "branch": None}]},
            format="json",
            **self.auth(self.nurse),
        )
        self.assertEqual(response.status_code, 403)
        with platform_admin_context():
            self.assertFalse(self.nurse.roles.filter(name="Org Admin").exists())

    def test_staff_member_can_still_read_the_roster(self):
        response = self.client.get(reverse("staff-list"), **self.auth(self.nurse))
        self.assertEqual(response.status_code, 200)

    def test_platform_staff_role_cannot_be_handed_to_tenant_staff(self):
        super_admin_role = Role.objects.get(name="Super Admin", organization__isnull=True)
        response = self.client.patch(
            reverse("staff-detail", args=[self.nurse.id]),
            {"assignments": [{"role": super_admin_role.id, "branch": None}]},
            format="json",
            **self.auth(self.admin),
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("assignments", response.data)


class AssignmentTests(BranchAccessTestCase):
    def test_org_admin_assigns_roles_per_branch(self):
        response = self.client.patch(
            reverse("staff-detail", args=[self.nurse.id]),
            {
                "assignments": [
                    {"role": self.nurse_role.id, "branch": str(self.thika.id)},
                    {"role": self.cashier_role.id, "branch": str(self.ruiru.id)},
                ],
                "primary_branch": str(self.thika.id),
            },
            format="json",
            **self.auth(self.admin),
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            sorted((a["role_name"], a["branch_name"]) for a in response.data["assignments"]),
            [("Cashier/Billing Clerk", "Ruiru"), ("Nurse", "Thika")],
        )
        self.assertEqual(sorted(response.data["role_names"]), ["Cashier/Billing Clerk", "Nurse"])
        self.assertEqual(
            set(response.data["branch_access"]), {self.thika.id, self.ruiru.id}
        )

    def test_primary_branch_must_be_an_assigned_branch(self):
        response = self.client.patch(
            reverse("staff-detail", args=[self.nurse.id]),
            {"primary_branch": str(self.ruiru.id)},
            format="json",
            **self.auth(self.admin),
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("primary_branch", response.data)

    def test_org_admin_is_always_organisation_wide(self):
        with platform_admin_context():
            set_assignments(self.nurse, [(self.org_admin_role, self.thika)])
            assignment = RoleAssignment.all_objects.get(user=self.nurse)
        self.assertIsNone(assignment.branch_id)

    def test_invite_with_two_roles(self):
        response = self.client.post(
            reverse("staff-list"),
            {
                "email": "kennedy@cafric.test",
                "first_name": "Kennedy",
                "last_name": "Ikonya",
                "assignments": [
                    {"role": self.org_admin_role.id, "branch": None},
                    {"role": self.therapist_role.id, "branch": str(self.thika.id)},
                ],
            },
            format="json",
            **self.auth(self.admin),
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            sorted(response.data["role_names"]),
            ["Clinical Psychologist/Therapist", "Org Admin"],
        )

    def test_token_lands_org_admin_in_console_and_lists_every_role(self):
        with platform_admin_context():
            set_assignments(
                self.admin, [(self.org_admin_role, None), (self.therapist_role, self.thika)]
            )
        access, _ = issue_tokens(self.admin)
        claims = AccessToken(access)
        self.assertEqual(claims["role"], "Org Admin")
        self.assertEqual(claims["roles"], ["Clinical Psychologist/Therapist", "Org Admin"])
        self.assertEqual(set(claims["branch_ids"]), {str(self.thika.id), str(self.ruiru.id)})


class BranchIsolationTests(BranchAccessTestCase):
    def test_staff_see_only_their_branch(self):
        self.assertEqual(self.appointment_ids(self.nurse), {str(self.at_thika.id)})

    def test_org_admin_sees_every_branch_and_can_narrow_to_one(self):
        self.assertEqual(
            self.appointment_ids(self.admin, "all"), {str(self.at_thika.id), str(self.at_ruiru.id)}
        )
        self.assertEqual(self.appointment_ids(self.admin, self.ruiru.id), {str(self.at_ruiru.id)})

    def test_working_at_an_unassigned_branch_is_refused(self):
        response = self.client.get(
            reverse("appointment-list"), **self.auth(self.nurse, self.ruiru.id)
        )
        self.assertEqual(response.status_code, 403)

    def test_only_org_wide_accounts_can_work_across_all_branches(self):
        response = self.client.get(reverse("appointment-list"), **self.auth(self.nurse, "all"))
        self.assertEqual(response.status_code, 403)

    def test_unbranched_records_stay_visible(self):
        with platform_admin_context():
            legacy = Appointment.objects.create(
                organization=self.org,
                patient=self.patient,
                scheduled_for=timezone.now() + timezone.timedelta(days=2),
            )
        self.assertIn(str(legacy.id), self.appointment_ids(self.nurse))

    def test_new_records_take_the_working_branch(self):
        set_tenant_context(organization_id=self.org.id)
        set_branch_scope({self.ruiru.id}, self.ruiru.id)
        appointment = Appointment.objects.create(
            organization=self.org,
            patient=self.patient,
            scheduled_for=timezone.now() + timezone.timedelta(days=3),
        )
        self.assertEqual(appointment.branch_id, self.ruiru.id)

    def test_profile_lists_every_branch_for_org_admin(self):
        response = self.client.get(reverse("me-profile"), **self.auth(self.admin))
        self.assertTrue(response.data["all_branches"])
        self.assertEqual({b["name"] for b in response.data["branches"]}, {"Thika", "Ruiru"})
        response = self.client.get(reverse("me-profile"), **self.auth(self.nurse))
        self.assertFalse(response.data["all_branches"])
        self.assertEqual([b["name"] for b in response.data["branches"]], ["Thika"])


class ActiveRoleTests(BranchAccessTestCase):
    def test_roles_follow_the_working_branch(self):
        with platform_admin_context():
            set_assignments(
                self.nurse, [(self.nurse_role, self.thika), (self.cashier_role, self.ruiru)]
            )
        set_tenant_context(organization_id=self.org.id)
        set_branch_scope({self.thika.id}, self.thika.id)
        self.assertEqual(set(active_roles(self.nurse).values_list("name", flat=True)), {"Nurse"})
        set_branch_scope({self.ruiru.id}, self.ruiru.id)
        self.assertEqual(
            set(active_roles(self.nurse).values_list("name", flat=True)), {"Cashier/Billing Clerk"}
        )

    def test_finance_writes_only_where_a_finance_role_is_held(self):
        from apps.billing.permissions import is_finance

        with platform_admin_context():
            set_assignments(
                self.nurse, [(self.nurse_role, self.thika), (self.cashier_role, self.ruiru)]
            )
        set_tenant_context(organization_id=self.org.id)
        set_branch_scope({self.thika.id}, self.thika.id)
        self.assertFalse(is_finance(self.nurse))
        set_branch_scope({self.ruiru.id}, self.ruiru.id)
        self.assertTrue(is_finance(self.nurse))

    def test_visible_branches(self):
        self.assertIsNone(visible_branch_ids(self.admin))
        self.assertEqual(visible_branch_ids(self.nurse), {str(self.thika.id)})
