"""Medical review summary: what the record already holds for a medical review,
read-only (care/clients/<id>/medical-review/summary/)."""

import uuid

from django.urls import reverse

from apps.accounts.models import User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import AllergyRecord, Patient
from apps.tenancy.context import platform_admin_context

from .models import MedicationHistoryEntry
from .test_intake import IntakeTestCase

VITALS = {
    "v_sbp": "128",
    "v_dbp": "82",
    "v_hr": "88",
    "v_measured_at": "2026-11-13T08:15",
    "v_source": "here",
}


class MedicalReviewSummaryTests(IntakeTestCase):
    def summary(self, auth=None):
        return self.client.get(
            reverse("care-medical-review-summary", args=[self.pid]), **(auth or self.auth)
        )

    def test_before_intake_it_shows_triage_vitals_and_says_no_signed_intake(self):
        self.sign_triage(**VITALS)
        response = self.summary()
        self.assertEqual(response.status_code, 200, response.data)
        vitals = response.data["vitals"]
        self.assertEqual((vitals["systolic_bp"], vitals["heart_rate"]), (128, 88))
        self.assertIn("score", vitals["ews"])
        self.assertEqual(response.data["intake"], {"signed_at": None, "history": []})
        self.assertEqual(response.data["medicines"], [])

    def test_no_vitals_is_shown_as_none_not_an_empty_set(self):
        response = self.summary()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.data["vitals"])

    def test_signed_intake_history_allergies_and_reported_medicines(self):
        self.draft()
        self.complete_required()  # records Sertraline in the medication history
        self.save(
            sections={
                "pres": {"own": "Low mood for two months"},
                "mse": {"mood": "Low", "thought_content": "No abnormality"},
                "medical": {"history": "Appendicectomy 2015"},
            }
        )
        signed = self.sign_intake()
        self.assertEqual(signed.status_code, 200, signed.data)
        with platform_admin_context():
            patient = Patient.objects.get(pk=self.pid)
            AllergyRecord.objects.create(
                organization=self.org, patient=patient, substance="Penicillin", reaction="Rash"
            )
            MedicationHistoryEntry.objects.create(
                organization=self.org,
                patient=patient,
                name="Old medicine",
                superseded_at=patient.registered_at,
            )

        data = self.summary().data
        self.assertIsNotNone(data["intake"]["signed_at"])
        self.assertIn(
            {
                "label": "Medical conditions, surgeries, hospitalisations",
                "value": "Appendicectomy 2015",
            },
            data["intake"]["history"],
        )
        self.assertEqual([a["substance"] for a in data["allergies"]], ["Penicillin"])
        # Current entries only: a superseded medication-history row is not shown.
        self.assertEqual([m["name"] for m in data["reported_medicines"]], ["Sertraline"])

    def test_only_clinical_staff_may_read_it(self):
        with platform_admin_context():
            clerk = User.objects.create_user(
                email=f"clerk-{uuid.uuid4().hex[:6]}@org.test",
                password="Password123!",  # pragma: allowlist secret
                organization=self.org,
                is_active=True,
            )
        clerk_auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(clerk)[0]}"}
        self.assertEqual(self.summary(clerk_auth).status_code, 403)
