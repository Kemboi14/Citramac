"""Assessment tools, outcome scoring and the early warning score."""

from django.test import SimpleTestCase
from django.urls import reverse

from apps.tenancy.context import platform_admin_context
from apps.triage.models import VitalSigns

from . import ews, instruments
from .intake_schema import _code
from .models import ApprovedAssessment, OutcomeScore
from .test_intake import IntakeTestCase


class InstrumentScoringTests(SimpleTestCase):
    def test_items_are_summed_and_banded(self):
        total, items = instruments.score_items("PHQ9", [1, 2, 3, 0, 1, 2, 3, 0, 1])
        self.assertEqual(total, 13)
        self.assertEqual(instruments.band_for("PHQ9", total), "Moderate")
        self.assertEqual(items[2], 3)

    def test_wrong_item_count_or_answer_is_refused(self):
        with self.assertRaises(ValueError):
            instruments.score_items("GAD7", [1, 2, 3])
        with self.assertRaises(ValueError):
            instruments.score_items("GAD7", [0, 0, 0, 0, 0, 0, 4])

    def test_total_only_instruments_validate_range(self):
        self.assertEqual(instruments.validate_total("PCL5", 40), 40)
        for bad in (-1, 81, "9", True):
            with self.assertRaises(ValueError):
                instruments.validate_total("PCL5", bad)

    def test_phq9_item_nine_is_flagged_never_auto_actioned(self):
        _total, items = instruments.score_items("PHQ9", [0] * 8 + [1])
        self.assertEqual(len(instruments.result_flags("PHQ9", items)), 1)
        _total, items = instruments.score_items("PHQ9", [3] * 8 + [0])
        self.assertEqual(instruments.result_flags("PHQ9", items), [])

    def test_change_is_stated_in_words_with_reliable_and_clinical_significance(self):
        self.assertEqual(instruments.change_text("PHQ9", [14])["text"], "Baseline only")
        better = instruments.change_text("PHQ9", [14, 9])
        self.assertEqual(better["text"], "Improved 5 points · reliable change · clinically significant (now below 10)")
        self.assertTrue(better["clinically_significant"])
        small = instruments.change_text("PHQ9", [14, 12])
        self.assertEqual((small["text"], small["reliable"]), ("Improved 2 points", False))
        self.assertEqual(instruments.change_text("PHQ9", [5, 12])["direction"], "bad")
        # A recovery index improves upward.
        self.assertEqual(instruments.change_text("CRI", [30, 60])["direction"], "good")

    def test_every_definition_is_labelled_with_its_approval_state(self):
        approvals = {s["code"]: s["approval"] for s in instruments.served()}
        self.assertEqual(approvals["PHQ9"], "approved")
        self.assertEqual(approvals["PCL5"], "illustrative")  # VERIFY: clinical approval pending
        self.assertEqual(approvals["CIWA"], "illustrative")  # VERIFY: clinical approval pending
        self.assertEqual(approvals["COWS"], "illustrative")


class EarlyWarningScoreTests(SimpleTestCase):
    NORMAL = {"rr": 16, "spo2": 98, "sbp": 120, "hr": 70, "temp": 36.8, "consciousness": "A"}

    def test_a_normal_set_scores_zero_and_is_complete(self):
        result = ews.score(self.NORMAL)
        self.assertEqual((result["score"], result["complete"]), (0, True))
        self.assertEqual(result["response"]["tone"], "ok")

    def test_bands_and_oxygen_add_up(self):
        result = ews.score({**self.NORMAL, "rr": 25, "spo2": 94, "hr": 100, "supplemental_o2": True})
        # rr 25→3, spo2 94→1, hr 100→1, plus 2 for oxygen
        self.assertEqual(result["score"], 7)
        self.assertIn("emergency", result["response"]["text"])

    def test_a_single_parameter_of_three_escalates_even_with_a_low_total(self):
        result = ews.score({**self.NORMAL, "sbp": 85})
        self.assertEqual(result["score"], 3)
        self.assertTrue(result["single_parameter_3"])
        self.assertIn("urgent medical review", result["response"]["text"])

    def test_unmeasured_is_incomplete_not_normal(self):
        result = ews.score({"hr": 70})
        self.assertEqual((result["measured"], result["complete"]), (1, False))
        self.assertIn("incomplete", result["label"])
        empty = ews.score({})
        self.assertEqual(empty["response"]["tone"], "warn")
        self.assertEqual(empty["score"], 0)

    def test_new_confusion_scores_three(self):
        self.assertEqual(ews.score({**self.NORMAL, "consciousness": "C"})["parts"]["acvpu"], 3)

    def test_result_carries_its_version_and_approval_state(self):
        result = ews.score(self.NORMAL)
        self.assertEqual(result["approval"], "illustrative")  # VERIFY: clinical approval


class ToolsApiTests(IntakeTestCase):
    def tools(self):
        data = self.client.get(reverse("care-client-tools", args=[self.pid]), **self.auth).data
        return {t["key"]: t for t in data["results"]}

    def decide(self, tool, status, reason=""):
        return self.client.post(
            reverse("care-client-tool-decision", args=[self.pid, tool]),
            {"status": status, "reason": reason},
            format="json",
            **self.auth,
        )

    def assess(self, **body):
        return self.client.post(
            reverse("care-client-assessments", args=[self.pid]), body, format="json", **self.auth
        )

    def test_nothing_is_recommended_without_findings(self):
        self.assertEqual({t["status"] for t in self.tools().values()}, {"Not indicated"})

    def test_findings_recommend_tools_with_the_reason_shown(self):
        self.draft()
        self.save(
            sections={
                "sx": {"list": [_code("Low mood"), _code("Panic")]},
                "risk": {"rows": {"suicide": ["Thoughts"]}},
            }
        )
        tools = self.tools()
        self.assertEqual(tools["PHQ9"]["status"], "Recommended")
        self.assertIn("low mood", tools["PHQ9"]["why"][0])
        self.assertEqual(tools["GAD7"]["status"], "Recommended")
        self.assertEqual(tools["SRA"]["status"], "Recommended")
        self.assertEqual(tools["SAFETY"]["status"], "Recommended")
        self.assertEqual(tools["PAWSS"]["status"], "Not indicated")

    def test_an_adolescent_gets_the_adolescent_depression_tool(self):
        from apps.client_registry.models import Patient

        with platform_admin_context():
            from datetime import date

            Patient.objects.filter(pk=self.pid).update(date_of_birth=date(date.today().year - 15, 1, 1))
        self.draft()
        self.save(sections={"sx": {"list": [_code("Low mood")]}})
        tools = self.tools()
        self.assertEqual(tools["PHQA"]["status"], "Recommended")
        self.assertEqual(tools["PHQ9"]["status"], "Not indicated")

    def test_alcohol_use_recommends_pawss_and_auditc_but_not_withdrawal_scales(self):
        self.draft()
        self.save(sections={"subs": {"kind": _code("Alcohol")}})
        tools = self.tools()
        self.assertEqual((tools["PAWSS"]["status"], tools["AUDITC"]["status"]), ("Recommended",) * 2)
        self.assertNotIn("CIWA", tools)

    def test_declining_needs_a_reason_and_is_reversible(self):
        self.draft()
        self.save(sections={"sx": {"list": [_code("Low mood")]}})
        self.assertEqual(self.decide("PHQ9", "DECLINED").status_code, 400)
        self.assertEqual(self.decide("PHQ9", "DECLINED", "Client too distressed today").status_code, 201)
        declined = self.tools()["PHQ9"]
        self.assertEqual(declined["status"], "Declined")
        self.assertEqual(declined["decision"]["reason"], "Client too distressed today")
        self.decide("PHQ9", "RECONSIDERED")
        self.assertEqual(self.tools()["PHQ9"]["status"], "Recommended")
        self.assertEqual(self.decide("NOPE", "ACCEPTED").status_code, 400)

    def test_undecided_recommendation_blocks_a_complete_intake_but_decline_clears_it(self):
        self.draft()
        self.complete_required()
        self.save(sections={"sx": {"list": [_code("Low mood")]}})
        blocked = self.sign_intake()
        self.assertEqual(blocked.status_code, 400)
        self.assertTrue(any("recommended tools: PHQ9" in o for o in blocked.data["outstanding"]))
        self.decide("PHQ9", "DECLINED", "Not appropriate this visit")
        self.assertEqual(self.sign_intake().status_code, 200)

    def test_recording_items_stores_them_flags_item_nine_and_completes_the_tool(self):
        self.draft()
        self.save(sections={"sx": {"list": [_code("Low mood")]}})
        answers = [1, 2, 1, 1, 0, 2, 1, 0, 1]
        response = self.assess(instrument="PHQ9", answers=answers, context="intake")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual((response.data["score"], response.data["items"]), (9, answers))
        self.assertEqual(len(response.data["flags"]), 1)
        self.assertEqual(self.tools()["PHQ9"]["status"], "Completed")

    def test_bad_answers_totals_and_unknown_instruments_are_refused(self):
        self.assertEqual(self.assess(instrument="PHQ9", answers=[1, 2]).status_code, 400)
        self.assertEqual(self.assess(instrument="PHQ9", answers=[0] * 8 + [7]).status_code, 400)
        self.assertEqual(self.assess(instrument="PCL5", total=999).status_code, 400)
        self.assertEqual(self.assess(instrument="NOPE", total=3).status_code, 400)
        with platform_admin_context():
            self.assertEqual(OutcomeScore.objects.filter(patient_id=self.pid).count(), 0)

    def test_summary_reports_baseline_latest_band_and_change_in_words(self):
        for answers in ([2, 2, 2, 2, 2, 1, 1, 1, 1], [1, 1, 1, 1, 1, 0, 0, 0, 0]):  # 14 then 5
            self.assess(instrument="PHQ9", answers=answers)
        with platform_admin_context():  # PCL-5 needs the organisation's approval
            ApprovedAssessment.objects.create(
                organization=self.org, purpose="TRAUMA", instrument="PCL5", clinical_lead="Dr A"
            )
        self.assess(instrument="PCL5", total=40)
        data = self.client.get(reverse("care-client-outcomes", args=[self.pid]), **self.auth).data
        phq = next(s for s in data["summary"] if s["instrument"] == "PHQ9")
        self.assertEqual((phq["baseline"]["score"], phq["latest"]["score"]), (14, 5))
        self.assertEqual(phq["latest"]["band"], "Mild")
        self.assertIn("clinically significant", phq["change"]["text"])
        self.assertEqual(len(phq["series"]), 2)
        pcl = next(s for s in data["summary"] if s["instrument"] == "PCL5")
        self.assertEqual(pcl["approval"], "illustrative")

    def test_definitions_are_served(self):
        response = self.client.get(reverse("care-instruments"), **self.auth)
        codes = [i["code"] for i in response.data["results"]]
        self.assertIn("PHQ9", codes)
        phq = next(i for i in response.data["results"] if i["code"] == "PHQ9")
        self.assertEqual(len(phq["items"]), 9)
        self.assertEqual(response.data["ews"]["approval"], "illustrative")


class VitalsEwsEndpointTests(IntakeTestCase):
    def test_vitals_carry_an_ews_per_observation_set(self):
        from apps.care_pathway import services
        from apps.client_registry.models import Patient

        with platform_admin_context():
            patient = Patient.objects.get(pk=self.pid)
            episode = services.get_or_open_episode(patient, self.nurse)
            encounter = services.clinical_encounter_for(patient, episode, self.nurse)
            VitalSigns.objects.create(
                organization=self.org, encounter=encounter, heart_rate=118, respiratory_rate=22,
                systolic_bp=150, spo2=96, temperature_c="37.0", consciousness="A",
            )
        rows = self.client.get(reverse("care-client-vitals", args=[self.pid]), **self.auth).data["results"]
        self.assertEqual(rows[-1]["ews"]["score"], 4)  # hr 118→2, rr 22→2
        self.assertTrue(rows[-1]["ews"]["complete"])
