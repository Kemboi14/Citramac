from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.tokens import issue_tokens
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .models import Patient


class ClientRegistryTests(APITestCase):
    """docs/10-API-SPECIFICATION.md §10.4, docs/07-CLINICAL-MODULES-SPEC.md §7.1."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org_a = Organization.objects.create(
                name="Org A", slug="orga", facility_type="MENTAL_HEALTH_CCP"
            )
            self.org_b = Organization.objects.create(
                name="Org B", slug="orgb", facility_type="MENTAL_HEALTH_CCP"
            )
            self.clinician_a = User.objects.create_user(
                email="clinician-a@orga.test",
                password="Password123!",
                organization=self.org_a,
                is_active=True,
            )
            self.clinician_b = User.objects.create_user(
                email="clinician-b@orgb.test",
                password="Password123!",
                organization=self.org_b,
                is_active=True,
            )
        self.access_a, _ = issue_tokens(self.clinician_a)
        self.access_b, _ = issue_tokens(self.clinician_b)

    def _auth(self, token):
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def test_create_patient_auto_scopes_org_and_generates_citramac_number(self):
        response = self.client.post(
            reverse("patient-list"),
            {
                "first_name": "Faith",
                "last_name": "Mwangi",
                "gender": "FEMALE",
                "date_of_birth": "1997-03-14",
                "uhid_number": "20260245",
            },
            format="json",
            **self._auth(self.access_a),
        )
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            patient = Patient.objects.get(pk=response.data["id"])
        self.assertEqual(patient.organization_id, self.org_a.id)
        self.assertTrue(patient.citramac_number)
        self.assertEqual(patient.registered_by_id, self.clinician_a.id)

    def test_patient_list_is_tenant_isolated(self):
        self.client.post(
            reverse("patient-list"),
            {
                "first_name": "A",
                "last_name": "Patient",
                "gender": "MALE",
                "date_of_birth": "1990-01-01",
            },
            format="json",
            **self._auth(self.access_a),
        )
        self.client.post(
            reverse("patient-list"),
            {
                "first_name": "B",
                "last_name": "Patient",
                "gender": "MALE",
                "date_of_birth": "1990-01-01",
            },
            format="json",
            **self._auth(self.access_b),
        )

        response_a = self.client.get(reverse("patient-list"), **self._auth(self.access_a))
        names_a = {p["first_name"] for p in response_a.data["results"]}
        self.assertEqual(names_a, {"A"})

        response_b = self.client.get(reverse("patient-list"), **self._auth(self.access_b))
        names_b = {p["first_name"] for p in response_b.data["results"]}
        self.assertEqual(names_b, {"B"})

    def test_org_a_cannot_read_org_b_patient_by_id(self):
        create_response = self.client.post(
            reverse("patient-list"),
            {
                "first_name": "Secret",
                "last_name": "Patient",
                "gender": "MALE",
                "date_of_birth": "1990-01-01",
            },
            format="json",
            **self._auth(self.access_b),
        )
        patient_id = create_response.data["id"]

        response = self.client.get(
            reverse("patient-detail", args=[patient_id]), **self._auth(self.access_a)
        )
        self.assertEqual(response.status_code, 404)

    def test_verify_iprs_and_verify_sha_are_honest_stubs(self):
        create_response = self.client.post(
            reverse("patient-list"),
            {
                "first_name": "Test",
                "last_name": "Patient",
                "gender": "MALE",
                "date_of_birth": "1990-01-01",
            },
            format="json",
            **self._auth(self.access_a),
        )
        patient_id = create_response.data["id"]

        iprs_response = self.client.post(
            reverse("patient-verify-iprs", args=[patient_id]), **self._auth(self.access_a)
        )
        self.assertEqual(iprs_response.status_code, 200)
        self.assertFalse(iprs_response.data["verified"])
