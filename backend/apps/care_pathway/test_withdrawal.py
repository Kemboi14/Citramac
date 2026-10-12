"""Withdrawal charting: CIWA-Ar / COWS item scoring, bands, unable-to-score, protocol-driven due times."""

from datetime import timedelta

from django.test import override_settings
from django.urls import reverse
from django.utils import timezone

from . import instruments
from .test_care_plan import CarePlanTestCase


class WithdrawalTests(CarePlanTestCase):
    def assess(self, instrument, answers):
        return self.client.post(
            reverse("care-client-assessments", args=[self.pid]),
            {"instrument": instrument, "answers": answers},
            format="json",
            **self.auth,
        )

    def status(self):
        return self.client.get(reverse("care-client-withdrawal", args=[self.pid]), **self.auth).data["scales"]

    def test_scales_are_defined_with_the_expected_shape_and_max(self):
        ciwa, cows = instruments.INSTRUMENTS["CIWA"], instruments.INSTRUMENTS["COWS"]
        self.assertEqual((len(ciwa["items"]), len(cows["items"])), (10, 11))
        self.assertEqual(ciwa["max"], 67)
        self.assertEqual(cows["max"], 48)
        self.assertEqual(ciwa["approval"], "illustrative")
        self.assertEqual(
            sum(max(p for p, _ in item["options"]) for item in cows["items"]), cows["max"]
        )

    def test_ciwa_totals_bands_and_rejects_impossible_points(self):
        ok = self.assess("CIWA", [1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
        self.assertEqual(ok.status_code, 201, ok.data)
        self.assertEqual(ok.data["score"], 10)
        self.assertEqual(instruments.band_for("CIWA", 10), "Mild–moderate")
        self.assertEqual(instruments.band_for("CIWA", 16), "Severe")
        self.assertEqual(self.assess("CIWA", [5] + [0] * 9).status_code, 201)  # between anchors is allowed
        self.assertEqual(self.assess("CIWA", [0] * 9 + [5]).status_code, 400)  # orientation tops at 4
        self.assertEqual(self.assess("CIWA", [0] * 9).status_code, 400)

    def test_cows_only_accepts_the_points_that_exist_for_each_item(self):
        self.assertEqual(self.assess("COWS", [0] * 11).data["score"], 0)
        self.assertEqual(self.assess("COWS", [3] + [0] * 10).status_code, 400)  # pulse has no 3

    def test_no_protocol_means_no_threshold_flag_and_no_due_time(self):
        self.assess("CIWA", [4] * 9 + [4])
        scale = self.status()[0]
        self.assertFalse(scale["protocolConfigured"])
        self.assertIsNone(scale["nextDueAt"])
        self.assertEqual(scale["flags"], [])
        self.assertEqual(scale["latest"]["band"], "Severe")

    def test_configured_protocol_sets_flags_and_due_time(self):
        cfg = {"CIWA": {"prn_threshold": 8, "severe_threshold": 20, "rescore_minutes_high": 60, "rescore_minutes_low": 240}}
        with override_settings(WITHDRAWAL_PROTOCOL=cfg):
            self.assess("CIWA", [1] * 10)
            scale = self.status()[0]
            self.assertTrue(any("PRN" in f for f in scale["flags"]))
            self.assertFalse(any("severe" in f for f in scale["flags"]))
            due = timezone.now() + timedelta(minutes=60)
            self.assertLess(abs((scale["nextDueAt"] - due).total_seconds()), 120)

    def test_unable_to_score_is_recorded_with_a_reason_and_prompts_a_retry(self):
        url = reverse("care-client-withdrawal", args=[self.pid])
        self.assertEqual(self.client.post(url, {"instrument": "CIWA", "reason": "nope"}, format="json", **self.auth).status_code, 400)
        self.assertEqual(self.client.post(url, {"instrument": "PHQ9", "reason": "SEDATED"}, format="json", **self.auth).status_code, 400)
        self.assertEqual(self.client.post(url, {"instrument": "CIWA", "reason": "SEDATED"}, format="json", **self.auth).status_code, 201)
        scale = self.status()[0]
        self.assertEqual(scale["lastAttempt"]["reason"], "SEDATED")
        self.assertIsNone(scale["latest"])
        self.assertTrue(any("could not be scored" in f for f in scale["flags"]))
        self.assertIsNotNone(scale["nextDueAt"])
