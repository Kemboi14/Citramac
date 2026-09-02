from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .models import Admission, Bed, MedicationAdministration, NursingNote, Ward


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

    def test_involuntary_admission_requires_no_extra_fields_but_stores_legal_status(self):
        """Mental Health Act (Cap. 248) legal-status fields round-trip on admission."""
        response = self.client.post(
            reverse("ipd-admission-list"),
            {
                "patient": str(self.patient.id),
                "bed": str(self.bed_a.id),
                "admission_type": "INVOLUNTARY",
                "legal_status": "Involuntary admission order",
                "legal_order_reference": "MHA-2026-014",
                "legal_review_due_date": "2026-09-10",
                "risk_self_harm": True,
                "observation_level": "ENHANCED",
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["admission_type"], "INVOLUNTARY")
        self.assertEqual(response.data["legal_order_reference"], "MHA-2026-014")
        self.assertTrue(response.data["risk_self_harm"])

    def test_admission_list_filters_by_admission_type(self):
        with platform_admin_context():
            Admission.objects.create(
                organization=self.org,
                patient=self.patient,
                bed=self.bed_a,
                admitted_by=self.nurse,
                admission_type="VOLUNTARY",
            )
            Admission.objects.create(
                organization=self.org,
                patient=self.patient,
                bed=self.bed_b,
                admitted_by=self.nurse,
                admission_type="INVOLUNTARY",
            )
        response = self.client.get(
            reverse("ipd-admission-list") + "?admission_type=INVOLUNTARY", **self.auth
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["admission_type"], "INVOLUNTARY")

    def test_eligible_patients_excludes_already_admitted(self):
        with platform_admin_context():
            self.patient.patient_category = "INPATIENT"
            self.patient.save(update_fields=["patient_category"])
        response = self.client.get(reverse("ipd-admission-eligible-patients"), **self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

        with platform_admin_context():
            Admission.objects.create(
                organization=self.org,
                patient=self.patient,
                bed=self.bed_a,
                admitted_by=self.nurse,
                status="ADMITTED",
            )
        response = self.client.get(reverse("ipd-admission-eligible-patients"), **self.auth)
        self.assertEqual(response.data, [])

    def test_fhir_action_returns_encounter_and_consent_for_voluntary_admission(self):
        with platform_admin_context():
            admission = Admission.objects.create(
                organization=self.org,
                patient=self.patient,
                bed=self.bed_a,
                admitted_by=self.nurse,
                admission_type="VOLUNTARY",
                consent_status="OBTAINED",
            )
        response = self.client.get(reverse("ipd-admission-fhir", args=[admission.id]), **self.auth)
        self.assertEqual(response.status_code, 200, response.data)
        resource_types = [entry["resource"]["resourceType"] for entry in response.data["entry"]]
        self.assertEqual(resource_types, ["Patient", "Encounter", "Consent"])

    def test_fhir_action_returns_risk_assessment_for_involuntary_admission(self):
        with platform_admin_context():
            admission = Admission.objects.create(
                organization=self.org,
                patient=self.patient,
                bed=self.bed_a,
                admitted_by=self.nurse,
                admission_type="INVOLUNTARY",
                risk_self_harm=True,
            )
        response = self.client.get(reverse("ipd-admission-fhir", args=[admission.id]), **self.auth)
        self.assertEqual(response.status_code, 200, response.data)
        resource_types = [entry["resource"]["resourceType"] for entry in response.data["entry"]]
        self.assertEqual(resource_types, ["Patient", "Encounter", "RiskAssessment"])

    def test_mar_and_nursing_notes_filter_by_admission(self):
        with platform_admin_context():
            admission_a = Admission.objects.create(
                organization=self.org, patient=self.patient, bed=self.bed_a, admitted_by=self.nurse
            )
            admission_b = Admission.objects.create(
                organization=self.org, patient=self.patient, bed=self.bed_b, admitted_by=self.nurse
            )
            MedicationAdministration.objects.create(
                organization=self.org,
                admission=admission_a,
                scheduled_time=timezone.now(),
            )
            MedicationAdministration.objects.create(
                organization=self.org,
                admission=admission_b,
                scheduled_time=timezone.now(),
            )
            NursingNote.objects.create(
                organization=self.org, admission=admission_a, shift="DAY", note="Settled overnight."
            )

        mar_response = self.client.get(
            reverse("ipd-mar-list") + f"?admission={admission_a.id}", **self.auth
        )
        self.assertEqual(mar_response.status_code, 200)
        self.assertEqual(mar_response.data["count"], 1)

        notes_response = self.client.get(
            reverse("ipd-nursing-note-list") + f"?admission={admission_a.id}", **self.auth
        )
        self.assertEqual(notes_response.status_code, 200)
        self.assertEqual(notes_response.data["count"], 1)
