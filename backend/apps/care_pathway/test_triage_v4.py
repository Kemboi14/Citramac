"""Triage v4 (triage_v4.py): ladder, preparatory behaviour, lethality, EWS →
priority, glucose, remote triggers (AT-08), hidden fields (X-08), downgrade
co-sign, override audit (AT-05), summary rows (AT-20), live queue order, and
v3 records left unchanged."""

import uuid
from datetime import timedelta

from django.test import SimpleTestCase
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import platform_admin_context
from apps.triage.models import VitalSigns

from . import facility_time, triage_queue, triage_rules
from . import triage_v4 as v4
from .models import (
    CareTask,
    ClinicalAlert,
    CosignRequest,
    ObservationLevelChange,
    TriageAssessment,
    TriageEncounter,
)
from .tests import CORE_NO, CarePathwayApiTestCase

BASE = {
    "schema": "v4",
    "b_informant": "client",
    "b_present": "yes",
    "c_concern": "Low mood",
    "distress": "LOW",
    "screen_self": "no",
    "screen_others": "no",
    "screen_medical": "no",
    "screen_safeguarding": "no",
}
FULL_VITALS = {
    "v_hr": "80", "v_sbp": "120", "v_dbp": "80", "v_rr": "16",
    "v_temp": "37", "v_spo2": "98", "acvpu": "A", "v_o2": "room_air",
}
SAFETY = {"safety_obs": "ARMS_LENGTH", "safety_location": "QUIET_ROOM", "safety_observer": "L. Wambui"}


def rec(**answers):
    return v4.evaluate({**BASE, **answers})


class RulesetTests(SimpleTestCase):
    def test_ruleset_is_labelled_and_versioned(self):
        result = rec()
        self.assertEqual(result["rules_version"], "v4-demo")
        self.assertEqual(result["ruleset_label"], "DEMO RULESET — REQUIRES CLINICAL GOVERNANCE SIGN-OFF")
        self.assertEqual(result["recommendation"], "GREEN")

    def test_suicidality_ladder(self):
        expected = {"none": "GREEN", "passive": "YELLOW", "active": "ORANGE", "plan": "ORANGE", "intent": "RED"}
        for level, priority in expected.items():
            self.assertEqual(rec(screen_self="yes", suic=level)["priority"], priority, level)

    def test_plan_with_lethal_means_is_red_and_means_alone_is_yellow(self):
        self.assertEqual(rec(screen_self="yes", suic="plan", flags=["lethal_means"])["priority"], "RED")
        self.assertEqual(rec(screen_self="yes", flags=["lethal_means"])["priority"], "YELLOW")

    def test_preparatory_behaviour_is_red(self):
        result = rec(screen_self="yes", suic="passive", prep="yes")
        self.assertEqual(result["priority"], "RED")
        self.assertIn("Preparatory behaviour for suicide", result["reasons"])

    def test_self_harm_lethality(self):
        self.assertEqual(rec(screen_self="yes", selfharm="low")["priority"], "ORANGE")
        self.assertEqual(rec(screen_self="yes", selfharm="high")["priority"], "RED")

    def test_flags_only_count_when_their_screen_is_yes(self):
        self.assertEqual(rec(flags=["seizure"])["priority"], "GREEN")
        self.assertEqual(rec(screen_medical="yes", flags=["seizure"])["priority"], "RED")
        self.assertEqual(rec(screen_medical="yes", flags=["pregnancy"])["priority"], "YELLOW")

    def test_ews_drives_priority(self):
        self.assertEqual(rec(**FULL_VITALS)["priority"], "GREEN")
        # RR 22 → 2, HR 105 → 1: EWS 3 → ORANGE.
        self.assertEqual(rec(**{**FULL_VITALS, "v_rr": "22", "v_hr": "105"})["priority"], "ORANGE")
        # A single parameter scoring 3 (SpO2 90) → ORANGE.
        self.assertEqual(rec(**{**FULL_VITALS, "v_spo2": "90"})["priority"], "ORANGE")
        # EWS ≥ 5 → RED; ACVPU other than A → RED.
        self.assertEqual(rec(**{**FULL_VITALS, "v_rr": "26", "v_hr": "135"})["priority"], "RED")
        self.assertEqual(rec(**{**FULL_VITALS, "acvpu": "C"})["priority"], "RED")

    def test_low_glucose_is_red(self):
        result = rec(v_glucose="3.2")
        self.assertEqual(result["priority"], "RED")
        self.assertIn("Hypoglycaemia", result["reasons"])

    def test_incomplete_ews_is_labelled(self):
        self.assertIn("incomplete", rec(v_hr="80")["ews"]["label"])

    def test_opioid_only_withdrawal_is_yellow_alcohol_orange(self):
        common = {"subst_recent": "yes", "subst_withdrawal_signs": "yes"}
        self.assertEqual(rec(**common, subst_which=["opioids"])["priority"], "YELLOW")
        self.assertEqual(rec(**common, subst_which=["alcohol"])["priority"], "ORANGE")

    def test_remote_triggers_fire_with_third_party_source(self):
        """AT-08: same triggers, source THIRD_PARTY_REPORT, no vitals."""
        result = v4.evaluate({
            **BASE, "b_present": "no", "b_informant": "family", "b_third_party": "Sister",
            "r_suicide": "talked", "r_means": "yes", "r_disposition": "brought",
            "v_hr": "200", "flags": ["seizure"],
        })
        self.assertEqual(result["priority"], "RED")
        self.assertIn("SUICIDE_RISK", [a["code"] for a in result["alerts"]])
        self.assertIsNone(result["ews"])
        sources = {i["source_code"] for i in result["finding_items"] if i["finding"] != "Vital signs"}
        self.assertEqual(sources - {"CLINICIAN_OBSERVATION"}, {"THIRD_PARTY_REPORT"})

    def test_remote_post_rules(self):
        remote = {**BASE, "b_present": "no", "r_suicide": "unknown", "r_disposition": "brought"}
        self.assertEqual(v4.evaluate(remote)["priority"], "YELLOW")
        self.assertEqual(v4.evaluate({**remote, "r_responsible": "no"})["priority"], "ORANGE")
        self.assertEqual(v4.evaluate({**remote, "r_disposition": "emergency"})["priority"], "RED")

    def test_hidden_fields_are_not_submitted(self):
        """X-08: present = no drops observation and vitals; screen No drops its flags."""
        cleaned = v4.clean_answers({**BASE, "b_present": "no", "v_hr": "80", "acvpu": "A", "flags": ["seizure"]})
        self.assertNotIn("v_hr", cleaned)
        self.assertNotIn("acvpu", cleaned)
        self.assertNotIn("flags", cleaned)
        cleaned = v4.clean_answers({**BASE, "r_suicide": "talked", "flags": ["seizure"], "suic": "plan"})
        self.assertNotIn("r_suicide", cleaned)
        self.assertEqual(cleaned["flags"], [])
        self.assertNotIn("suic", cleaned)

    def test_vital_range_checks(self):
        problems = v4.vital_problems({"v_hr": "400"})
        self.assertIn("not a possible value", problems[0][0])
        self.assertIn("unusual", v4.vital_problems({"v_hr": "160"})[0][0])
        self.assertEqual(v4.vital_problems({"v_hr": "160", "vconf": ["v_hr"]}), [])
        self.assertIn("both", v4.vital_problems({"v_sbp": "120"})[0][0])

    def test_v3_rules_are_unchanged(self):
        self.assertEqual(triage_rules.RULES_VERSION, "2026-10-07.1")
        self.assertEqual(triage_rules.evaluate(CORE_NO)["recommendation"], "GREEN")


class TriageV4ApiTests(CarePathwayApiTestCase):
    def setUp(self):
        super().setUp()
        self.te_id = self.register().data["triage_encounter_id"]
        with platform_admin_context():
            self.psych = User.objects.create_user(
                email=f"psych-{uuid.uuid4().hex[:6]}@org.test", password="Password123!",
                organization=self.org, is_active=True, first_name="Dr", last_name="Senior",
            )
            role, _ = Role.objects.get_or_create(name="Psychiatrist", defaults={"scope": Role.SCOPE_ORG_TEMPLATE})
            self.psych.roles.add(role)
        self.psych_auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(self.psych)[0]}"}

    def sign_v4(self, answers, priority=None, auth=None, te_id=None, **extra):
        body = {"answers": answers, **extra}
        if priority:
            body["final_priority"] = priority
        return self.client.post(
            reverse("care-triage-sign", args=[te_id or self.te_id]), body, format="json", **(auth or self.auth)
        )

    def test_new_triage_opens_on_v5_and_a_v4_draft_still_signs_on_v4(self):
        # Since 2026-10-28 new triages use the v5 rule set (test_triage_v5.py);
        # an answer set still marked v4 is signed by the v4 rules (this file).
        data = self.client.get(reverse("care-triage", args=[self.te_id]), **self.auth).data
        self.assertEqual(data["schema"], "v5")
        self.assertEqual(data["evaluation"]["rules_version"], "2026-10-28.2")
        config = self.client.get(reverse("care-triage-v4-config"), **self.auth).data
        self.assertEqual(len(config["flags"]), 24)

    def test_sign_stores_rules_version_vitals_and_stamped_summary(self):
        answers = {**BASE, **FULL_VITALS, "v_rr": "22", "v_hr": "105", **SAFETY}
        response = self.sign_v4(answers)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["rules_version"], "v4-demo")
        self.assertEqual(response.data["final_priority"], "ORANGE")
        detail = self.client.get(reverse("care-triage", args=[self.te_id]), **self.auth).data
        self.assertEqual(detail["schema"], "v4")
        # AT-20: every row has finding, status, source, time and recorder.
        for row in response.data["findings"]:
            self.assertEqual(len(row), 5)
            self.assertTrue(all(row[2:]))
        with platform_admin_context():
            te = TriageEncounter.objects.get(pk=self.te_id)
            vital = VitalSigns.objects.get(encounter=te.encounter)
            self.assertEqual((vital.consciousness, vital.supplemental_o2, vital.heart_rate), ("A", False, 105))
            self.assertEqual(ObservationLevelChange.objects.get(patient=te.patient).level, "ARMS_LENGTH")
            self.assertIn("ABNORMAL_VITALS", ClinicalAlert.objects.filter(patient=te.patient).values_list(
                "alert_code", flat=True))

    def test_orange_in_person_requires_waiting_room_safety(self):
        response = self.sign_v4({**BASE, "screen_self": "yes", "suic": "active"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("safety_obs", response.data["missing_keys"])

    def test_hard_range_vital_blocks_signing(self):
        response = self.sign_v4({**BASE, "v_hr": "400"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("v_hr", response.data["missing_keys"])

    def test_override_is_blocked_without_reason_and_audited(self):
        """AT-05."""
        answers = {**BASE, "screen_self": "yes", "suic": "passive"}  # YELLOW
        self.assertEqual(self.sign_v4(answers, priority="ORANGE").status_code, 400)
        response = self.sign_v4({**answers, **SAFETY}, priority="ORANGE",
                                 override_reason="Collateral history suggests rapid deterioration.")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["decision"], "OVERRIDE")
        with platform_admin_context():
            entry = AuditLogEntry.objects.filter(
                model="care_pathway.triageassessment", object_id=response.data["id"],
                field_diff__event="OVERRIDE",
            ).get()
            self.assertEqual(entry.field_diff["system_priority"], "YELLOW")
            self.assertEqual(entry.field_diff["final_priority"], "ORANGE")

    def test_downgrade_by_non_psychiatrist_requests_cosign(self):
        answers = {**BASE, "screen_self": "yes", "suic": "active"}  # ORANGE
        response = self.sign_v4(answers, priority="YELLOW",
                                override_reason="Long-standing thoughts, well supported at home today.")
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            req = CosignRequest.objects.get(kind="TRIAGE_DOWNGRADE")
            self.assertIn("ORANGE → YELLOW", req.what)

    def test_downgrade_by_psychiatrist_self_signs(self):
        answers = {**BASE, "screen_self": "yes", "suic": "active"}
        response = self.sign_v4(answers, priority="YELLOW", auth=self.psych_auth,
                                override_reason="Long-standing thoughts, well supported at home today.")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["answers"]["m_cosign"], "self")
        with platform_admin_context():
            self.assertFalse(CosignRequest.objects.filter(kind="TRIAGE_DOWNGRADE").exists())

    def test_remote_triage_writes_third_party_alerts_and_callback_task(self):
        """AT-08: client not present — no vitals, same alerts, timed call-back task."""
        callback = (facility_time.local_now() + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M")
        answers = {**BASE, "b_present": "no", "b_informant": "family", "b_third_party": "Sister — Jane",
                   "r_suicide": "talked", "r_disposition": "callback", "r_callback_at": callback,
                   "r_callback_owner": "triage_nurse", "v_hr": "80"}
        response = self.sign_v4(answers)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertNotIn("v_hr", response.data["answers"])
        self.assertIn("Third-party report", response.data["findings"][1][2])
        with platform_admin_context():
            te = TriageEncounter.objects.get(pk=self.te_id)
            self.assertFalse(VitalSigns.objects.filter(encounter=te.encounter).exists())
            self.assertIsNone(te.next_recheck_at)
            self.assertIn("SUICIDE_RISK", ClinicalAlert.objects.filter(patient=te.patient).values_list(
                "alert_code", flat=True))
            task = CareTask.objects.get(triage_encounter=te, focus_type="TRIAGE_CALLBACK")
            self.assertIsNotNone(task.due_at)

    def test_gbv_and_duty_to_protect_tasks(self):
        incident = (facility_time.local_now() - timedelta(hours=10)).strftime("%Y-%m-%dT%H:%M")
        answers = {**BASE, **SAFETY, "screen_others": "yes", "screen_safeguarding": "yes",
                   "flags": ["gbv_72h", "homicidal_named"], "gbv_incident_at": incident,
                   "duty_victim": "Neighbour", "duty_informed": "On-call psychiatrist"}
        response = self.sign_v4(answers)
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            pep = CareTask.objects.get(focus_type="PEP_EC_DECISION")
            self.assertAlmostEqual((pep.due_at - timezone.now()).total_seconds() / 3600, 62, delta=0.1)
            self.assertTrue(CareTask.objects.filter(focus_type="DUTY_TO_PROTECT").exists())
            self.assertTrue(CosignRequest.objects.filter(kind="DUTY_TO_PROTECT").exists())

    def test_v3_signed_record_is_never_re_evaluated(self):
        response = self.sign(self.te_id, {**CORE_NO, "d_suicidal": "yes"}, priority="ORANGE")
        self.assertEqual(response.status_code, 201)
        with platform_admin_context():
            a = TriageAssessment.objects.get(triage_encounter_id=self.te_id)
            self.assertEqual(a.rules_version, "2026-10-07.1")
        data = self.client.get(reverse("care-triage", args=[self.te_id]), **self.auth).data
        self.assertEqual(data["schema"], "v3")
        self.assertEqual(data["signed"]["rules_version"], "2026-10-07.1")
        self.assertEqual(data["signed"]["recommendation"], "ORANGE")

    def test_live_queue_lanes_and_order(self):
        second = self.register(full_name="Brian Otieno Mwangi")
        third = self.register(full_name="Carol Akinyi Omondi")
        self.assertEqual(self.sign_v4({**BASE}, te_id=second.data["triage_encounter_id"]).status_code, 201)
        red = {**BASE, **SAFETY, "screen_medical": "yes", "flags": ["seizure"]}
        self.assertEqual(self.sign_v4(red, te_id=third.data["triage_encounter_id"]).status_code, 201)
        data = self.client.get(reverse("care-live-queue"), **self.auth).data
        lanes = data["lanes"]
        self.assertEqual([r["id"] for r in lanes["awaiting"]], [self.te_id])
        self.assertEqual([r["priority"] for r in lanes["waiting"]], ["RED", "GREEN"])
        red_row = lanes["waiting"][0]
        self.assertRegex(red_row["privacy_name"], r"^CA · …")
        self.assertEqual(red_row["observation"]["observer"], "L. Wambui")
        # RED is "see now", so being seen leads; the incomplete EWS is also outstanding.
        self.assertIn("To be seen — RED", red_row["next_action"]["text"])
        with platform_admin_context():
            te = TriageEncounter.objects.get(pk=red_row["id"])
            texts = [i["text"] for i in triage_queue.te_items(te, timezone.now())]
        self.assertTrue(any(t.startswith("Complete vital signs — EWS incomplete") for t in texts))

    def test_retriage_overdue_flagged_on_worklist(self):
        red = {**BASE, **SAFETY, "screen_medical": "yes", "flags": ["seizure"]}
        self.assertEqual(self.sign_v4(red).status_code, 201)
        with platform_admin_context():
            TriageEncounter.objects.filter(pk=self.te_id).update(
                next_recheck_at=timezone.now() - timedelta(minutes=1)
            )
        row = self.client.get(reverse("care-triage-worklist"), **self.auth).data["results"][0]
        self.assertTrue(row["recheck_overdue"])
        self.assertTrue(row["is_overdue"])
        queue = self.client.get(reverse("care-live-queue"), **self.auth).data
        chips = [c["label"] for c in queue["lanes"]["waiting"][0]["attention"]]
        self.assertIn("Re-triage overdue", chips)

    def test_intake_carries_v4_risk_items(self):
        from .intake import triage_risk_items

        items = triage_risk_items({**BASE, "screen_self": "yes", "suic": "intent", "flags": ["lethal_means"]})
        self.assertIn(("suicide", "Intent"), items)
        self.assertIn(("suicide", "Access to means"), items)
