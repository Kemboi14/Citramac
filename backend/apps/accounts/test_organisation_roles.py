"""
Platform roles stay on the platform; each organisation owns its roles
(apps.accounts.catalogue "Roles", apps.accounts.roles).
"""

from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Branch, Organization

from .access import has_permission, is_org_admin, set_assignments
from .catalogue import ORGANISATION_ROLES
from .models import Permission, Role, User
from .tokens import issue_tokens

STANDARD_KEYS = {key for key, _, _, _, legacy in ORGANISATION_ROLES if not legacy}
LEGACY_KEYS = {key for key, _, _, _, legacy in ORGANISATION_ROLES if legacy}


def _codenames(role):
    return set(role.permissions.values_list("codename", flat=True))


class OrganisationOwnedRolesTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(name="Amani", slug="amani-roles")
            self.other = Organization.objects.create(name="Tumaini", slug="tumaini-roles")
            self.branch = Branch.objects.create(
                organization=self.org, name="Main", facility_level="L4"
            )
            self.thika = Branch.objects.create(
                organization=self.org, name="Thika", facility_level="L4"
            )
            self.admin = User.objects.create_user(
                email="admin@amani.test", organization=self.org, is_active=True
            )
            self.own = lambda key, org=None: Role.objects.get(
                organization=org or self.org, system_key=key
            )
            set_assignments(self.admin, [(self.own("org_admin"), None)])
            self.super_admin = User.objects.create_superuser(email="root@platform.test")
        self.token, _ = issue_tokens(self.admin)
        self.super_token, _ = issue_tokens(self.super_admin)

    def auth(self, token=None):
        return {"HTTP_AUTHORIZATION": f"Bearer {token or self.token}"}

    def test_a_new_organisation_gets_its_own_copy_of_each_standard_role(self):
        with platform_admin_context():
            keys = set(
                Role.objects.filter(organization=self.org).values_list("system_key", flat=True)
            )
            self.assertEqual(keys, STANDARD_KEYS)
            for key in STANDARD_KEYS:
                definition = Role.objects.get(organization__isnull=True, system_key=key)
                self.assertEqual(_codenames(self.own(key)), _codenames(definition), key)
        self.assertFalse(keys & LEGACY_KEYS)

    def test_one_organisations_changes_never_reach_another(self):
        with platform_admin_context():
            mine = self.own("psychiatrist")
            theirs = self.own("psychiatrist", self.other)
            definition = Role.objects.get(organization__isnull=True, system_key="psychiatrist")
            before = _codenames(theirs)
        response = self.client.patch(
            reverse("role-detail", args=[mine.id]),
            {"name": "Consultant Psychiatrist", "permissions": []},
            format="json",
            **self.auth(),
        )
        self.assertEqual(response.status_code, 200, response.data)
        with platform_admin_context():
            mine.refresh_from_db()
            self.assertEqual(mine.name, "Consultant Psychiatrist")
            self.assertEqual(mine.system_key, "psychiatrist")
            self.assertEqual(_codenames(mine), set())
            self.assertEqual(_codenames(theirs), before)
            self.assertEqual(_codenames(definition), before)
            self.assertEqual(theirs.name, "Psychiatrist")

    def test_another_organisations_role_is_out_of_reach(self):
        with platform_admin_context():
            theirs = self.own("nurse", self.other)
        response = self.client.patch(
            reverse("role-detail", args=[theirs.id]),
            {"permissions": []},
            format="json",
            **self.auth(),
        )
        self.assertEqual(response.status_code, 404)

    def test_names_of_administrator_roles_are_reserved_and_names_are_unique(self):
        for name in ("Org Admin", "org admin", "Auditor", "Super Admin", "nurse"):
            response = self.client.post(
                reverse("role-list"), {"name": name}, format="json", **self.auth()
            )
            self.assertEqual(response.status_code, 400, name)
            self.assertIn("name", response.data)

    def test_administrator_power_follows_the_key_not_the_name(self):
        with platform_admin_context():
            lookalike = Role.objects.create(name="Org Admin Nairobi", organization=self.org)
            person = User.objects.create_user(
                email="lookalike@amani.test", organization=self.org, is_active=True
            )
            set_assignments(person, [(lookalike, None)])
            renamed = self.own("org_admin")
        self.assertFalse(is_org_admin(person))
        self.assertTrue(is_org_admin(self.admin))
        self.assertTrue(renamed.is_locked)

    def test_a_standard_definition_id_lands_on_the_organisations_own_copy(self):
        with platform_admin_context():
            definition = Role.objects.get(organization__isnull=True, system_key="nurse")
        response = self.client.post(
            reverse("staff-list"),
            {
                "email": "nurse@amani.test",
                "first_name": "Ann",
                "last_name": "Mutua",
                "role": definition.id,
            },
            format="json",
            **self.auth(),
        )
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            staff = User.objects.get(email="nurse@amani.test")
            self.assertEqual(list(staff.roles.all()), [self.own("nurse")])

    def test_staff_cannot_be_given_another_organisations_or_a_platform_role(self):
        with platform_admin_context():
            theirs = self.own("nurse", self.other)
            support = Role.objects.get(organization__isnull=True, system_key="support_agent")
        for role in (theirs, support):
            response = self.client.post(
                reverse("staff-list"),
                {
                    "email": f"x{role.id}@amani.test",
                    "first_name": "X",
                    "last_name": "Y",
                    "role": role.id,
                },
                format="json",
                **self.auth(),
            )
            self.assertEqual(response.status_code, 400, role.name)

    def test_retire_only_when_nobody_holds_it_and_retired_roles_cannot_be_given(self):
        with platform_admin_context():
            nurse = self.own("nurse")
            holder = User.objects.create_user(
                email="holder@amani.test", organization=self.org, is_active=True
            )
            set_assignments(holder, [(nurse, self.branch)])
        refused = self.client.post(reverse("role-retire", args=[nurse.id]), **self.auth())
        self.assertEqual(refused.status_code, 400)
        self.assertIn("1 person holds", str(refused.data))

        with platform_admin_context():
            set_assignments(holder, [(self.own("doctor"), self.branch)])
        retired = self.client.post(reverse("role-retire", args=[nurse.id]), **self.auth())
        self.assertEqual(retired.status_code, 200, retired.data)
        self.assertFalse(retired.data["is_active"])

        given = self.client.patch(
            reverse("staff-detail", args=[holder.id]),
            {"assignments": [{"role": nurse.id, "branch": str(self.branch.id)}]},
            format="json",
            **self.auth(),
        )
        self.assertEqual(given.status_code, 400)
        self.assertIn("retired", str(given.data))

        back = self.client.post(reverse("role-reactivate", args=[nurse.id]), **self.auth())
        self.assertTrue(back.data["is_active"])
        with platform_admin_context():
            self.assertTrue(Role.objects.filter(pk=nurse.pk).exists())

    def test_built_in_roles_cannot_be_retired_or_copied(self):
        with platform_admin_context():
            admin_role = self.own("org_admin")
        self.assertEqual(
            self.client.post(
                reverse("role-retire", args=[admin_role.id]), **self.auth()
            ).status_code,
            400,
        )
        copied = self.client.post(
            reverse("role-list"),
            {"name": "Deputy", "copy_from": admin_role.id},
            format="json",
            **self.auth(),
        )
        self.assertEqual(copied.status_code, 400)

    def test_copy_a_role_and_list_who_holds_one(self):
        with platform_admin_context():
            psychiatrist = self.own("psychiatrist")
            ezekiel = User.objects.create_user(
                email="ezekiel@amani.test",
                first_name="Ezekiel",
                organization=self.org,
                is_active=True,
            )
            set_assignments(ezekiel, [(psychiatrist, self.branch), (psychiatrist, self.thika)])
        copied = self.client.post(
            reverse("role-list"),
            {"name": "Locum Psychiatrist", "copy_from": psychiatrist.id},
            format="json",
            **self.auth(),
        )
        self.assertEqual(copied.status_code, 201, copied.data)
        self.assertEqual(
            set(copied.data["permissions"]),
            set(psychiatrist.permissions.values_list("id", flat=True)),
        )
        self.assertEqual(copied.data["kind"], "custom")

        members = self.client.get(reverse("role-members", args=[psychiatrist.id]), **self.auth())
        self.assertEqual(members.status_code, 200)
        self.assertEqual(
            [(m["email"], m["branches"]) for m in members.data],
            [("ezekiel@amani.test", ["Main", "Thika"])],
        )

    def test_permission_changes_are_audited(self):
        with platform_admin_context():
            doctor = self.own("doctor")
            unmask = Permission.objects.get(codename="clinical.identity_numbers.unmask")
            ids = list(doctor.permissions.values_list("id", flat=True)) + [unmask.id]
        response = self.client.patch(
            reverse("role-detail", args=[doctor.id]),
            {"permissions": ids},
            format="json",
            **self.auth(),
        )
        self.assertEqual(response.status_code, 200, response.data)
        with platform_admin_context():
            entry = AuditLogEntry.objects.filter(
                model="accounts.role",
                object_id=str(doctor.id),
                action="UPDATE",
                field_diff__has_key="permissions_added",
            ).latest("timestamp")
        self.assertEqual(
            entry.field_diff["permissions_added"]["new"], ["clinical.identity_numbers.unmask"]
        )
        self.assertEqual(entry.organization_id, self.org.id)

    def test_permissions_apply_per_organisation_copy(self):
        with platform_admin_context():
            person = User.objects.create_user(
                email="doc@amani.test", organization=self.org, is_active=True
            )
            set_assignments(person, [(self.own("doctor"), None)])
        self.assertTrue(has_permission(person, "clinical.medication.prescribe"))
        with platform_admin_context():
            self.own("doctor").permissions.clear()
        self.assertFalse(has_permission(person, "clinical.medication.prescribe"))

    def test_platform_roles_take_only_platform_permissions(self):
        with platform_admin_context():
            support = Role.objects.get(organization__isnull=True, system_key="support_agent")
            org_perm = Permission.objects.get(codename="clinical.care.record")
        response = self.client.patch(
            reverse("role-detail", args=[support.id]),
            {"permissions": [org_perm.id]},
            format="json",
            **self.auth(self.super_token),
        )
        self.assertEqual(response.status_code, 400)

    def test_platform_staff_get_platform_roles_only_and_never_super_admin(self):
        with platform_admin_context():
            nurse = self.own("nurse")
            super_role = Role.objects.get(organization__isnull=True, system_key="super_admin")
            support = Role.objects.get(organization__isnull=True, system_key="support_agent")
        for role, expected in ((nurse, 400), (super_role, 400), (support, 201)):
            response = self.client.post(
                reverse("platform-staff-list"),
                {
                    "email": f"p{role.id}@softlink.test",
                    "first_name": "P",
                    "last_name": "T",
                    "role": role.id,
                },
                format="json",
                **self.auth(self.super_token),
            )
            self.assertEqual(response.status_code, expected, role.name)

    def test_risk_alerts_go_to_whoever_holds_the_permission(self):
        from apps.notifications.models import Notification
        from apps.notifications.tasks import notify_supervisors_of_risk

        with platform_admin_context():
            supervisor = User.objects.create_user(
                email="sup@amani.test", organization=self.org, is_active=True
            )
            set_assignments(supervisor, [(self.own("clinical_supervisor"), None)])
            nurse = User.objects.create_user(
                email="n@amani.test", organization=self.org, is_active=True
            )
            set_assignments(nurse, [(self.own("nurse"), None)])
        notify_supervisors_of_risk(str(self.org.id), "enc-1", "A Client")
        with platform_admin_context():
            told = set(
                Notification.objects.filter(category="RISK_ALERT").values_list(
                    "recipient__email", flat=True
                )
            )
        self.assertEqual(told, {"sup@amani.test"})
