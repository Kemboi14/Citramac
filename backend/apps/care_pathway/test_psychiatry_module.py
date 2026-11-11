"""Psychiatry module: caseload, assessment draft/sign, MSE mirror."""

from django.urls import reverse

from apps.accounts.models import Role
from apps.client_registry.models import Patient
from apps.tenancy.context import platform_admin_context
from apps.triage.models import MentalStatusExam

from .models import ProgressNote
from .tests import CORE_NO, CarePathwayApiTestCase


class PsychiatryModuleTests(CarePathwayApiTestCase):
    def setUp(self):
        super().setUp()
        with platform_admin_context():
            role, _ = Role.objects.get_or_create(
                organization=None, name="Nurse", defaults={"scope": Role.SCOPE_ORG_TEMPLATE}
            )
            self.nurse.roles.add(role)
        registered = self.register(allergy_status="NONE")
        self.pid = registered.data["patient_id"]
        self.te_id = registered.data["triage_encounter_id"]
        signed = self.sign(self.te_id, CORE_NO, priority="ORANGE")
        self.assertEqual(signed.status_code, 201, signed.data)

        self.open_url = reverse("care-psych-workspace", args=[self.pid])
        self.body = {
            "format": "STRUCTURED",
            "structured": {
                "presenting_concern": "Low mood and poor sleep for two months.",
                "history": "No previous psychiatric admission.",
                "risk": "No current suicidal ideation; protective family support.",
                "formulation": "Likely moderate depressive episode.",
                "plan": "Start psychological treatment; review medication.",
            },
            "free_text": "",
            "mse": {
                "mood": "Low",
                "affect": "Restricted",
                "summary": "Low mood, no psychotic features.",
            },
        }

    def test_client_list_includes_signed_triage_and_marks_review_needed(self):
        response = self.client.get(reverse("care-psych-module-clients"), **self.auth)
        self.assertEqual(response.status_code, 200, response.data)
        row = next(r for r in response.data["results"] if r["patient_id"] == self.pid)
        self.assertTrue(row["suggested"])
        self.assertEqual(row["assessment_status"], "")
        self.assertIn("psychiatric review", row["suggested_reason"].lower())

    def test_structured_assessment_is_saved_to_progress_note_and_mse_store(self):
        opened = self.client.post(self.open_url, format="json", **self.auth)
        self.assertEqual(opened.status_code, 200, opened.data)
        encounter_id = opened.data["encounter_id"]

        saved = self.client.put(self.open_url, self.body, format="json", **self.auth)
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual(saved.data["assessment"]["format"], "STRUCTURED")
        self.assertIn("Presenting concern", saved.data["assessment"]["text"])
        self.assertIn("Mood (subjective — client’s words): Low", saved.data["assessment"]["text"])

        with platform_admin_context():
            patient = Patient.objects.get(pk=self.pid)
            note = ProgressNote.objects.get(patient=patient, note_type="PSYCHIATRY")
            self.assertEqual(note.status, "DRAFT")
            self.assertEqual(
                note.data["structured"]["formulation"], self.body["structured"]["formulation"]
            )
            exam = MentalStatusExam.objects.get(encounter_id=encounter_id)
            self.assertEqual(exam.mood, "Low")
            self.assertEqual(exam.summary, "Low mood, no psychotic features.")

        signed = self.client.post(
            reverse("care-psych-sign", args=[self.pid]), self.body, format="json", **self.auth
        )
        self.assertEqual(signed.status_code, 200, signed.data)
        self.assertEqual(signed.data["assessment"]["status"], "SIGNED")
        self.assertIsNotNone(signed.data["assessment"]["signed_at"])

        listed = self.client.get(reverse("care-psych-module-clients"), **self.auth)
        row = next(r for r in listed.data["results"] if r["patient_id"] == self.pid)
        self.assertEqual(row["assessment_status"], "SIGNED")
        self.assertFalse(row["suggested"])

    def test_structured_risk_rows_are_saved_and_signable(self):
        body = dict(self.body)
        body["structured"] = {
            "presenting_concern": "Low mood and poor sleep.",
            "history": "No previous psychiatric admission.",
            "risk": {
                "rows": {"suicide": ["Thoughts", "Access to means"]},
                "other": "Escalating distress at night.",
                "details": "Family contacted; urgent review arranged.",
                "actions": ["SAFETY_PLAN_TRIGGERED"],
                "static": "Historical self-harm attempt.",
                "dynamic": "Current hopelessness and poor concentration.",
                "protective": "Family support and engagement.",
                "change_72h": "Could worsen if support fades.",
                "summary": "Moderate risk with protective supports.",
                "plan": "Daily review and safety plan.",
                "review_by": "2026-11-12",
                "formulation_signed_at": "sign",
            },
            "formulation": "Likely depressive episode.",
        }
        saved = self.client.put(self.open_url, body, format="json", **self.auth)
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertIn("Suicide / self-harm", saved.data["assessment"]["text"])
        self.assertIn("Immediate actions already taken", saved.data["assessment"]["text"])
        self.assertIn("Safety plan triggered", saved.data["assessment"]["text"])
        with platform_admin_context():
            note = ProgressNote.objects.get(patient_id=self.pid, note_type="PSYCHIATRY")
            self.assertEqual(note.data["structured"]["risk"]["rows"]["suicide"][0], "Thoughts")
            self.assertEqual(note.data["structured"]["risk"]["actions"], ["SAFETY_PLAN_TRIGGERED"])
            self.assertEqual(note.data["structured"]["risk"]["review_by"], "2026-11-12")
            self.assertNotEqual(note.data["structured"]["risk"]["formulation_signed_at"], "sign")
            self.assertEqual(
                note.data["structured"]["risk"]["formulation_signed_by"],
                self.nurse.get_full_name() or self.nurse.username,
            )
            self.assertEqual(str(note.patient_id), self.pid)
            self.assertEqual(str(note.encounter_id), saved.data["encounter_id"])
            self.assertEqual(str(note.episode_id), saved.data["episode_id"])
            exam = MentalStatusExam.objects.get(pk=note.data["mse_exam_id"])
            self.assertEqual(exam.encounter_id, note.encounter_id)
            self.assertEqual(exam.encounter.patient_id, note.patient_id)

        tools = self.client.get(reverse("care-client-tools", args=[self.pid]), **self.auth)
        self.assertEqual(tools.status_code, 200, tools.data)
        sra = next(row for row in tools.data["results"] if row["key"] == "SRA")
        self.assertTrue(any("Suicide / self-harm finding" in why for why in sra["why"]))

        signed = self.client.post(
            reverse("care-psych-sign", args=[self.pid]), body, format="json", **self.auth
        )
        self.assertEqual(signed.status_code, 200, signed.data)
        self.assertEqual(signed.data["assessment"]["status"], "SIGNED")

    def test_free_text_assessment_is_rendered_and_can_be_signed(self):
        body = {
            "format": "FREE_TEXT",
            "structured": {},
            "free_text": "Seen today. Low mood, no psychosis, no suicidal ideation. Plan: CBT.",
            "mse": {"mood": "Low"},
        }
        saved = self.client.put(self.open_url, body, format="json", **self.auth)
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertIn("Seen today.", saved.data["assessment"]["text"])
        self.assertIn("Mental state examination", saved.data["assessment"]["text"])

        signed = self.client.post(self.open_url + "sign/", body, format="json", **self.auth)
        self.assertEqual(signed.status_code, 200, signed.data)
        self.assertEqual(signed.data["assessment"]["status"], "SIGNED")

    def test_opening_the_workspace_audits_a_view_on_the_client(self):
        from apps.sysadmin_audit.models import AuditLogEntry

        response = self.client.post(self.open_url, format="json", **self.auth)
        self.assertEqual(response.status_code, 200, response.data)
        with platform_admin_context():
            entry = AuditLogEntry.objects.filter(
                action=AuditLogEntry.ACTION_VIEW,
                model="client_registry.patient",
                object_id=self.pid,
            ).get()
            self.assertEqual(str(entry.actor_user_id), str(self.nurse.id))

    def test_a_follow_up_assessment_creates_a_new_mse_and_leaves_the_signed_one(self):
        from .models import ProgressNote as PN

        saved = self.client.put(self.open_url, self.body, format="json", **self.auth)
        self.assertEqual(saved.status_code, 200, saved.data)
        signed = self.client.post(
            reverse("care-psych-sign", args=[self.pid]), self.body, format="json", **self.auth
        )
        self.assertEqual(signed.status_code, 200, signed.data)

        with platform_admin_context():
            patient = Patient.objects.get(pk=self.pid)
            first_note = PN.objects.get(patient=patient, note_type="PSYCHIATRY", status="SIGNED")
            first_exam_id = first_note.data["mse_exam_id"]
            encounter_id = saved.data["encounter_id"]

        follow_up = dict(self.body)
        follow_up["mse"] = {"mood": "Euthymic", "summary": "Mood improved."}
        saved2 = self.client.put(self.open_url, follow_up, format="json", **self.auth)
        self.assertEqual(saved2.status_code, 200, saved2.data)

        with platform_admin_context():
            patient = Patient.objects.get(pk=self.pid)
            notes = PN.objects.filter(patient=patient, note_type="PSYCHIATRY").order_by(
                "created_at"
            )
            self.assertEqual(notes.count(), 2)
            first_note.refresh_from_db()
            self.assertEqual(first_note.data["mse_exam_id"], first_exam_id)
            exams = MentalStatusExam.objects.filter(encounter_id=encounter_id).order_by(
                "recorded_at"
            )
            self.assertEqual(exams.count(), 2)
            first_exam = MentalStatusExam.objects.get(pk=first_exam_id)
            self.assertEqual(first_exam.mood, "Low")
            self.assertEqual(exams.last().mood, "Euthymic")

    def test_only_the_chosen_formats_content_is_kept(self):
        body = dict(self.body, free_text="Narrative typed before switching to structured.")
        saved = self.client.put(self.open_url, body, format="json", **self.auth)
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual(saved.data["assessment"]["free_text"], "")
        self.assertNotIn("Narrative typed", saved.data["assessment"]["text"])

        free = {
            "format": "FREE_TEXT",
            "structured": self.body["structured"],
            "free_text": "Seen today. Low mood. No suicidal ideation. Plan: CBT.",
            "mse": {},
        }
        saved = self.client.put(self.open_url, free, format="json", **self.auth)
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual(saved.data["assessment"]["structured"], {})
        with platform_admin_context():
            note = ProgressNote.objects.get(patient_id=self.pid, note_type="PSYCHIATRY")
            self.assertEqual(note.data["structured"], {})
            self.assertNotIn("Presenting concern", note.text)

    def test_free_text_mse_is_saved_as_a_single_narrative(self):
        body = dict(self.body)
        body["mse"] = {"free_text": "Low mood, guarded, no psychosis; no SI or HI."}
        saved = self.client.put(self.open_url, body, format="json", **self.auth)
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual(saved.data["mse"]["free_text"], body["mse"]["free_text"])
        self.assertIn("Low mood", saved.data["assessment"]["text"])
        with platform_admin_context():
            note = ProgressNote.objects.get(patient_id=self.pid, note_type="PSYCHIATRY")
            exam = MentalStatusExam.objects.get(pk=note.data["mse_exam_id"])
            self.assertEqual(exam.summary, body["mse"]["free_text"])

    def test_structured_assessment_needs_risk_to_sign(self):
        body = dict(self.body)
        body["structured"] = dict(self.body["structured"], risk="")
        signed = self.client.post(
            reverse("care-psych-sign", args=[self.pid]), body, format="json", **self.auth
        )
        self.assertEqual(signed.status_code, 400, signed.data)
        self.assertIn("Record Risk", str(signed.data))
        with platform_admin_context():
            self.assertFalse(
                ProgressNote.objects.filter(
                    patient_id=self.pid, note_type="PSYCHIATRY", status="SIGNED"
                ).exists()
            )

    def test_an_mse_alone_is_not_a_signable_assessment(self):
        body = {"format": "FREE_TEXT", "structured": {}, "free_text": " ", "mse": {"mood": "Low"}}
        signed = self.client.post(
            reverse("care-psych-sign", args=[self.pid]), body, format="json", **self.auth
        )
        self.assertEqual(signed.status_code, 400, signed.data)
        self.assertIn("assessment narrative", str(signed.data))
