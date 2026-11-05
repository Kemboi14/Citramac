"""Signed triage assessment in the shared professional document layout."""

from django.urls import reverse

from apps.tenancy.context import platform_admin_context

from .models import TriageAssessment
from .test_intake import IntakeTestCase


class TriagePrintTests(IntakeTestCase):
    def test_signed_triage_prints_with_wording_and_downloads(self):
        self.sign_triage()
        with platform_admin_context():
            assessment = TriageAssessment.objects.get(
                triage_encounter_id=self.te_id, status="COMPLETED"
            )
        url = reverse("care-assessment-print", args=[assessment.id])
        preview = self.client.get(url, **self.auth)
        self.assertEqual(preview.status_code, 200)
        html = preview.content.decode()
        self.assertIn("Triage assessment", html)
        self.assertIn("ORANGE — Urgent", html)  # priority in words, not colour
        # Answers print as questions, not raw keys.
        self.assertIn("Currently having thoughts of killing or seriously harming yourself?", html)
        self.assertNotIn("d_suicidal", html)
        pdf = self.client.get(url + "?output=pdf", **self.auth)
        self.assertEqual(pdf["Content-Type"], "application/pdf")
        self.assertTrue(pdf.content.startswith(b"%PDF-"))
