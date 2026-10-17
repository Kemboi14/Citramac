"""Care plan, outcomes and follow-up brought up to the v4 mockup: bulk accept with
review, added actions, goals and disagreement points, extra plan conflicts, the
72-hour contact as a real follow-up, nursing care plan, context-filtered measures,
the planned-discharge gate and in-record follow-up (DATA-08, AT-04, INT-21,
INT-DEV-10, RULE-05, RULE-11)."""

from datetime import date, timedelta

from django.urls import reverse
from django.utils import timezone

from apps.client_registry.consent import capture_consent
from apps.client_registry.models import Appointment, Patient
from apps.tenancy.context import platform_admin_context

from .models import CarePlanActivity, CarePlanVersion, ProgressNote
from .test_care_plan import CarePlanTestCase


class V4TestCase(CarePlanTestCase):
    def post(self, name, body=None, *args):
        return self.client.post(reverse(name, args=args or [self.pid]), body or {}, format="json", **self.auth)

    def get(self, name, *args):
        return self.client.get(reverse(name, args=args or [self.pid]), **self.auth)

    def patch(self, name, body, *args):
        return self.client.patch(reverse(name, args=args or [self.pid]), body, format="json", **self.auth)

    def confirm(self, **body):
        return self.client.post(reverse("care-plan-confirm", args=[self.pid]), body, format="json", **self.auth)

    def intake(self, **sections):
        self.draft()
        self.save(sections=sections)

    def patient(self):
        with platform_admin_context():
            return Patient.objects.get(pk=self.pid)


class BulkAcceptTests(V4TestCase):
    def test_bulk_accept_needs_a_review_acknowledgement_at_signing(self):
        self.risk(suicide=["Thoughts"])
        ws = self.post("care-plan-accept-remaining").data
        accepted = {a["key"]: a for a in ws["actions"]}
        self.assertEqual(set(accepted), {"psych_review", "safety"})
        self.assertTrue(all(a["bulk_accepted"] for a in accepted.values()))
        self.assertEqual(accepted["safety"]["priority"], "YELLOW")
        self.details(client_agreement="AGREES")
        self.client.get(reverse("care-safety-plan", args=[self.pid]), **self.auth)
        self.client.put(reverse("care-safety-plan", args=[self.pid]), {"people_to_ask": "My sister"}, format="json", **self.auth)
        self.client.post(reverse("care-safety-plan-sign", args=[self.pid]), **self.auth)
        self.details(contact_72h_at=(timezone.now() + timedelta(days=2)).isoformat(), follow_up_clinician="J. Njoroge")

        blocked = self.confirm()
        self.assertEqual(blocked.status_code, 400)
        self.assertIn("bulk_reviewed", blocked.data)
        self.assertEqual({b["key"] for b in blocked.data["bulk"]}, {"psych_review", "safety"})

        signed = self.confirm(bulk_reviewed=True)
        self.assertEqual(signed.status_code, 200, signed.data)
        self.assertFalse(any(a["bulk_accepted"] for a in signed.data["actions"]))
        with platform_admin_context():
            snapshot = CarePlanVersion.objects.get(care_plan__patient_id=self.pid).snapshot
        self.assertTrue(all(a["bulk"] for a in snapshot["actions"]))
        self.assertTrue(snapshot["bulk_reviewed_by"])

    def test_an_individual_decision_clears_the_bulk_mark(self):
        self.post("care-plan-accept-remaining")
        ws = self.decide("outpatient", "ACCEPTED", priority="GREEN").data
        self.assertFalse(ws["actions"][0]["bulk_accepted"])


class AddedActionTests(V4TestCase):
    def test_other_actions_can_be_added_and_taken_back_before_signing(self):
        ws = self.ws().data
        others = {a["key"] for a in ws["other_actions"]}
        self.assertNotIn("outpatient", others)
        self.assertIn("nutrition", others)
        added = self.decide("nutrition", "ADDED", priority="GREEN").data
        self.assertEqual(next(a for a in added["actions"] if a["key"] == "nutrition")["decision"], "ADDED")
        url = reverse("care-plan-action-decide", args=[self.pid, "nutrition"])
        self.assertEqual(self.client.delete(url, **self.auth).status_code, 200)
        with platform_admin_context():
            self.assertFalse(CarePlanActivity.objects.filter(action_key="nutrition").exists())
        self.decide("outpatient", "ACCEPTED")
        outpatient = reverse("care-plan-action-decide", args=[self.pid, "outpatient"])
        self.assertEqual(self.client.delete(outpatient, **self.auth).status_code, 400)

    def test_an_added_action_in_a_signed_plan_cannot_be_removed(self):
        self.decide("outpatient", "ACCEPTED")
        self.decide("social", "ADDED", priority="GREEN")
        self.details(client_agreement="AGREES")
        self.assertEqual(self.confirm().status_code, 200)
        url = reverse("care-plan-action-decide", args=[self.pid, "social"])
        self.assertEqual(self.client.delete(url, **self.auth).status_code, 400)


class CarriedContextTests(V4TestCase):
    def test_scores_and_intake_context_are_carried_onto_the_plan(self):
        self.post("care-client-assessments", {"instrument": "PHQ9", "answers": [1] * 9})
        self.intake(persp={"matters": "Getting back to work"}, pres={"own": "Low mood", "goals": "Sleep again"})
        ws = self.ws().data
        chip = next(c for c in ws["carried_scores"] if c["instrument"] == "PHQ9")
        self.assertEqual((chip["score"], chip["max"]), (9, 27))
        self.assertTrue(chip["band"])
        self.assertEqual(ws["intake"]["state"], "unsigned")
        self.assertEqual(ws["intake"]["what_matters"], "Getting back to work")
        self.assertEqual(ws["intake"]["goals"], "Sleep again")
        self.assertFalse(ws["is_opioid"])
        self.assertEqual(ws["family_consent"], "NOT_ASKED")


class ClientDetailsTests(V4TestCase):
    def test_agreement_is_a_served_code_and_declining_needs_the_clients_reasons(self):
        self.decide("outpatient", "ACCEPTED")
        self.assertEqual(self.details(client_agreement="DISAGREES").status_code, 400)  # retired
        self.assertEqual(self.details(client_agreement="DECLINED").status_code, 200)
        self.assertIn("Where the client disagrees — record each point in their words", self.ws().data["outstanding"])
        bad = self.details(disagreements=[{"part": "NOPE", "words": "x"}])
        self.assertEqual(bad.status_code, 400)
        ok = self.details(disagreements=[{"part": "MEDICATION", "words": "I do not want tablets"}])
        self.assertNotIn("Where the client disagrees — record each point in their words", ok.data["outstanding"])
        self.assertEqual(self.confirm().status_code, 200)

    def test_goals_are_validated_and_signed_into_the_version(self):
        self.decide("outpatient", "ACCEPTED")
        goal = {"goal": "Sleep through the night", "action_key": "outpatient", "formulation": "PERPETUATING",
                "owner": "Client & J. Njoroge", "review_date": (date.today() + timedelta(days=14)).isoformat()}
        self.assertEqual(self.details(goal_items=[{**goal, "action_key": "nope"}]).status_code, 400)
        self.assertEqual(self.details(goal_items=[{**goal, "formulation": "X"}]).status_code, 400)
        self.assertEqual(self.details(goal_items=[{**goal, "review_date": "soon"}]).status_code, 400)
        saved = self.details(
            goal_items=[goal], crisis_plan="Call my sister", advance_statement="No depot injections",
            family_involvement="Sister attends reviews", client_agreement="AGREES",
        )
        self.assertEqual(saved.data["details"]["goal_items"][0]["formulation"], "PERPETUATING")
        self.assertEqual(self.confirm().status_code, 200)
        with platform_admin_context():
            snapshot = CarePlanVersion.objects.get(care_plan__patient_id=self.pid).snapshot
        self.assertEqual(snapshot["goals"][0]["goal"], "Sleep through the night")
        self.assertEqual(snapshot["crisis_plan"], "Call my sister")
        self.assertEqual(snapshot["advance_statement"], "No depot injections")

    def test_client_acknowledgement_is_recorded_and_sets_agreement(self):
        self.assertEqual(self.post("care-plan-client-ack", {"language": "fr"}).status_code, 400)
        ws = self.post("care-plan-client-ack", {"language": "sw"}).data
        self.assertEqual(ws["client_ack"]["language"], "sw")
        self.assertEqual(ws["details"]["client_agreement"], "AGREES")

    def test_oat_offer_is_a_served_code(self):
        self.assertEqual(self.details(oat_offer="MAYBE").status_code, 400)
        self.assertEqual(self.details(oat_offer="OFFERED_BUPRENORPHINE", naloxone_teaching=True).status_code, 200)


class ConflictTests(V4TestCase):
    def test_opioid_detox_without_naloxone_or_oat_is_a_conflict(self):
        self.intake(subs={"kind": "OPIOIDS"})
        self.decide("detox", "ADDED", priority="YELLOW")
        conflict = "Opioid withdrawal plan with no naloxone or opioid-agonist-therapy discussion recorded."
        self.assertIn(conflict, self.ws().data["conflicts"])
        self.assertTrue(self.ws().data["is_opioid"])
        self.assertNotIn(conflict, self.details(naloxone_teaching=True).data["conflicts"])

    def test_family_intervention_against_declined_family_consent_is_a_conflict(self):
        with platform_admin_context():
            capture_consent(self.patient(), self.nurse, False, "v1", "Family involvement wording",
                            consent_type="FAMILY_INVOLVEMENT", decision="NO")
        ws = self.decide("family", "ADDED", priority="GREEN").data
        self.assertEqual(ws["family_consent"], "NO")
        self.assertIn("Family intervention is planned but the client declined family involvement.", ws["conflicts"])

    def test_involuntary_admission_without_admission_or_transfer_action_is_a_conflict(self):
        from apps.clinical_encounter.models import Encounter
        from apps.ipd_ward.models import Admission, Bed, Ward

        from . import services

        with platform_admin_context():
            patient = self.patient()
            episode = services.get_or_open_episode(patient, self.nurse)
            encounter = Encounter.objects.create(
                organization=self.org, patient=patient, episode=episode, opened_by=self.nurse,
                encounter_type="INPATIENT", status="IN_PROGRESS",
            )
            ward = Ward.objects.create(organization=self.org, name="Ward A")
            bed = Bed.objects.create(organization=self.org, ward=ward, bed_number="B1", status="OCCUPIED")
            Admission.objects.create(
                organization=self.org, patient=patient, bed=bed, encounter=encounter, episode=episode,
                admitted_by=self.nurse, admission_type="INVOLUNTARY",
            )
        ws = self.decide("outpatient", "ACCEPTED").data
        self.assertIn("Legal status is involuntary but no admission or transfer is planned.", ws["conflicts"])
        ws = self.decide("admission", "ADDED", priority="ORANGE").data
        self.assertNotIn("Legal status is involuntary but no admission or transfer is planned.", ws["conflicts"])


class SeventyTwoHourContactTests(V4TestCase):
    def test_the_72h_contact_becomes_one_follow_up_appointment(self):
        self.decide("outpatient", "ACCEPTED")
        first = (timezone.now() + timedelta(days=3)).replace(microsecond=0)
        self.details(client_agreement="AGREES", contact_72h_at=first.isoformat(), follow_up_clinician="J. Njoroge")
        self.assertEqual(self.confirm().status_code, 200)
        self.assertEqual(self.confirm().status_code, 200)  # a re-sign does not duplicate it
        with platform_admin_context():
            booked = Appointment.objects.filter(patient_id=self.pid, origin="CARE_PLAN", reason="CONTACT_72H")
            self.assertEqual(booked.count(), 1)
            self.assertEqual(booked.get().scheduled_for, first)
            self.assertIn("J. Njoroge", booked.get().notes)
        moved = first + timedelta(hours=6)
        self.details(contact_72h_at=moved.isoformat())
        self.confirm()
        with platform_admin_context():
            booked = Appointment.objects.filter(patient_id=self.pid, origin="CARE_PLAN", reason="CONTACT_72H")
            self.assertEqual(booked.count(), 1)
            self.assertEqual(booked.get().scheduled_for, moved)
        self.assertEqual(self.get("care-client-follow-ups").data["counts"]["due"], 1)


class MdtAndNursingTests(V4TestCase):
    def test_mdt_dissent_is_recorded(self):
        review = self.post("care-plan-mdt", {"scheduled_for": date.today().isoformat()}).data
        held = self.post("care-mdt-record", {"notes": "Continue plan", "attendees": "Team",
                                            "dissent": "Nurse prefers admission"}, review["id"])
        self.assertEqual(held.data["dissent"], "Nurse prefers admission")

    def test_nursing_problem_links_to_a_live_action_and_evaluations_append(self):
        self.decide("outpatient", "ACCEPTED")
        self.assertEqual(self.post("care-plan-nursing", {"problem": "Poor sleep"}).status_code, 400)
        self.assertEqual(
            self.post("care-plan-nursing", {"problem": "Poor sleep", "goal": "6 h sleep", "action_key": "detox"}).status_code,
            400,
        )
        made = self.post("care-plan-nursing", {"problem": "Poor sleep", "goal": "6 h sleep",
                                               "interventions": "Sleep hygiene", "action_key": "outpatient",
                                               "evaluation": "Slept 4 h"})
        self.assertEqual(made.status_code, 201, made.data)
        self.assertEqual(made.data["action_key"], "outpatient")
        later = self.post("care-nursing-evaluate", {"evaluation": "Slept 6 h"}, made.data["id"])
        self.assertEqual([e["text"] for e in later.data["evaluations"]], ["Slept 4 h", "Slept 6 h"])
        self.assertEqual(self.post("care-nursing-evaluate", {"evaluation": " "}, made.data["id"]).status_code, 400)
        self.assertEqual(len(self.get("care-plan-nursing").data["results"]), 1)


class OutcomesTests(V4TestCase):
    def options(self):
        return [o["code"] for o in self.get("care-client-outcomes-overview").data["measure_options"]]

    def test_measure_options_follow_the_clients_context(self):
        codes = self.options()
        self.assertIn("PHQ9", codes)
        for code in ("PHQA", "EPDS", "CIWA", "COWS"):
            self.assertNotIn(code, codes)
        self.intake(subs={"kind": "OPIOIDS"}, medical={"preg_status": "PREGNANT"})
        codes = self.options()
        self.assertIn("COWS", codes)
        self.assertIn("EPDS", codes)
        self.assertNotIn("CIWA", codes)
        with platform_admin_context():
            Patient.objects.filter(pk=self.pid).update(date_of_birth=date.today().replace(year=date.today().year - 15))
        self.assertIn("PHQA", self.options())

    def test_an_assessment_can_be_dated_earlier_but_not_in_the_future(self):
        earlier = (timezone.now() - timedelta(days=2)).replace(microsecond=0)
        ok = self.post("care-client-assessments", {"instrument": "GAD7", "answers": [1] * 7,
                                                   "assessed_at": earlier.isoformat(), "timepoint": "BASELINE"})
        self.assertEqual(ok.status_code, 201, ok.data)
        row = self.get("care-client-outcomes-overview").data["scores"][0]
        self.assertEqual(row["recorded_at"], earlier)
        self.assertEqual(row["timepoint"], "BASELINE")
        self.assertTrue(row["recorded_by"])
        future = (timezone.now() + timedelta(days=1)).isoformat()
        bad = self.post("care-client-assessments", {"instrument": "GAD7", "answers": [1] * 7, "assessed_at": future})
        self.assertEqual(bad.status_code, 400)

    def test_discharge_measures_are_prompted_and_previous_episodes_listed(self):
        self.assertFalse(self.get("care-client-outcomes-overview").data["discharge_measures_due"])
        self.post("care-client-episode-outcome", {"outcome": "LOST", "reason": "No contact after three attempts"})
        overview = self.get("care-client-outcomes-overview").data
        self.assertTrue(overview["discharge_measures_due"])
        self.assertEqual(overview["episode"]["outcome"]["outcome"], "LOST")
        self.post("care-client-assessments", {"instrument": "PHQ9", "answers": [0] * 9, "timepoint": "DISCHARGE"})
        self.assertFalse(self.get("care-client-outcomes-overview").data["discharge_measures_due"])
        self.post("care-client-new-episode")
        previous = self.get("care-client-outcomes-overview").data["previous_episodes"]
        self.assertEqual([(p["number"], p["outcome"]) for p in previous], [(1, "LOST")])


class PlannedDischargeGateTests(V4TestCase):
    def test_a_planned_discharge_waits_for_the_checklist(self):
        blocked = self.post("care-client-episode-outcome", {"outcome": "PLANNED"})
        self.assertEqual(blocked.status_code, 400)
        self.assertIn("Medicines reconciled with the client", blocked.data["checklist"])
        self.assertEqual(self.patch("care-client-discharge-checklist", {"counter_referral": "MAYBE"}).status_code, 400)
        checklist = self.patch("care-client-discharge-checklist", {
            "meds_reconciled": True, "counter_referral": "NO_REFERRER", "teach_back": True,
        }).data
        open_items = [i["label"] for i in checklist["items"] if not i["ok"]]
        self.assertEqual(open_items, ["Follow-up contact booked — or the reason none is needed"])
        self.client.post(reverse("care-follow-ups"), {
            "patient": self.pid, "reason": "POST_DISCHARGE",
            "scheduled_for": (timezone.now() + timedelta(days=3)).isoformat(),
        }, format="json", **self.auth)
        self.assertTrue(all(i["ok"] for i in self.get("care-client-discharge-checklist").data["items"]))
        self.assertEqual(self.post("care-client-episode-outcome", {"outcome": "PLANNED", "destination": "SPACE"}).status_code, 400)
        done = self.post("care-client-episode-outcome", {"outcome": "PLANNED", "destination": "HOME_FAMILY"})
        self.assertEqual(done.status_code, 201, done.data)

    def test_opioid_use_and_an_accepted_safety_action_add_checklist_items(self):
        self.intake(subs={"kind": "OPIOIDS"})
        self.decide("safety", "ADDED", priority="YELLOW")
        keys = {i["key"] for i in self.get("care-client-discharge-checklist").data["items"]}
        self.assertTrue({"naloxone", "safety"} <= keys)

    def test_an_unplanned_outcome_is_not_gated(self):
        ok = self.post("care-client-episode-outcome", {"outcome": "LEFT_EARLY", "reason": "Left against advice"})
        self.assertEqual(ok.status_code, 201)


class InRecordFollowUpTests(V4TestCase):
    def book(self, when):
        return self.client.post(reverse("care-follow-ups"), {
            "patient": self.pid, "reason": "MEDICATION_REVIEW", "scheduled_for": when.isoformat(),
        }, format="json", **self.auth).data

    def test_counts_done_with_a_note_and_the_note_is_a_signed_follow_up_note(self):
        past = self.book(timezone.now() - timedelta(days=1))
        self.book(timezone.now() + timedelta(days=5))
        data = self.get("care-client-follow-ups").data
        self.assertEqual(data["counts"], {"due": 2, "overdue": 1, "completed": 0, "missed": 0})
        self.assertEqual(data["next_due"]["id"], past["id"])
        self.assertEqual(self.post("care-appointment-contact-done", {"note": ""}, past["id"]).status_code, 400)
        done = self.post("care-appointment-contact-done", {"note": "Phoned — sleeping better"}, past["id"]).data
        self.assertEqual(done["counts"]["completed"], 1)
        row = next(r for r in done["results"] if r["id"] == past["id"])
        self.assertEqual(row["contact_note"]["text"], "Phoned — sleeping better")
        with platform_admin_context():
            note = ProgressNote.objects.get(appointment_id=past["id"])
            self.assertEqual((note.note_type, note.status), ("FOLLOW_UP", "SIGNED"))
        self.assertEqual(self.post("care-appointment-contact-done", {"note": "again"}, past["id"]).status_code, 400)

    def test_missed_with_active_risk_escalates_and_rebooking_actions_it(self):
        past = self.book(timezone.now() - timedelta(hours=3))
        self.assertEqual(self.post("care-appointment-missed", {"reason": "TRANSPORT"}, past["id"]).status_code, 200)
        self.risk(suicide=["Thoughts"])
        row = self.get("care-client-follow-ups").data["results"][0]
        self.assertTrue(row["escalate"])
        self.assertEqual(row["missed_reason_label"], "Transport")
        tomorrow = (timezone.now() + timedelta(days=1)).isoformat()
        rebooked = self.post("care-appointment-rebook", {"scheduled_for": tomorrow, "client_request_id": "rb-1"}, past["id"])
        self.assertEqual(rebooked.status_code, 201, rebooked.data)
        rows = rebooked.data["results"]
        self.assertFalse(next(r for r in rows if r["id"] == past["id"])["escalate"])
        self.assertTrue(any(r["reason"] == "OUTREACH" and r["status"] == "SCHEDULED" for r in rows))
        again = self.post("care-appointment-rebook", {"scheduled_for": tomorrow}, past["id"])
        self.assertEqual(again.status_code, 400)
