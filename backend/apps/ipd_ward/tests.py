from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .models import Admission, Bed, MedicationAdministration, NursingNote, Ward


def active_legal_status(patient, user, category="VOLUNTARY"):
    """An Active legal admission status on the client's open episode — what the
    legal-status workflow leaves behind once the admitting officer decides."""
    from apps.care_pathway import legal_config
    from apps.care_pathway.legal_models import LegalStatus
    from apps.care_pathway.services import get_or_open_episode

    with platform_admin_context():
        episode = get_or_open_episode(patient, user)
        return LegalStatus.objects.create(
            organization_id=patient.organization_id, patient=patient, episode=episode,
            config_version=legal_config.version(), category=category,
            statutory_basis=legal_config.statutory_basis(category), created_by=user,
            status="ACTIVE", decision="ADMITTED", decision_by=user, decision_at=timezone.now(),
            effective_from=timezone.now(),
        )


class IpdWardTests(APITestCase):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.7 — ADT + bed status transitions."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org", facility_type="MENTAL_HEALTH_MHP"
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

    def admit(self, **body):
        return self.client.post(
            reverse("ipd-admission-list"),
            {"patient": str(self.patient.id), "bed": str(self.bed_a.id), **body},
            format="json",
            **self.auth,
        )

    def test_admission_marks_bed_occupied(self):
        active_legal_status(self.patient, self.nurse)
        response = self.admit()
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            self.bed_a.refresh_from_db()
        self.assertEqual(self.bed_a.status, "OCCUPIED")

    def test_legacy_discharge_endpoint_is_retired_and_changes_nothing(self):
        # Discharge is a signed record made in Discharge planning
        # (apps.care_pathway); the old free-text endpoint must not bypass it.
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
        self.assertEqual(response.status_code, 400)
        with platform_admin_context():
            self.bed_a.refresh_from_db()
            admission.refresh_from_db()
        self.assertEqual(self.bed_a.status, "OCCUPIED")
        self.assertEqual(admission.status, "ADMITTED")
        self.assertEqual(admission.discharge_summary, "")

    def test_discharge_fields_cannot_be_written_through_patch(self):
        with platform_admin_context():
            admission = Admission.objects.create(
                organization=self.org, patient=self.patient, bed=self.bed_a, admitted_by=self.nurse
            )
        response = self.client.patch(
            reverse("ipd-admission-detail", args=[admission.id]),
            {"discharge_summary": "edited in place", "follow_up_date": "2030-01-01"},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 200, response.data)
        with platform_admin_context():
            admission.refresh_from_db()
        self.assertEqual(admission.discharge_summary, "")
        self.assertIsNone(admission.follow_up_date)

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

    def test_no_admission_without_an_active_legal_status(self):
        """Owner decision 2026-10-22: legal status first — no free-text legal basis."""
        for body in ({}, {"admission_type": "INVOLUNTARY", "legal_status": "Order",
                          "legal_order_reference": "MHA-1", "legal_order_date": "2026-09-01",
                          "authorizing_professional": "Dr. A"}):
            response = self.admit(**body)
            self.assertEqual(response.status_code, 400)
            self.assertIn("legal_status_record", response.data)
        with platform_admin_context():
            self.assertFalse(Admission.objects.exists())

    def test_a_pending_legal_status_does_not_admit(self):
        status = active_legal_status(self.patient, self.nurse, "INVOLUNTARY")
        with platform_admin_context():
            status.status = "PENDING"
            status.save(update_fields=["status"])
        self.assertEqual(self.admit().status_code, 400)

    def test_voluntary_admission_links_the_legal_status_and_its_consent(self):
        status = active_legal_status(self.patient, self.nurse)
        response = self.admit(consent_status="")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["admission_type"], "VOLUNTARY")
        self.assertEqual(response.data["legal_status_record"], status.id)
        self.assertEqual(response.data["consent_status"], "OBTAINED")

    def test_involuntary_admission_takes_its_type_from_the_legal_status(self):
        status = active_legal_status(self.patient, self.nurse, "INVOLUNTARY")
        response = self.admit(legal_order_reference="typed-in", risk_self_harm=True)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["admission_type"], "INVOLUNTARY")
        self.assertEqual(response.data["legal_status_record"], status.id)
        self.assertEqual(response.data["legal_order_reference"], "")  # never a second store
        self.assertTrue(response.data["risk_self_harm"])
        self.assertEqual(self.admit(admission_type="VOLUNTARY", bed=str(self.bed_b.id)).status_code, 400)

    def test_legacy_legal_basis_can_be_updated_but_not_blanked(self):
        with platform_admin_context():
            admission = Admission.objects.create(
                organization=self.org,
                patient=self.patient,
                bed=self.bed_a,
                admitted_by=self.nurse,
                admission_type="INVOLUNTARY",
                legal_status="Order",
                legal_order_reference="MHA-1",
                authorizing_professional="Dr. A",
            )
        url = reverse("ipd-admission-detail", args=[admission.id])
        renewed = self.client.patch(
            url, {"legal_review_due_date": "2026-11-01"}, format="json", **self.auth
        )
        self.assertEqual(renewed.status_code, 200, renewed.data)
        blanked = self.client.patch(url, {"legal_order_reference": ""}, format="json", **self.auth)
        self.assertEqual(blanked.status_code, 400)

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
