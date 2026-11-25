"""Psychiatry module: caseload, assessment draft/sign, MSE mirror."""

import uuid
from datetime import timedelta

from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import Role
from apps.client_registry.models import Appointment, Patient
from apps.tenancy.context import platform_admin_context
from apps.triage.models import MentalStatusExam

from .models import (
    CarePlan,
    CarePlanActivity,
    CarePlanVersion,
    CareTask,
    IntakeAssessment,
    ProgressNote,
    TriageEncounter,
)
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
        self.schedule_url = reverse("care-psych-schedule", args=[self.pid])
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

    def create_schedule_plan(self, activity_status="PLANNED", confirmed=True):
        with platform_admin_context():
            triage = TriageEncounter.objects.get(pk=self.te_id)
            plan = CarePlan.objects.create(
                organization=self.org,
                patient=triage.patient,
                episode=triage.episode,
                goals="Continue psychiatric review.",
            )
            activity = CarePlanActivity.objects.create(
                organization=self.org,
                care_plan=plan,
                title="Psychiatric review",
                goal="Review progress",
                module="PSYCHIATRY",
                action_key="psych_review",
                decision="ACCEPTED",
                status=activity_status,
            )
            if confirmed:
                CarePlanVersion.objects.create(
                    organization=self.org,
                    care_plan=plan,
                    patient=triage.patient,
                    version=1,
                    snapshot={"goals": plan.goals},
                    signed_by=self.nurse,
                )
        return str(plan.pk), str(activity.pk)

    def schedule_body(self, activity_id, request_id=None):
        return {
            "care_plan_activity": activity_id,
            "scheduled_for": (timezone.now() + timedelta(days=1)).isoformat(),
            "duration_minutes": 45,
            "mode": "VIDEO",
            "notes": "Call first",
            "client_request_id": request_id or str(uuid.uuid4()),
        }

    def test_client_list_shows_clients_psychiatry_was_asked_to_see(self):
        url = reverse("care-psych-module-clients")
        with platform_admin_context():
            CareTask.objects.filter(patient_id=self.pid).update(status="COMPLETED")
        # A signed triage alone does not put the client on the list…
        listed = self.client.get(url, **self.auth)
        self.assertNotIn(self.pid, [r["patient_id"] for r in listed.data["results"]])
        # …an open "Psychiatric review" action in the care plan does.
        self.create_schedule_plan()
        response = self.client.get(url, **self.auth)
        self.assertEqual(response.status_code, 200, response.data)
        row = next(r for r in response.data["results"] if r["patient_id"] == self.pid)
        self.assertTrue(row["suggested"])
        self.assertEqual(row["assessment_status"], "")
        self.assertIn("psychiatric review", row["suggested_reason"].lower())

    def test_client_list_handles_a_review_task_without_triage_or_session(self):
        with platform_admin_context():
            triage = TriageEncounter.objects.get(pk=self.te_id)
            CareTask.objects.filter(patient_id=self.pid).update(status="COMPLETED")
            triage.triage_version = 0
            triage.save(update_fields=["triage_version"])
            CareTask.objects.create(
                organization=self.org,
                patient_id=self.pid,
                episode=triage.episode,
                action_code="psychiatric_review",
                action_label="Psychiatric review",
                owner="Psychiatry",
            )

        response = self.client.get(reverse("care-psych-module-clients"), **self.auth)

        self.assertEqual(response.status_code, 200, response.data)
        row = next(item for item in response.data["results"] if item["patient_id"] == self.pid)
        self.assertEqual(row["episode_id"], str(triage.episode_id))

    def test_schedule_read_does_not_create_a_care_plan(self):
        response = self.client.get(self.schedule_url, **self.auth)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.data["plan"])

    def test_planned_psychiatry_action_can_be_scheduled_once_and_appears_in_lists(self):
        _, activity_id = self.create_schedule_plan(confirmed=False)
        request_id = str(uuid.uuid4())
        payload = self.schedule_body(activity_id, request_id)

        scheduled = self.client.post(self.schedule_url, payload, format="json", **self.auth)

        self.assertEqual(scheduled.status_code, 201, scheduled.data)
        self.assertEqual(len(scheduled.data["scheduled_sessions"]), 1)
        self.assertFalse(scheduled.data["plan"]["confirmed"])
        self.assertEqual(
            scheduled.data["scheduled_sessions"][0]["care_plan_activity_id"], activity_id
        )
        self.assertEqual(scheduled.data["scheduled_sessions"][0]["notes"], "Call first")
        repeated = self.client.post(self.schedule_url, payload, format="json", **self.auth)
        self.assertEqual(repeated.status_code, 200, repeated.data)
        self.assertEqual(len(repeated.data["scheduled_sessions"]), 1)
        duplicate = self.client.post(
            self.schedule_url,
            self.schedule_body(activity_id),
            format="json",
            **self.auth,
        )
        self.assertEqual(duplicate.status_code, 400, duplicate.data)

        with platform_admin_context():
            appointment = Appointment.objects.get(client_request_id=request_id)
            activity = CarePlanActivity.objects.get(pk=activity_id)
            self.assertEqual(appointment.care_plan_activity_id, activity.pk)
            self.assertEqual(appointment.origin, "CARE_PLAN")
            self.assertEqual(appointment.appointment_type, "Psychiatry review")
            self.assertEqual(appointment.provider_id, self.nurse.pk)
            self.assertEqual(activity.status, "PLANNED")

        clients = self.client.get(reverse("care-psych-module-clients"), **self.auth)
        row = next(item for item in clients.data["results"] if item["patient_id"] == self.pid)
        self.assertEqual(
            row["next_scheduled_session"]["scheduled_for"],
            scheduled.data["scheduled_sessions"][0]["scheduled_for"],
        )
        interventions = self.client.get(
            reverse("care-client-interventions-workspace", args=[self.pid]), **self.auth
        )
        self.assertEqual(interventions.status_code, 200, interventions.data)
        self.assertEqual(len(interventions.data["scheduled_sessions"]), 1)
        self.assertEqual(interventions.data["scheduled_sessions"][0]["activity_id"], activity_id)

    def test_a_booked_session_keeps_the_client_on_the_caseload(self):
        _, activity_id = self.create_schedule_plan(confirmed=False)
        self.client.post(
            self.schedule_url, self.schedule_body(activity_id), format="json", **self.auth
        )
        # The triage that first brought them in has been reviewed; the booked
        # session alone must keep the client on the psychiatry list.
        with platform_admin_context():
            TriageEncounter.objects.filter(pk=self.te_id).update(triage_version=0)

        clients = self.client.get(reverse("care-psych-module-clients"), **self.auth)
        row = next(item for item in clients.data["results"] if item["patient_id"] == self.pid)
        self.assertIsNotNone(row["next_scheduled_session"])
        self.assertEqual(row["suggested_reason"], "Psychiatry session booked")
        self.assertEqual(row["next_scheduled_session"]["status"], "SCHEDULED")

    def test_an_unactioned_session_shows_as_overdue(self):
        _, activity_id = self.create_schedule_plan(confirmed=False)
        self.client.post(
            self.schedule_url, self.schedule_body(activity_id), format="json", **self.auth
        )
        with platform_admin_context():
            Appointment.objects.filter(patient_id=self.pid).update(
                scheduled_for=timezone.now() - timedelta(days=2)
            )

        clients = self.client.get(reverse("care-psych-module-clients"), **self.auth)
        row = next(item for item in clients.data["results"] if item["patient_id"] == self.pid)
        self.assertEqual(row["next_scheduled_session"]["due_state"], "OVERDUE")
        self.assertGreaterEqual(row["next_scheduled_session"]["days_until"], 2)

    def test_scheduling_without_a_care_plan_is_refused_by_name(self):
        response = self.client.post(
            self.schedule_url,
            self.schedule_body(str(uuid.uuid4())),
            format="json",
            **self.auth,
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("no current care plan", str(response.data["care_plan_activity"]))

    def test_psychotherapy_session_can_be_scheduled_without_a_planned_action(self):
        from apps.sysadmin_audit.models import AuditLogEntry

        self.create_schedule_plan()
        url = reverse("care-psychotherapy-schedule", args=[self.pid])
        body = self.schedule_body("")
        del body["care_plan_activity"]
        body["appointment_type"] = "Family psychotherapy"

        response = self.client.post(url, body, format="json", **self.auth)

        self.assertEqual(response.status_code, 201, response.data)
        [session] = response.data["scheduled_sessions"]
        self.assertIsNone(session["care_plan_activity_id"])
        self.assertEqual(session["activity_title"], "Family psychotherapy")
        self.assertEqual(session["appointment_type"], "Family psychotherapy")
        with platform_admin_context():
            appointment = Appointment.objects.get(patient_id=self.pid)
            self.assertIsNone(appointment.care_plan_activity_id)
            self.assertEqual(appointment.appointment_type, "Family psychotherapy")
            entry = AuditLogEntry.objects.filter(
                object_id=str(appointment.pk), action=AuditLogEntry.ACTION_CREATE
            ).last()
            self.assertIsNotNone(entry)

        # The same request retried is the same session, not a refusal or a second booking.
        retried = self.client.post(url, body, format="json", **self.auth)
        self.assertEqual(retried.status_code, 200, retried.data)
        self.assertEqual(len(retried.data["scheduled_sessions"]), 1)
        listed = self.client.get(url, **self.auth)
        self.assertEqual(len(listed.data["scheduled_sessions"]), 1)
        with platform_admin_context():
            self.assertEqual(Appointment.objects.filter(patient_id=self.pid).count(), 1)

    def test_psychotherapy_schedule_refuses_a_non_psychotherapy_type(self):
        self.create_schedule_plan()
        body = self.schedule_body("")
        body["appointment_type"] = "Psychiatry review"

        response = self.client.post(
            reverse("care-psychotherapy-schedule", args=[self.pid]),
            body,
            format="json",
            **self.auth,
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("appointment_type", response.data)
        with platform_admin_context():
            self.assertFalse(Appointment.objects.filter(patient_id=self.pid).exists())

    def test_in_progress_action_cannot_be_scheduled(self):
        _, activity_id = self.create_schedule_plan(activity_status="ACTIVE")

        response = self.client.post(
            self.schedule_url,
            self.schedule_body(activity_id),
            format="json",
            **self.auth,
        )

        self.assertEqual(response.status_code, 404, response.data)
        with platform_admin_context():
            self.assertFalse(Appointment.objects.filter(patient_id=self.pid).exists())

    def test_new_assessment_carries_forward_triage_presenting_concern(self):
        concern = "Low mood and poor sleep, reported at triage."
        with platform_admin_context():
            TriageEncounter.objects.filter(pk=self.te_id).update(presenting_concern=concern)

        opened = self.client.post(self.open_url, format="json", **self.auth)

        self.assertEqual(opened.status_code, 200, opened.data)
        self.assertIsNone(opened.data["assessment"])
        self.assertEqual(
            opened.data["carried_forward_presenting_concern"],
            {"text": concern, "source": "triage"},
        )

    def test_new_assessment_falls_back_to_intake_presenting_concern(self):
        concern = "Poor sleep and low mood, reported at intake."
        with platform_admin_context():
            TriageEncounter.objects.filter(pk=self.te_id).update(presenting_concern="")
            IntakeAssessment.objects.create(
                organization=self.org,
                patient=Patient.objects.get(pk=self.pid),
                presenting_concern=concern,
                status=IntakeAssessment.STATUS_SIGNED,
            )

        opened = self.client.post(self.open_url, format="json", **self.auth)

        self.assertEqual(opened.status_code, 200, opened.data)
        self.assertEqual(
            opened.data["carried_forward_presenting_concern"],
            {"text": concern, "source": "intake"},
        )

    def test_existing_draft_is_not_replaced_by_carried_forward_concern(self):
        saved = self.client.put(self.open_url, self.body, format="json", **self.auth)
        self.assertEqual(saved.status_code, 200, saved.data)
        source_concern = "Updated concern from triage."
        with platform_admin_context():
            TriageEncounter.objects.filter(pk=self.te_id).update(presenting_concern=source_concern)

        opened = self.client.post(self.open_url, format="json", **self.auth)

        self.assertEqual(opened.status_code, 200, opened.data)
        self.assertEqual(
            opened.data["assessment"]["structured"]["presenting_concern"],
            self.body["structured"]["presenting_concern"],
        )

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

        # Reviewed, nothing waiting and no session booked: off the list until a
        # later triage, intake or booked review brings the client back.
        listed = self.client.get(reverse("care-psych-module-clients"), **self.auth)
        self.assertNotIn(self.pid, [r["patient_id"] for r in listed.data["results"]])

    def test_formulation_and_differential_are_saved_in_psychiatry_note(self):
        body = dict(self.body)
        body["structured"] = {
            **self.body["structured"],
            "form": {
                "summary": "Integrated presentation with depressive symptoms.",
                "differential": "Consider a substance-induced mood disorder.",
            },
        }

        saved = self.client.put(self.open_url, body, format="json", **self.auth)

        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual(
            saved.data["assessment"]["structured"]["form"],
            {
                "summary": "Integrated presentation with depressive symptoms.",
                "differential": "Consider a substance-induced mood disorder.",
            },
        )
        self.assertIn("Formulation & diagnosis", saved.data["assessment"]["text"])
        self.assertIn(
            "Integrated clinical summary / formulation: Integrated presentation with depressive symptoms.",
            saved.data["assessment"]["text"],
        )
        self.assertIn(
            "Differential diagnoses / conditions to rule out: Consider a substance-induced mood disorder.",
            saved.data["assessment"]["text"],
        )

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

    def test_reopening_after_signing_shows_the_completed_assessment_by_section(self):
        draft = self.client.post(self.open_url, format="json", **self.auth)
        self.assertIsNone(draft.data["completed"])
        signed = self.client.post(self.open_url + "sign/", self.body, format="json", **self.auth)
        self.assertEqual(signed.status_code, 200, signed.data)
        self.assertEqual(signed.data["completed"]["id"], signed.data["assessment"]["id"])

        reopened = self.client.post(self.open_url, format="json", **self.auth)
        self.assertEqual(reopened.status_code, 200, reopened.data)
        self.assertIsNone(reopened.data["assessment"])
        completed = reopened.data["completed"]
        self.assertTrue(completed["signed_at"])
        keys = [section["key"] for section in completed["sections"]]
        self.assertIn("assessment", keys)
        assessment = next(s for s in completed["sections"] if s["key"] == "assessment")
        self.assertIn("Clinical Risk Assessment", [item["label"] for item in assessment["items"]])
        self.assertEqual(completed["diagnoses"], [])
        self.assertEqual(completed["medications"], [])

    def test_amending_a_signed_assessment_keeps_the_original_unchanged(self):
        signed = self.client.post(self.open_url + "sign/", self.body, format="json", **self.auth)
        self.assertEqual(signed.status_code, 200, signed.data)
        original_id = signed.data["completed"]["id"]
        original_text = signed.data["assessment"]["text"]

        no_reason = dict(self.body, amends=original_id)
        refused = self.client.put(self.open_url, no_reason, format="json", **self.auth)
        self.assertEqual(refused.status_code, 400, refused.data)

        amended = dict(self.body, amends=original_id, amend_reason="Risk wording corrected.")
        saved = self.client.put(self.open_url, amended, format="json", **self.auth)
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual(saved.data["assessment"]["amends"]["id"], original_id)
        resigned = self.client.post(self.open_url + "sign/", amended, format="json", **self.auth)
        self.assertEqual(resigned.status_code, 200, resigned.data)

        history = resigned.data["history"]
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]["amends"]["id"], original_id)
        self.assertEqual(history[0]["amends"]["reason"], "Risk wording corrected.")
        self.assertEqual(history[1]["id"], original_id)
        self.assertEqual(len(history[1]["amended_by"]), 1)
        with platform_admin_context():
            original = ProgressNote.objects.get(pk=original_id)
            self.assertEqual(original.status, "SIGNED")
            self.assertEqual(original.text, original_text)

    def test_signing_completes_the_psychiatric_review_action_once(self):
        from .models import CarePlanActivity, InterventionRecord

        self.create_schedule_plan()
        signed = self.client.post(self.open_url + "sign/", self.body, format="json", **self.auth)
        self.assertEqual(signed.status_code, 200, signed.data)
        with platform_admin_context():
            activity = CarePlanActivity.objects.get(action_key="psych_review")
            self.assertEqual(activity.status, "COMPLETED")
            records = InterventionRecord.objects.filter(activity=activity)
            self.assertEqual(records.count(), 1)
            self.assertEqual(records.get().intervention, "Initial consultation")
        # An amendment corrects the same review: nothing more is recorded.
        amended = dict(self.body, amends=signed.data["completed"]["id"], amend_reason="Typo fixed")
        self.client.put(self.open_url, amended, format="json", **self.auth)
        again = self.client.post(self.open_url + "sign/", amended, format="json", **self.auth)
        self.assertEqual(again.status_code, 200, again.data)
        with platform_admin_context():
            self.assertEqual(InterventionRecord.objects.filter(module="psychiatry").count(), 1)

    def test_signing_asks_for_and_records_the_withdrawal_review_outcome(self):
        with platform_admin_context():
            triage = TriageEncounter.objects.get(pk=self.te_id)
            review = CareTask.objects.create(
                organization=self.org,
                patient=triage.patient,
                triage_encounter=triage,
                episode=triage.episode,
                action_code="psychiatric_review_withdrawal",
                action_label="Psychiatric review — withdrawal",
                focus_type="PSYCHIATRIC_REVIEW_WITHDRAWAL",
                owner="Psychiatry",
                status="INITIATED",
            )
        opened = self.client.post(self.open_url, format="json", **self.auth)
        self.assertEqual(opened.data["withdrawal_review"]["id"], str(review.pk))
        self.assertTrue(opened.data["review_outcomes"])

        refused = self.client.post(self.open_url + "sign/", self.body, format="json", **self.auth)
        self.assertEqual(refused.status_code, 400, refused.data)
        with platform_admin_context():
            self.assertFalse(
                ProgressNote.objects.filter(patient_id=self.pid, status="SIGNED").exists()
            )

        body = dict(self.body, review_outcome="managed_here", review_outcome_note="Low CIWA")
        signed = self.client.post(self.open_url + "sign/", body, format="json", **self.auth)
        self.assertEqual(signed.status_code, 200, signed.data)
        self.assertIsNone(signed.data["withdrawal_review"])
        with platform_admin_context():
            review.refresh_from_db()
            self.assertEqual((review.status, review.outcome), ("COMPLETED", "managed_here"))
            self.assertEqual(review.outcome_note, "Low CIWA")

    def _task(self, code):
        with platform_admin_context():
            triage = TriageEncounter.objects.get(pk=self.te_id)
            return CareTask.objects.create(
                organization=self.org,
                patient=triage.patient,
                triage_encounter=triage,
                episode=triage.episode,
                action_code=code,
                action_label=code,
                owner="Nurse",
                status="INITIATED",
            )

    def test_a_withdrawal_score_closes_its_task_and_completion_closes_the_action(self):
        from . import withdrawal
        from .models import InterventionRecord

        ciwa = self._task("ciwa_ar")
        cows = self._task("cows")
        monitoring = self._task("withdrawal_monitoring")
        with platform_admin_context():
            patient = Patient.objects.get(pk=self.pid)
            withdrawal.score_recorded(patient, self.nurse, "CIWA")
            ciwa.refresh_from_db()
            cows.refresh_from_db()
            monitoring.refresh_from_db()
        self.assertEqual(ciwa.status, "COMPLETED")
        self.assertEqual(cows.status, "INITIATED")  # another scale's task stays
        self.assertEqual(monitoring.status, "PENDING")  # monitoring is under way

        url = reverse("care-client-withdrawal-complete", args=[self.pid])
        none = self.client.post(url, {}, format="json", **self.auth)
        self.assertEqual(none.status_code, 400)  # no withdrawal action in the plan
        with platform_admin_context():
            triage = TriageEncounter.objects.get(pk=self.te_id)
            plan = CarePlan.objects.create(
                organization=self.org, patient=triage.patient, episode=triage.episode
            )
            activity = CarePlanActivity.objects.create(
                organization=self.org,
                care_plan=plan,
                title="Detox / withdrawal management",
                action_key="detox",
                decision="ACCEPTED",
            )
        state = self.client.get(reverse("care-client-withdrawal", args=[self.pid]), **self.auth)
        self.assertEqual(state.data["management"], "open")
        done = self.client.post(url, {"note": "Scores settled"}, format="json", **self.auth)
        self.assertEqual(done.status_code, 201, done.data)
        with platform_admin_context():
            activity.refresh_from_db()
            monitoring.refresh_from_db()
            cows.refresh_from_db()
            self.assertEqual(activity.status, "COMPLETED")
            self.assertEqual((monitoring.status, cows.status), ("COMPLETED", "COMPLETED"))
            self.assertEqual(
                InterventionRecord.objects.filter(module="withdrawal_management").count(), 1
            )
        state = self.client.get(reverse("care-client-withdrawal", args=[self.pid]), **self.auth)
        self.assertEqual(state.data["management"], "completed")

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
