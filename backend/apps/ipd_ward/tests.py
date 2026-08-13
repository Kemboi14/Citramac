from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .models import Admission, Bed, Ward


class IpdWardTests(APITestCase):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.7 — ADT + bed status transitions."""

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
            self.nurse = User.objects.create_user(
                email="nurse@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.ward = Ward.objects.create(organization=self.org, name="Stabilization Ward")
            self.bed_a = Bed.objects.create(organization=self.org, ward=self.ward, bed_number="A1")
            self.bed_b = Bed.objects.create(organization=self.org, ward=self.ward, bed_number="A2")
        self.access, _ = issue_tokens(self.nurse)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.access}"}

    def test_admission_marks_bed_occupied(self):
        response = self.client.post(
            reverse("ipd-admission-list"),
            {"patient": str(self.patient.id), "bed": str(self.bed_a.id)},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            self.bed_a.refresh_from_db()
        self.assertEqual(self.bed_a.status, "OCCUPIED")

    def test_discharge_frees_the_bed(self):
        with platform_admin_context():
            self.bed_a.status = "OCCUPIED"
            self.bed_a.save(update_fields=["status"])
            admission = Admission.objects.create(
                organization=self.org, patient=self.patient, bed=self.bed_a, admitted_by=self.nurse
            )
        response = self.client.post(
            reverse("ipd-admission-discharge", args=[admission.id]),
            {"discharge_summary": "Stable, discharged to outpatient follow-up."},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "DISCHARGED")
        with platform_admin_context():
            self.bed_a.refresh_from_db()
        self.assertEqual(self.bed_a.status, "AVAILABLE")

    def test_transfer_moves_occupancy_between_beds(self):
        with platform_admin_context():
            self.bed_a.status = "OCCUPIED"
            self.bed_a.save(update_fields=["status"])
            admission = Admission.objects.create(
                organization=self.org, patient=self.patient, bed=self.bed_a, admitted_by=self.nurse
            )
        response = self.client.post(
            reverse("ipd-admission-transfer", args=[admission.id]),
            {"bed": str(self.bed_b.id)},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 200, response.data)
        with platform_admin_context():
            self.bed_a.refresh_from_db()
            self.bed_b.refresh_from_db()
        self.assertEqual(self.bed_a.status, "AVAILABLE")
        self.assertEqual(self.bed_b.status, "OCCUPIED")

    def test_ward_list_endpoint_returns_this_orgs_wards(self):
        """
        Regression test: WardViewSet must use get_queryset(), not a class-level
        `queryset = Ward.objects.all()` — the latter binds the tenant-scoped
        manager's filter at import time (no request context yet), so it would
        return zero rows for every org, forever.
        """
        response = self.client.get(reverse("ipd-ward-list"), **self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], str(self.ward.id))
