"""The full client report: who may open it, that it covers every triage and
intake, and that confidential content follows the same rules as its own screen."""

import uuid

from django.urls import reverse

from apps.accounts.models import User
from apps.mhp_program.models import PsychotherapySession
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import platform_admin_context

from .models import TriageEncounter
from .tests import CarePathwayApiTestCase

THERAPY_TEXT = "Disclosed a family secret in session"


class ClientReportTests(CarePathwayApiTestCase):
    def setUp(self):
        super().setUp()
        self.pid = self.register().data["patient_id"]

    def report(self, **query):
        return self.client.get(reverse("care-client-report", args=[self.pid]), query, **self.auth)

    def test_front_desk_cannot_open_it(self):
        self.assertEqual(self.report().status_code, 403)

    def test_every_triage_is_listed_first_to_latest(self):
        self.make_clinical()
        self.register(patient_id=self.pid)
        response = self.report()
        self.assertEqual(response.status_code, 200, response.data)
        with platform_admin_context():
            arrivals = list(
                TriageEncounter.objects.filter(patient_id=self.pid)
                .order_by("arrival_at")
                .values_list("id", flat=True)
            )
        self.assertEqual([t["id"] for t in response.data["triages"]], [str(a) for a in arrivals])
        self.assertEqual(len(arrivals), 2)
        for key in (
            "intakes",
            "interventions",
            "outcomes",
            "admissions",
            "group_sessions",
            "billing",
            "activity",
        ):
            self.assertIn(key, response.data)

    def test_opening_it_is_audited(self):
        self.make_clinical()
        self.report()
        with platform_admin_context():
            entries = AuditLogEntry.objects.filter(
                object_id=str(self.pid), action=AuditLogEntry.ACTION_VIEW
            )
            self.assertTrue(
                any((e.field_diff or {}).get("report") == "full client report" for e in entries)
            )

    def test_psychotherapy_content_only_for_the_care_team(self):
        self.make_clinical()
        with platform_admin_context():
            therapist = User.objects.create_user(
                email=f"therapist-{uuid.uuid4().hex[:6]}@org.test",
                password="Password123!",  # pragma: allowlist secret
                organization=self.org,
                is_active=True,
            )
            PsychotherapySession.objects.create(
                organization=self.org,
                patient_id=self.pid,
                session_type="INDIVIDUAL",
                therapist=therapist,
                session_notes=THERAPY_TEXT,
                extra={"process_notes": THERAPY_TEXT},
            )
        response = self.report()
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(THERAPY_TEXT, str(response.data))
        sessions = [g for g in response.data["interventions"] if g["id"] == "psychotherapy"]
        self.assertEqual(len(sessions), 1)
        self.assertTrue(sessions[0]["records"][0]["restricted"])

    def test_print_preview_renders(self):
        self.make_clinical()
        response = self.client.get(
            reverse("care-client-report-print", args=[self.pid]), **self.auth
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Triage (1)", response.content)

    def test_one_record_prints_on_its_own(self):
        self.make_clinical()
        report = self.report().data
        url = reverse("care-client-report-print", args=[self.pid])
        triage = report["triages"][0]
        self.assertTrue(triage["answers"] is not None)
        missing = self.client.get(url, {"part": "intake", "item": "nope"}, **self.auth)
        self.assertEqual(missing.status_code, 404)
        unknown = self.client.get(url, {"part": "everything", "item": "x"}, **self.auth)
        self.assertEqual(unknown.status_code, 404)
