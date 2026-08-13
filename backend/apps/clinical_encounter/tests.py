from unittest.mock import patch

from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.dha_interop.models import IcdCodeIndex
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .models import SoapNote


class ClinicalEncounterAndTriageTests(APITestCase):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.2-7.3, docs/10-API-SPECIFICATION.md §10.5."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org", facility_type="MENTAL_HEALTH_CCP"
            )
            self.clinician = User.objects.create_user(
                email="doc@org.test", password="Password123!", organization=self.org, is_active=True
            )
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Faith",
                last_name="Mwangi",
                gender="FEMALE",
                date_of_birth="1997-03-14",
            )
        self.access, _ = issue_tokens(self.clinician)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.access}"}

    def _open_encounter(self):
        response = self.client.post(
            reverse("encounter-list"),
            {"patient": str(self.patient.id), "encounter_type": "OUTPATIENT"},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data["id"]

    def test_vitals_computes_bmi_and_bsa(self):
        encounter_id = self._open_encounter()
        response = self.client.post(
            reverse("encounter-vitals", args=[encounter_id]),
            {"height_cm": "170.0", "weight_kg": "65.0", "esi_acuity_level": 3},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertAlmostEqual(float(response.data["bmi"]), 22.5, places=1)
        self.assertGreater(float(response.data["bsa"]), 1.7)

    @patch("apps.notifications.tasks.notify_supervisors_of_risk.delay")
    def test_mse_positive_risk_escalates_to_supervisor(self, mock_notify):
        encounter_id = self._open_encounter()
        response = self.client.post(
            reverse("encounter-mse", args=[encounter_id]),
            {
                "appearance": "Disheveled",
                "risk_assessment": {
                    "suicidal_ideation": True,
                    "homicidal_ideation": False,
                    "notes": "...",
                },
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data["risk_escalated_to_supervisor"])
        mock_notify.assert_called_once()

    @patch("apps.notifications.tasks.notify_supervisors_of_risk.delay")
    def test_mse_negative_risk_does_not_escalate(self, mock_notify):
        encounter_id = self._open_encounter()
        response = self.client.post(
            reverse("encounter-mse", args=[encounter_id]),
            {
                "appearance": "Well-groomed",
                "risk_assessment": {"suicidal_ideation": False, "homicidal_ideation": False},
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(response.data["risk_escalated_to_supervisor"])
        mock_notify.assert_not_called()

    def test_soap_note_locks_after_signing(self):
        encounter_id = self._open_encounter()
        create_response = self.client.post(
            reverse("encounter-soap-notes", args=[encounter_id]),
            {"subjective": "Patient reports...", "plan": "Continue therapy"},
            format="json",
            **self.auth,
        )
        note_id = create_response.data["id"]

        sign_response = self.client.post(
            reverse("encounter-sign-soap-note", args=[encounter_id, note_id]), **self.auth
        )
        self.assertEqual(sign_response.status_code, 200, sign_response.data)
        self.assertTrue(sign_response.data["is_locked"])

        with platform_admin_context():
            note = SoapNote.all_objects.get(pk=note_id)
            with self.assertRaises(PermissionError):
                note.subjective = "edited after signing"
                note.save()

    def test_diagnosis_requires_valid_icd11_fk(self):
        encounter_id = self._open_encounter()
        with platform_admin_context():
            code = IcdCodeIndex.objects.get(code="6A70")
        response = self.client.post(
            reverse("encounter-diagnoses", args=[encounter_id]),
            {"icd11_code": code.code, "is_primary": True},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)

        bad_response = self.client.post(
            reverse("encounter-diagnoses", args=[encounter_id]),
            {"icd11_code": "NOT-A-REAL-CODE", "is_primary": False},
            format="json",
            **self.auth,
        )
        self.assertEqual(bad_response.status_code, 400)

    def test_encounter_is_tenant_isolated(self):
        with platform_admin_context():
            other_org = Organization.objects.create(
                name="Other", slug="other", facility_type="CLINIC"
            )
            other_clinician = User.objects.create_user(
                email="other@other.test",
                password="Password123!",
                organization=other_org,
                is_active=True,
            )
        other_access, _ = issue_tokens(other_clinician)

        encounter_id = self._open_encounter()
        response = self.client.get(
            reverse("encounter-detail", args=[encounter_id]),
            HTTP_AUTHORIZATION=f"Bearer {other_access}",
        )
        self.assertEqual(response.status_code, 404)

    def test_referral_builds_a_real_fhir_bundle_with_patient_and_condition(self):
        """docs/08-DHA-SHA-INTEGRATION.md §8.1 — real, schema-validated FHIR Bundle."""
        encounter_id = self._open_encounter()
        with platform_admin_context():
            code = IcdCodeIndex.objects.get(code="6A70")
        self.client.post(
            reverse("encounter-diagnoses", args=[encounter_id]),
            {"icd11_code": code.code, "is_primary": True},
            format="json",
            **self.auth,
        )

        response = self.client.post(
            reverse("encounter-referrals", args=[encounter_id]),
            {"destination_facility": "Kenyatta National Hospital"},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        bundle = response.data["fhir_bundle_json"]
        self.assertEqual(bundle["resourceType"], "Bundle")
        resource_types = {entry["resource"]["resourceType"] for entry in bundle["entry"]}
        self.assertEqual(resource_types, {"Composition", "Patient", "Condition"})

    def test_send_referral_reports_honest_failure_with_no_hie_endpoint_configured(self):
        """
        HIE_ENDPOINT_URL is unset in tests (matches the default dev/prod
        posture — no real facility mTLS certificate exists) — the send
        action must report this honestly, not fabricate a SENT status.
        """
        encounter_id = self._open_encounter()
        create_response = self.client.post(
            reverse("encounter-referrals", args=[encounter_id]),
            {"destination_facility": "Kenyatta National Hospital"},
            format="json",
            **self.auth,
        )
        referral_id = create_response.data["id"]

        send_response = self.client.post(
            reverse("encounter-send-referral", args=[encounter_id, referral_id]), **self.auth
        )
        self.assertEqual(send_response.status_code, 200, send_response.data)
        self.assertEqual(send_response.data["transmission_status"], "FAILED")
        self.assertEqual(send_response.data["referral"]["status"], "DRAFT")
