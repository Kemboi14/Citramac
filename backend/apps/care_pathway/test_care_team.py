"""Care coordinator and care team (care_team.py): who may set them, what they open,
how the banner shows them, that nothing is deleted, and the banner version poll."""

import uuid

from django.urls import reverse

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.views import caseload_patients
from apps.mhp_program.models import CareTeamMembership
from apps.mhp_program.permissions import has_full_mhp_access
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import platform_admin_context

from .models import CareTask
from .tests import CarePathwayApiTestCase


class CareTeamTestCase(CarePathwayApiTestCase):
    def setUp(self):
        super().setUp()
        self.make_clinical()
        self.doctor = self.staff("Peter", "Kiprono", "Doctor")
        self.supervisor = self.staff("Grace", "Mutua", "Clinical Supervisor")
        self.patient_id = self.register().data["patient_id"]

    def staff(self, first, last, role_name=None):
        with platform_admin_context():
            user = User.objects.create_user(
                email=f"{first.lower()}-{uuid.uuid4().hex[:6]}@org.test",
                password=None,
                organization=self.org,
                is_active=True,
                first_name=first,
                last_name=last,
            )
            if role_name:
                user.roles.add(Role.objects.get(organization=None, name=role_name))
        return user

    def auth_for(self, user):
        return {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(user)[0]}"}

    def url(self):
        return reverse("care-client-care-team", args=[self.patient_id])

    def banner(self):
        return self.client.get(
            reverse("care-client-banner", args=[self.patient_id]), **self.auth
        ).data

    def add(self, user, role="PSYCHIATRIST", auth=None):
        return self.client.post(
            self.url(),
            {"user": str(user.pk), "role": role},
            format="json",
            **(auth or self.auth_for(self.supervisor)),
        )

    def events(self):
        with platform_admin_context():
            return [
                row.field_diff.get("event")
                for row in AuditLogEntry.objects.filter(
                    model="client_registry.patient", object_id=self.patient_id
                ).order_by("timestamp")
                if row.field_diff.get("event")
            ]


class CoordinatorTests(CareTeamTestCase):
    def test_clinical_staff_set_the_coordinator_and_the_banner_and_caseload_follow(self):
        self.assertEqual(self.banner()["clinician"], "Unassigned")
        listed = self.client.get(self.url(), **self.auth)
        self.assertTrue(listed.data["can_set_coordinator"])
        self.assertFalse(listed.data["can_assign_team"])
        self.assertIn(str(self.doctor.pk), [p["id"] for p in listed.data["staff"]])

        response = self.client.put(
            self.url(), {"coordinator": str(self.doctor.pk)}, format="json", **self.auth
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["coordinator"]["name"], "Peter Kiprono")
        banner = self.banner()
        self.assertEqual(
            (banner["clinician"], banner["clinician_role"]), ("Peter Kiprono", "Care coordinator")
        )
        with platform_admin_context():
            self.assertIn(self.patient_id, [str(p.pk) for p in caseload_patients(self.doctor)])
            # The coordinator opens nothing extra.
            self.assertFalse(has_full_mhp_access(self.doctor, self._patient()))
        self.assertEqual(self.events(), ["CARE_COORDINATOR_SET"])

        cleared = self.client.put(self.url(), {"coordinator": None}, format="json", **self.auth)
        self.assertIsNone(cleared.data["coordinator"])
        self.assertEqual(self.banner()["clinician"], "Unassigned")

    def test_only_clinical_staff_and_only_from_the_list(self):
        clerk = self.staff("Front", "Desk")
        refused = self.client.put(
            self.url(), {"coordinator": str(self.doctor.pk)}, format="json", **self.auth_for(clerk)
        )
        self.assertEqual(refused.status_code, 403)
        not_listed = self.client.put(
            self.url(), {"coordinator": str(clerk.pk)}, format="json", **self.auth
        )
        self.assertEqual(not_listed.status_code, 400)
        self.assertIn("coordinator", not_listed.data)

    def _patient(self):
        from apps.client_registry.models import Patient

        return Patient.objects.get(pk=self.patient_id)


class CareTeamMemberTests(CareTeamTestCase):
    def test_assigner_adds_and_ends_a_member_and_access_follows(self):
        from apps.client_registry.models import Patient

        refused = self.add(self.doctor, auth=self.auth)  # a nurse cannot assign the team
        self.assertEqual(refused.status_code, 403)

        added = self.add(self.doctor)
        self.assertEqual(added.status_code, 201, added.data)
        member = added.data["members"][0]
        self.assertEqual((member["name"], member["role_label"]), ("Peter Kiprono", "Psychiatrist"))
        self.assertEqual(member["assigned_by"], "Grace Mutua")
        banner = self.banner()
        self.assertEqual(banner["team"], "Peter Kiprono (Psychiatrist)")
        self.assertEqual(
            banner["care_team"], [{"name": "Peter Kiprono", "role_label": "Psychiatrist"}]
        )
        with platform_admin_context():
            patient = Patient.objects.get(pk=self.patient_id)
            self.assertTrue(has_full_mhp_access(self.doctor, patient))
            self.assertIn(patient, caseload_patients(self.doctor))

        duplicate = self.add(self.doctor)
        self.assertEqual(duplicate.status_code, 400)

        ended = self.client.delete(
            self.url(),
            {"membership": member["id"]},
            format="json",
            **self.auth_for(self.supervisor),
        )
        self.assertEqual(ended.status_code, 200, ended.data)
        self.assertEqual(ended.data["members"], [])
        self.assertEqual(self.banner()["team"], "")
        with platform_admin_context():
            row = CareTeamMembership.objects.get(pk=member["id"])  # kept, not deleted
            self.assertIsNotNone(row.ended_at)
            self.assertEqual(row.ended_by, self.supervisor)
            self.assertFalse(has_full_mhp_access(self.doctor, patient))
            self.assertNotIn(patient, caseload_patients(self.doctor))
        self.assertEqual(self.events(), ["CARE_TEAM_MEMBER_ADDED", "CARE_TEAM_MEMBER_ENDED"])

        # Ended in that role, so the same person can be added again.
        self.assertEqual(self.add(self.doctor).status_code, 201)

    def test_nobody_adds_themselves_and_the_role_must_be_listed(self):
        self_added = self.add(self.supervisor)
        self.assertEqual(self_added.status_code, 403)
        bad_role = self.add(self.doctor, role="ASTROLOGER")
        self.assertEqual(bad_role.status_code, 400)
        self.assertIn("role", bad_role.data)


class BannerSyncTests(CareTeamTestCase):
    def test_banner_counts_open_tasks(self):
        with platform_admin_context():
            open_before = CareTask.objects.filter(
                patient_id=self.patient_id, status__in=("INITIATED", "PENDING")
            ).count()
            CareTask.objects.create(
                organization=self.org,
                patient_id=self.patient_id,
                action_code="call_back",
                action_label="Call back",
                owner="Jane Njoroge",
            )
        self.assertEqual(self.banner()["open_tasks"], open_before + 1)

    def test_version_changes_with_the_banner_and_is_not_a_record_read(self):
        url = reverse("care-client-banner-version", args=[self.patient_id])
        with platform_admin_context():
            reads = AuditLogEntry.objects.filter(
                action=AuditLogEntry.ACTION_VIEW, object_id=self.patient_id
            )
            before = reads.count()
        first = self.client.get(url, **self.auth).data["version"]
        self.assertEqual(self.client.get(url, **self.auth).data["version"], first)
        with platform_admin_context():
            self.assertEqual(reads.count(), before)  # polling writes no VIEW entry

        self.client.put(
            self.url(), {"coordinator": str(self.doctor.pk)}, format="json", **self.auth
        )
        self.assertNotEqual(self.client.get(url, **self.auth).data["version"], first)

        self.banner()
        with platform_admin_context():
            self.assertGreater(reads.count(), before)  # reading the banner still is
