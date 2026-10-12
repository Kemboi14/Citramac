"""Intervention modules: observation & safety, observation sets, SBAR, prescribing checks, MAR, restrictive practice."""

from datetime import timedelta

from django.test import override_settings
from django.urls import reverse
from django.utils import timezone

from apps.client_registry.models import AllergyRecord, Patient
from apps.ipd_ward.models import Admission, Bed, MedicationAdministration, Ward
from apps.tenancy.context import platform_admin_context

from . import interventions as iv
from .models import MedicationHistoryEntry
from .test_care_plan import CarePlanTestCase


class ObservationTests(CarePlanTestCase):
    def post(self, name, body):
        return self.client.post(reverse(name, args=[self.pid]), body, format="json", **self.auth)

    def state(self):
        return self.client.get(reverse("care-observation", args=[self.pid]), **self.auth).data

    def test_no_level_until_one_is_set_then_changes_need_a_reason(self):
        self.assertIsNone(self.state()["level"])
        self.assertEqual(self.post("care-observation-level", {"level": "EYESIGHT"}).status_code, 400)
        self.assertEqual(self.post("care-observation-level", {"level": "NOPE", "reason": "x"}).status_code, 400)
        ok = self.post("care-observation-level", {"level": "EYESIGHT", "reason": "Suicidal thoughts with plan"})
        self.assertEqual(ok.status_code, 201)
        self.assertEqual(ok.data["level"]["display"], "Within eyesight (continuous)")
        self.assertEqual(self.post("care-observation-level", {"level": "EYESIGHT", "reason": "again"}).status_code, 400)
        self.post("care-observation-level", {"level": "GENERAL_HOURLY", "reason": "Step-down after review"})
        self.assertEqual(self.state()["level"]["code"], "GENERAL_HOURLY")

    def test_entries_need_a_real_observation_and_set_the_next_due_time(self):
        self.post("care-observation-level", {"level": "INTERMITTENT_15", "reason": "Distress"})
        self.assertEqual(self.post("care-observation-entries", {"location": "Quiet room", "note": ""}).status_code, 400)
        self.assertEqual(self.post("care-observation-entries", {"location": "Nowhere", "note": "x"}).status_code, 400)
        self.assertEqual(
            self.post("care-observation-entries", {"location": "Quiet room", "engagement": "Asleep — breathing observed", "note": ""}).status_code,
            201,
        )
        state = self.client.get(reverse("care-observation", args=[self.pid]), **self.auth).data
        self.assertEqual(len(state["entries"]), 1)
        self.assertFalse(state["overdue"])

    def test_an_entry_goes_overdue_and_continuous_observers_must_rotate(self):
        self.post("care-observation-level", {"level": "ARMS_LENGTH", "reason": "High risk"})
        self.post("care-observation-handover", {"observer_name": "Mary", "observer_gender": "Female"})
        past = timezone.now() - timedelta(minutes=200)
        with platform_admin_context():
            from .models import ObservationLevelChange, ObserverHandover

            ObservationLevelChange.objects.filter(patient_id=self.pid).update(changed_at=past)
            ObserverHandover.objects.filter(patient_id=self.pid).update(since=past)
        state = self.state()
        self.assertTrue(state["overdue"])
        self.assertTrue(state["rotation_overdue"])
        self.assertEqual(state["observer"]["name"], "Mary")
        self.assertEqual(self.post("care-observation-handover", {"observer_name": ""}).status_code, 400)

    def test_config_is_served_and_labelled_illustrative(self):
        config = self.client.get(reverse("care-observation-config"), **self.auth).data
        self.assertEqual(len(config["levels"]), 4)
        self.assertEqual(config["approval"], "illustrative")


class ObservationSetTests(CarePlanTestCase):
    def record(self, **body):
        return self.client.post(reverse("care-observation-sets", args=[self.pid]), body, format="json", **self.auth)

    def test_a_full_set_scores_the_ews_and_unmeasured_items_are_reported(self):
        response = self.record(
            heart_rate=118, respiratory_rate=22, systolic_bp=150, spo2=96, temperature_c=37.0,
            consciousness="A", not_measured={"blood_glucose_mmol": "Declined"},
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["ews"]["score"], 4)
        self.assertTrue(response.data["ews"]["complete"])
        self.assertEqual(response.data["not_measured"], {"blood_glucose_mmol": "Declined"})

    def test_impossible_values_are_refused_unusual_ones_warn(self):
        self.assertEqual(self.record(heart_rate=999).status_code, 400)
        self.assertEqual(self.record(heart_rate="abc").status_code, 400)
        self.assertEqual(self.record().status_code, 400)
        self.assertEqual(self.record(heart_rate=60, consciousness="Z").status_code, 400)
        self.assertEqual(self.record(heart_rate=60, not_measured={"spo2": "Because"}).status_code, 400)
        warned = self.record(heart_rate=160, consciousness="A")
        self.assertEqual(warned.status_code, 201)
        self.assertIn("unusual", warned.data["warnings"][0])
        self.assertFalse(warned.data["ews"]["complete"])  # missing parameters are not normal


class PrescribingChecksTests(CarePlanTestCase):
    def check(self, drug):
        return self.client.post(
            reverse("care-prescribing-checks", args=[self.pid]), {"drug": drug}, format="json", **self.auth
        )

    def test_an_allergy_match_is_blocking_and_says_if_it_is_unconfirmed(self):
        with platform_admin_context():
            AllergyRecord.objects.create(
                organization=self.org, patient=Patient.objects.get(pk=self.pid),
                substance="Penicillin", verification_status="UNCONFIRMED",
            )
        result = self.check("Penicillin V").data
        self.assertIn("unconfirmed", result["blocking"][0])
        self.assertTrue(any("not yet clinically confirmed" in w for w in result["warnings"]))

    def test_duplicates_on_the_medication_list_warn(self):
        with platform_admin_context():
            MedicationHistoryEntry.objects.create(
                organization=self.org, patient=Patient.objects.get(pk=self.pid),
                name="Sertraline", dose="50 mg", frequency="OD",
            )
        self.assertIn("Duplicate", self.check("sertraline").data["warnings"][0])

    def test_every_result_states_what_was_not_checked(self):
        result = self.check("Olanzapine").data
        self.assertEqual(result["blocking"], [])
        self.assertIn("NOT checked", result["not_checked"][0])
        self.assertEqual(self.check("").status_code, 400)


class MarTests(CarePlanTestCase):
    def setUp(self):
        super().setUp()
        with platform_admin_context():
            ward = Ward.objects.create(organization=self.org, name="Ward")
            bed = Bed.objects.create(organization=self.org, ward=ward, bed_number="1", status="OCCUPIED")
            self.admission = Admission.objects.create(
                organization=self.org, patient=Patient.objects.get(pk=self.pid), bed=bed, admitted_by=self.nurse
            )

    def entry(self, minutes_ago=0, **extra):
        with platform_admin_context():
            return MedicationAdministration.objects.create(
                organization=self.org, admission=self.admission,
                scheduled_time=timezone.now() - timedelta(minutes=minutes_ago), **extra,
            )

    def give(self, entry, outcome="ADMINISTERED", **body):
        return self.client.post(
            reverse("care-mar-administer", args=[entry.pk]), {"outcome": outcome, **body}, format="json", **self.auth
        )

    def test_slot_states_follow_the_time_windows(self):
        now = timezone.now()
        cases = {-120: "future", 30: "due", 120: "late", 400: "missed"}
        for minutes, expected in cases.items():
            entry = self.entry(minutes)
            self.assertEqual(iv.slot_state(entry, now), expected, minutes)
        self.assertEqual(iv.slot_state(self.entry(10, status="ADMINISTERED"), now), "given")

    def test_declined_or_withheld_needs_a_reason_and_given_is_recorded_with_who_and_when(self):
        entry = self.entry(10)
        self.assertEqual(self.give(entry, "REFUSED").status_code, 400)
        self.assertEqual(self.give(entry, "MAYBE").status_code, 400)
        done = self.give(entry, "ADMINISTERED")
        self.assertEqual(done.status_code, 200, done.data)
        row = next(r for r in done.data["entries"] if r["id"] == str(entry.pk))
        self.assertEqual((row["status"], row["by"]), ("ADMINISTERED", "Jane Njoroge"))
        self.assertEqual(self.give(entry, "ADMINISTERED").status_code, 400)  # already recorded

    def test_a_controlled_drug_needs_a_witness_and_a_prn_needs_an_indication(self):
        controlled = self.entry(10, controlled_drug=True)
        self.assertEqual(self.give(controlled).status_code, 400)
        self.assertEqual(self.give(controlled, witness_name="K. Mutua").status_code, 200)
        prn = self.entry(10, is_prn=True)
        self.assertEqual(self.give(prn).status_code, 400)
        self.assertEqual(self.give(prn, prn_indication="Acute agitation").status_code, 200)

    def test_a_given_prn_dose_awaits_an_effect_check_that_is_then_recorded(self):
        prn = self.entry(10, is_prn=True)
        pending = self.give(prn, prn_indication="Agitation").data["pending_effects"]
        self.assertEqual(len(pending), 1)
        url = reverse("care-mar-effect", args=[prn.pk])
        self.assertEqual(self.client.post(url, {"effect": ""}, format="json", **self.auth).status_code, 400)
        done = self.client.post(url, {"effect": "Calmer within 40 minutes"}, format="json", **self.auth)
        self.assertEqual(done.data["pending_effects"], [])
        plain = self.entry(10)
        self.give(plain)
        self.assertEqual(
            self.client.post(reverse("care-mar-effect", args=[plain.pk]), {"effect": "x"}, format="json", **self.auth).status_code, 400
        )

    def test_a_client_who_is_not_admitted_has_no_mar(self):
        with platform_admin_context():
            Admission.objects.filter(pk=self.admission.pk).update(status="DISCHARGED")
        self.assertIsNone(self.client.get(reverse("care-mar", args=[self.pid]), **self.auth).data["admission"])


class RestrictivePracticeTests(CarePlanTestCase):
    def body(self, **over):
        return {
            "kind": "RAPID_TRANQUILLISATION",
            "de_escalation": ["Verbal de-escalation"],
            "authorised_by": str(self.psych.pk),
            "start_at": timezone.now().isoformat(),
            "injury_check": "NONE",
            **over,
        }

    def post(self, **over):
        return self.client.post(reverse("care-restrictive", args=[self.pid]), self.body(**over), format="json", **self.auth)

    def test_de_escalation_authoriser_start_and_injury_check_are_required(self):
        for over in ({"de_escalation": []}, {"kind": "NOPE"}, {"authorised_by": ""}, {"start_at": ""}, {"injury_check": ""}):
            self.assertEqual(self.post(**over).status_code, 400, over)

    def test_recording_schedules_the_configured_timed_checks_and_logs_them_done(self):
        created = self.post()
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(len(created.data["checks"]), 4)
        self.assertEqual(created.data["authorised_by"], "Dr Senior")
        check_id = created.data["checks"][0]["id"]
        done = self.client.post(reverse("care-restrictive-check", args=[check_id]), **self.auth)
        self.assertEqual(done.data["checks"][0]["done_by"], "Jane Njoroge")
        self.assertEqual(self.client.post(reverse("care-restrictive-check", args=[check_id]), **self.auth).status_code, 400)

    @override_settings(RESTRICTIVE_CHECK_MINUTES={})
    def test_no_checks_are_invented_when_none_are_configured(self):
        self.assertEqual(self.post().data["checks"], [])

    def test_seclusion_past_the_maximum_demands_senior_review_until_it_ends(self):
        old = (timezone.now() - timedelta(hours=9)).isoformat()
        created = self.post(kind="SECLUSION", start_at=old)
        self.assertTrue(created.data["senior_review_due"])
        ended = self.client.post(reverse("care-restrictive-end", args=[created.data["id"]]), **self.auth)
        self.assertFalse(ended.data["senior_review_due"])
        self.assertEqual(self.client.post(reverse("care-restrictive-end", args=[created.data["id"]]), **self.auth).status_code, 400)

    def test_client_debrief_is_recorded(self):
        created = self.post()
        self.assertIsNone(created.data["client_debrief_at"])
        done = self.client.post(reverse("care-restrictive-debrief", args=[created.data["id"]]), **self.auth)
        self.assertIsNotNone(done.data["client_debrief_at"])
        listing = self.client.get(reverse("care-restrictive", args=[self.pid]), **self.auth).data
        self.assertEqual(len(listing["results"]), 1)


class SbarTests(CarePlanTestCase):
    def test_sbar_is_built_from_the_record_with_nothing_retyped(self):
        self.sign_triage(d_suicidal="yes", c_concern="Low mood and drinking")
        self.draft()
        self.save(sections={"mse": {"mood": "Low"}, "close": {"message": "Needs review at 08:00"}})
        with platform_admin_context():
            MedicationHistoryEntry.objects.create(
                organization=self.org, patient=Patient.objects.get(pk=self.pid), name="Sertraline", dose="50 mg"
            )
        text = self.client.get(reverse("care-sbar", args=[self.pid]), **self.auth).data["text"]
        for fragment in ("SITUATION", "BACKGROUND", "ASSESSMENT", "RECOMMENDATION", "Low mood and drinking",
                         "Sertraline 50 mg", "mood Low", "Needs review at 08:00", "Prepared by Jane Njoroge"):
            self.assertIn(fragment, text)
        self.assertIn("Priority Urgent", text)
