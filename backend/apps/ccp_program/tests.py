from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .models import CareTeamMembership, PsychotherapySession


class CcpCareTeamRestrictionTests(APITestCase):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.14.7 — elevated privacy for CCP records."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org", facility_type="MENTAL_HEALTH_CCP"
            )
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Faith",
                last_name="Mwangi",
                gender="FEMALE",
                date_of_birth="1997-03-14",
            )
            self.assigned_therapist = User.objects.create_user(
                email="therapist@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.other_clinician = User.objects.create_user(
                email="other-clinician@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.org_admin = User.objects.create_user(
                email="orgadmin@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            org_admin_role = Role.objects.get(name="Org Admin", organization__isnull=True)
            self.org_admin.roles.add(org_admin_role)

            CareTeamMembership.objects.create(
                organization=self.org,
                patient=self.patient,
                user=self.assigned_therapist,
                role="THERAPIST",
            )
            self.session = PsychotherapySession.objects.create(
                organization=self.org,
                patient=self.patient,
                session_type="INDIVIDUAL",
                therapist=self.assigned_therapist,
                session_notes="Highly sensitive trauma-processing content.",
            )

        self.access_assigned, _ = issue_tokens(self.assigned_therapist)
        self.access_other, _ = issue_tokens(self.other_clinician)
        self.access_org_admin, _ = issue_tokens(self.org_admin)

    def _auth(self, token):
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def test_assigned_therapist_sees_full_session_notes(self):
        response = self.client.get(
            reverse("psychotherapy-session-detail", args=[self.session.id]),
            **self._auth(self.access_assigned),
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("session_notes", response.data)
        self.assertEqual(
            response.data["session_notes"], "Highly sensitive trauma-processing content."
        )

    def test_unrelated_clinician_sees_existence_only(self):
        response = self.client.get(
            reverse("psychotherapy-session-detail", args=[self.session.id]),
            **self._auth(self.access_other),
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("session_notes", response.data)
        self.assertEqual(
            set(response.data.keys()), {"id", "patient", "session_type", "session_date"}
        )

    def test_org_admin_sees_full_session_notes(self):
        response = self.client.get(
            reverse("psychotherapy-session-detail", args=[self.session.id]),
            **self._auth(self.access_org_admin),
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("session_notes", response.data)

    def test_list_view_also_restricts_per_object(self):
        response = self.client.get(
            reverse("psychotherapy-session-list"), **self._auth(self.access_other)
        )
        self.assertEqual(response.status_code, 200)
        for row in response.data["results"]:
            self.assertNotIn("session_notes", row)
