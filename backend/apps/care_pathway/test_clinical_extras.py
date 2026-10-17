"""Therapy contract and per-participant sessions, OAT/naloxone, missed appointments, follow-up schedule, timeline."""

from datetime import timedelta

from django.test import override_settings
from django.urls import reverse
from django.utils import timezone

from apps.client_registry.models import Appointment, Patient
from apps.tenancy.context import platform_admin_context

from .test_records import RecordsTestCase


class TherapyTests(RecordsTestCase):
    def start(self, **over):
        return self.post("care-client-therapy", {"modality": "CBT", "planned_sessions": 8, **over})

    def test_notes_are_blocked_until_confidentiality_limits_are_agreed(self):
        eid = self.start().data["id"]
        blocked = self.post("care-client-therapy-session", {"episode": eid, "session_notes": "x"})
        self.assertEqual(blocked.status_code, 400)
        self.post("care-therapy-confidentiality", {}, eid)
        ok = self.post("care-client-therapy-session", {"episode": eid, "session_notes": "Agenda set", "process_notes": "Counter-transference"})
        self.assertEqual(ok.status_code, 201, ok.data)
        self.assertEqual(self.start(modality="NOPE").status_code, 400)

    def test_score_handoff_and_process_notes_hidden_from_non_treating_roles(self):
        eid = self.start().data["id"]
        self.post("care-therapy-confidentiality", {}, eid)
        self.post("care-client-therapy-session", {
            "episode": eid, "session_notes": "n", "process_notes": "secret",
            "score": {"instrument": "GAD7", "answers": [1] * 7},
        })
        outcomes = self.get("care-client-outcomes").data["summary"]
        self.assertTrue(any(o["instrument"] == "GAD7" for o in outcomes))
        from . import therapy

        self.assertNotIn("process_notes", therapy.visible_extra({"process_notes": "x", "a": 1}, None))


class OatTests(RecordsTestCase):
    def test_referral_enrolment_needs_the_prescribers_dose_and_stop_needs_a_reason(self):
        self.assertEqual(self.post("care-client-oat", {"medicine": "NOPE", "clinic": "X"}).status_code, 400)
        self.assertEqual(self.post("care-client-oat", {"medicine": "METHADONE", "clinic": " "}).status_code, 400)
        eid = self.post("care-client-oat", {"medicine": "BUPRENORPHINE", "clinic": "Regional clinic"}).data["id"]
        self.assertEqual(self.post("care-oat-status", {"status": "ENROLLED"}, eid).status_code, 400)
        self.assertEqual(self.post("care-oat-status", {"status": "ENROLLED", "dose": "as written by OAT prescriber"}, eid).status_code, 200)
        self.assertEqual(self.post("care-oat-status", {"status": "STOPPED"}, eid).status_code, 400)
        data = self.get("care-client-oat").data
        self.assertEqual(data["enrolments"][0]["status"], "ENROLLED")

    def test_naloxone_supplied_needs_a_quantity_declined_does_not(self):
        self.assertEqual(self.post("care-client-naloxone", {"outcome": "SUPPLIED"}).status_code, 400)
        self.assertEqual(self.post("care-client-naloxone", {"outcome": "SUPPLIED", "quantity": 2, "training_given": True}).status_code, 201)
        self.assertEqual(self.post("care-client-naloxone", {"outcome": "DECLINED"}).status_code, 201)
        self.assertEqual(len(self.get("care-client-oat").data["naloxone"]), 2)


class MissedAppointmentTests(RecordsTestCase):
    def make_appointment(self):
        with platform_admin_context():
            return Appointment.objects.create(
                organization=self.org, patient=Patient.objects.get(pk=self.pid),
                scheduled_for=timezone.now() - timedelta(hours=2), status="SCHEDULED",
            )

    def test_missed_needs_a_coded_reason_and_with_active_risk_asks_for_same_day_contact(self):
        appt = self.make_appointment()
        self.assertEqual(self.post("care-appointment-missed", {"reason": "nope"}, appt.pk).status_code, 400)
        self.assertEqual(self.post("care-appointment-missed", {"reason": "TRANSPORT"}, appt.pk).status_code, 200)
        items = self.get("care-client-attention").data["items"]
        self.assertTrue(any("re-contact" in i["text"] for i in items))
        self.post("care-client-assessments", {"instrument": "PHQ9", "answers": [0] * 8 + [2]}, self.pid)
        items = self.get("care-client-attention").data["items"]
        self.assertTrue(any("next of kin today" in i["text"] for i in items))
        self.post("care-appointment-recontacted", {}, appt.pk)
        self.assertFalse(any(i["key"].startswith("dna:") for i in self.get("care-client-attention").data["items"]))

    def discharge_checklist_done(self):
        # A planned discharge waits for the discharge checklist (test_care_plan_v4).
        self.client.patch(reverse("care-client-discharge-checklist", args=[self.pid]), {
            "meds_reconciled": True, "counter_referral": "NO_REFERRER", "teach_back": True,
            "no_follow_up_reason": "Facility schedule books it",
        }, format="json", **self.auth)

    def test_follow_up_schedule_is_configuration_and_generates_only_when_set(self):
        self.discharge_checklist_done()
        self.post("care-client-episode-outcome", {"outcome": "PLANNED"})
        with platform_admin_context():
            self.assertEqual(Appointment.objects.filter(patient_id=self.pid, origin="DISCHARGE").count(), 0)
        self.post("care-client-new-episode", {})
        self.discharge_checklist_done()
        with override_settings(FOLLOW_UP_SCHEDULE=[{"reason": "POST_DISCHARGE", "after_hours": 72}]):
            self.post("care-client-episode-outcome", {"outcome": "PLANNED"})
        with platform_admin_context():
            self.assertEqual(Appointment.objects.filter(patient_id=self.pid, origin="DISCHARGE").count(), 1)


class TimelineTests(RecordsTestCase):
    def test_timeline_includes_scores_notes_capacity_and_risk_decisions(self):
        self.post("care-client-assessments", {"instrument": "PHQ9", "answers": [0] * 8 + [1]}, self.pid)
        n = self.post("care-client-notes", {"note_type": "PHONE", "text": "Called client"})
        self.post("care-note", {}, n.data["id"])
        self.post("care-client-capacity", {"decision": "MEDICATION", "understand": "Yes", "retain": "Yes", "weigh": "Yes", "communicate": "Yes"})
        kinds = {e["kind"] for e in self.get("care-client-timeline").data["results"]}
        self.assertTrue({"score", "note", "consent"} <= kinds, kinds)


class LabsAndLegalFormTests(RecordsTestCase):
    def test_abnormal_validated_result_is_an_open_item_until_acknowledged_and_writes_back_when_configured(self):
        from apps.dha_interop.models import LoincCodeIndex
        from apps.lims.models import LabOrder, LabResult

        from . import services

        with platform_admin_context():
            patient = Patient.objects.get(pk=self.pid)
            code, _ = LoincCodeIndex.objects.get_or_create(code="TEST-1", defaults={"description": "Test analyte"})
            episode = services.get_or_open_episode(patient, self.nurse)
            enc = services.clinical_encounter_for(patient, episode, self.nurse)
            order = LabOrder.objects.create(organization=self.org, encounter=enc, loinc_code=code)
            result = LabResult.objects.create(organization=self.org, lab_order=order, result_value="480",
                                              is_abnormal=True, is_validated=True)
        data = self.get("care-client-labs").data
        self.assertEqual(data["results"][0]["acknowledged"], False)
        self.assertTrue(any(i["key"] == f"lab:{result.pk}" for i in self.get("care-client-attention").data["items"]))
        ack = reverse("care-lab-acknowledge", args=[result.pk])
        self.assertEqual(self.post("care-lab-acknowledge", {}, result.pk).status_code, 403)  # not a prescriber
        with override_settings(INTAKE_LAB_WRITEBACK={"TEST-1": "qtc"}):
            self.assertEqual(self.client.post(ack, {}, format="json", **self.psych_auth).status_code, 200)
        self.assertEqual(self.client.post(ack, {}, format="json", **self.psych_auth).status_code, 400)
        self.assertEqual(self.get("care-client-intake-draft").data["sections"]["medical"]["qtc"], "480")
        self.assertEqual(self.post("care-client-labs", {"codes": ["NOPE-9"]}).status_code, 400)
        self.assertEqual(self.post("care-client-labs", {"codes": ["TEST-1"]}).status_code, 201)

    def test_no_forms_are_offered_until_configured_and_signing_is_role_checked(self):
        self.assertEqual(self.get("care-client-legal-forms").data["catalogue"], [])
        self.assertEqual(self.post("care-client-legal-forms", {"form_key": "x"}).status_code, 400)
        cfg = [{"key": "FORM_A", "title": "Form A", "signer_roles": ["Psychiatrist"]}]
        with override_settings(LEGAL_FORM_CATALOGUE=cfg):
            fid = self.post("care-client-legal-forms", {"form_key": "FORM_A"}).data["id"]
            signed = self.post("care-legal-form-sign", {}, fid)
            self.assertEqual(signed.data["status"], "COSIGN_REQUESTED")  # nurse may not sign it herself


class ModuleLinkTests(RecordsTestCase):
    def test_modules_are_recommended_from_the_plan_and_oat_from_the_intake(self):
        from . import care_plan

        self.assertIn("detox", care_plan.ACTION_MODULES)
        self.assertEqual(self.get("care-client-modules").data["recommended"].get("oat"), None)
        with platform_admin_context():
            from . import intake

            draft = intake.open_draft(Patient.objects.get(pk=self.pid), self.nurse)
            draft.sections = {**draft.sections, "subs": {"kind": "OPIOIDS"}}
            draft.save()
        self.assertIn("oat", self.get("care-client-modules").data["recommended"])


class PerinatalTriggerTests(RecordsTestCase):
    def test_epds_is_recommended_only_when_pregnant_or_postpartum_is_recorded(self):
        from . import intake, intake_schema, tools

        with platform_admin_context():
            patient = Patient.objects.get(pk=self.pid)
            draft = intake.open_draft(patient, self.nurse)
            self.assertNotIn("EPDS", tools.triggers(patient))
            draft.sections = {**draft.sections, "medical": {"preg_status": intake_schema._code("Postpartum")}}
            draft.save()
            self.assertIn("EPDS", tools.triggers(patient))


class WardBoardTests(RecordsTestCase):
    def test_board_lists_current_inpatients_and_flags_psychosis_from_the_mse(self):
        response = self.client.get(reverse("care-ward-board"), **self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.data["results"], list)
        self.get("care-client-intake-draft")
        self.client.put(reverse("care-client-intake-draft", args=[self.pid]),
                        {"sections": {"mse": {"perception": "Auditory hallucinations"}}}, format="json", **self.auth)
        self.assertTrue(any(a["key"] == "psychosis" for a in self.get("care-client-attention").data["alerts"]))


class MeasureDueTests(RecordsTestCase):
    def test_repeat_measure_flag_only_appears_when_policy_is_configured(self):
        from .models import OutcomeScore

        self.post("care-client-assessments", {"instrument": "PHQ9", "answers": [1] * 9}, self.pid)
        with platform_admin_context():
            OutcomeScore.objects.filter(patient_id=self.pid).update(recorded_at=timezone.now() - timedelta(days=30))
        self.assertFalse(any(i["key"] == "measure:PHQ9" for i in self.get("care-client-attention").data["items"]))
        with override_settings(MEASURE_REPEAT_DAYS=14):
            items = self.get("care-client-attention").data["items"]
        self.assertTrue(any(i["key"] == "measure:PHQ9" and i["overdue"] for i in items))
