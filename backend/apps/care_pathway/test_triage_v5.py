"""Triage v5 (triage_v5.py — the triage developer specification) and the shared
clinical finding store (findings.py): the spec questions → priority, the
PAWSS / CIWA-Ar / COWS triggers, hidden fields (X-08), what blocks signing,
one finding per domain with its source, versions instead of overwrites, Intake
confirming the same finding, and the findings as R4 Observations (spec §19)."""

from django.test import SimpleTestCase
from django.urls import reverse

from apps.accounts.models import Role
from apps.dha_interop.fhir_validation.validator import validate_bundle
from apps.tenancy.context import platform_admin_context

from . import tools
from . import triage_v5 as v5
from .models import ClinicalAlert, ClinicalFinding, TriageEncounter
from .tests import CarePathwayApiTestCase

BASE = {
    "schema": "v5",
    "b_informant": "client",
    "b_present": "yes",
    "c_concern": "Low mood, drinking more",
    "d_suicidal": "no",
    "d_attempt": "no",
    "d_means": "no",
    "d_safety": "yes",
    "e_thoughts": "no",
    "f_change": "no",
    "g_use": "no",
    "h_concern": "no",
    "i_safe": "yes",
    "j_concern": "no",
}
REMOTE = {
    "schema": "v5",
    "b_informant": "family",
    "b_third_party": "Sister — Jane",
    "b_present": "no",
    "c_concern": "Not answering the phone",
    "k_bring": "yes",
    "k_emergency": "no",
}
SAFETY = {
    "safety_obs": "ARMS_LENGTH",
    "safety_location": "QUIET_ROOM",
    "safety_observer": "L. Wambui",
}
ALCOHOL_WD = {
    "g_use": "yes",
    "g_alcohol_last": "yesterday evening",
    "g_alcohol_amount": "a bottle of spirits daily",
    "g_alcohol_concern": "withdrawal",
    "g_withdrawal": ["tremor", "sweating"],
}


def rec(**answers):
    return v5.evaluate({**BASE, **answers})


def fired(result):
    return {r["rule"] for r in result["reason_list"]}


class RulesTests(SimpleTestCase):
    def test_completed_negative_screen_is_green_and_owner_approved(self):
        result = rec()
        self.assertEqual(result["recommendation"], "GREEN")
        self.assertEqual(result["rules_version"], "2026-10-28.1")
        self.assertEqual(result["ruleset_label"], "Approved by the project owner, 2026-10-28")

    def test_section_d_suicide_self_harm(self):
        self.assertEqual(rec(d_suicidal="yes", d_act_now="no")["priority"], "ORANGE")
        self.assertEqual(rec(d_suicidal="yes", d_act_now="yes")["priority"], "RED")
        self.assertEqual(
            rec(d_attempt="yes", d_what_happened="tablets last night")["priority"], "RED"
        )
        self.assertEqual(rec(d_means="yes")["priority"], "YELLOW")
        self.assertEqual(rec(d_safety="no")["priority"], "RED")
        result = rec(d_suicidal="yes", d_act_now="no")
        self.assertIn("SUICIDE_RISK", [a["code"] for a in result["alerts"]])
        self.assertTrue(
            {"suicide_risk_assessment", "safety_plan"} <= set(result["recommended_actions"])
        )

    def test_unable_to_determine_is_never_a_negative(self):
        result = rec(d_suicidal="unable")
        self.assertFalse(result["ready"])
        self.assertEqual(result["recommendation"], "Review required")
        self.assertIn("Unable to determine", result["reasons"])

    def test_section_e_harm_to_others(self):
        self.assertEqual(rec(e_thoughts="yes", e_named="no")["priority"], "ORANGE")
        self.assertEqual(rec(e_thoughts="yes", e_named="yes")["priority"], "RED")
        self.assertEqual(rec(e_behaviour="yes", e_means="yes")["priority"], "RED")
        self.assertEqual(rec(e_danger="yes")["priority"], "RED")
        self.assertIn("AGGRESSION_RISK", [a["code"] for a in rec(e_act="yes")["alerts"]])

    def test_section_g_withdrawal_triggers_the_right_instrument(self):
        alcohol = rec(**ALCOHOL_WD)
        self.assertEqual(alcohol["priority"], "ORANGE")
        self.assertTrue(
            {"withdrawal_monitoring", "pawss", "ciwa_ar"} <= set(alcohol["recommended_actions"])
        )
        self.assertNotIn("cows", alcohol["recommended_actions"])
        opioid = rec(
            g_use="yes",
            g_opioids_last="this morning",
            g_opioids_concern="withdrawal",
            g_withdrawal=["sweating"],
        )
        self.assertEqual(opioid["priority"], "YELLOW")
        self.assertIn("cows", opioid["recommended_actions"])
        self.assertNotIn("ciwa_ar", opioid["recommended_actions"])
        stopped = rec(g_use="yes", g_alcohol_last="3 days ago", g_stopped="yes")
        self.assertEqual(stopped["priority"], "YELLOW")
        self.assertIn("pawss", stopped["recommended_actions"])
        self.assertEqual(rec(**{**ALCOHOL_WD, "g_withdrawal": ["seizure"]})["priority"], "RED")

    def test_section_h_and_vitals(self):
        self.assertEqual(rec(h_concern="yes", h_flags=["severe_pain"])["priority"], "ORANGE")
        self.assertEqual(rec(h_concern="yes", h_flags=["chest_pain"])["priority"], "RED")
        low = rec(v_glucose="3.1")
        self.assertIn("GLUCOSE-LOW", fired(low))

    def test_sections_i_and_j(self):
        self.assertEqual(rec(i_safe="no")["priority"], "ORANGE")
        self.assertEqual(rec(i_flags=["domestic_violence"])["priority"], "ORANGE")
        self.assertEqual(rec(j_concern="yes", j_flags=["eating_drinking"])["priority"], "YELLOW")

    def test_section_k_telephone(self):
        self.assertEqual(v5.evaluate(REMOTE)["priority"], "GREEN")
        self.assertEqual(v5.evaluate({**REMOTE, "k_emergency": "yes"})["priority"], "RED")
        talk = {**REMOTE, "k_flags": ["suicide_concern"]}
        self.assertEqual(v5.evaluate(talk)["priority"], "ORANGE")
        self.assertEqual(
            v5.evaluate({**REMOTE, "k_flags": ["suicide_concern", "access_to_means"]})["priority"],
            "RED",
        )
        self.assertEqual(
            v5.evaluate({**REMOTE, "k_flags": ["significant_intoxication"], "k_alone": "yes"})[
                "priority"
            ],
            "ORANGE",
        )


class CleaningAndRequiredTests(SimpleTestCase):
    def test_v4_only_and_hidden_answers_are_not_stored(self):
        cleaned = v5.clean_answers(
            {
                **BASE,
                "flags": ["seizure"],
                "suic": "plan",
                "distress": "LOW",
                "collateral": "x",
                "d_act_now": "yes",
                "g_alcohol_last": "today",
                "k_where": "home",
            }
        )
        for key in (
            "flags",
            "suic",
            "distress",
            "collateral",
            "d_act_now",
            "g_alcohol_last",
            "k_where",
        ):
            self.assertNotIn(key, cleaned)
        remote = v5.clean_answers({**REMOTE, "d_suicidal": "yes", "v_hr": "80", "acvpu": "A"})
        for key in ("d_suicidal", "v_hr", "acvpu"):
            self.assertNotIn(key, remote)

    def test_what_blocks_signing(self):
        def keys(answers):
            return {key for _m, key in v5.required_problems(v5.clean_answers(answers))}

        self.assertEqual(keys(BASE), set())
        self.assertIn("b_encounter_type_other", keys({**BASE, "b_encounter_type": "other"}))
        self.assertNotIn(
            "b_encounter_type_other",
            keys({**BASE, "b_encounter_type": "other", "b_encounter_type_other": "Court referral"}),
        )
        self.assertIn("d_act_now", keys({**BASE, "d_suicidal": "yes"}))
        self.assertIn("d_what_happened", keys({**BASE, "d_attempt": "yes"}))
        self.assertIn("g_alcohol_last", keys({**BASE, "g_use": "yes"}))
        self.assertIn("j_concern", keys({k: v for k, v in BASE.items() if k != "j_concern"}))
        self.assertIn("r_disposition", keys({**REMOTE, "k_bring": "no"}))
        self.assertEqual(keys(REMOTE), set())

    def test_one_finding_per_domain_with_source(self):
        items = {
            f["key"]: f
            for f in v5.domain_findings(
                {**BASE, **ALCOHOL_WD, "d_suicidal": "yes", "d_act_now": "no"}
            )
        }
        self.assertEqual(items["SUICIDE_SELF_HARM"]["status"], "PRESENT")
        self.assertEqual(items["SUICIDE_SELF_HARM"]["source_code"], "CLIENT_REPORT")
        self.assertEqual(items["HARM_TO_OTHERS"]["status"], "ABSENT")
        self.assertEqual(items["SUBSTANCE:alcohol"]["status"], "PRESENT")
        self.assertIn("withdrawal", items["SUBSTANCE:alcohol"]["summary"])
        third = {
            f["key"]: f for f in v5.domain_findings({**REMOTE, "k_flags": ["suicide_concern"]})
        }
        self.assertEqual(third["SUICIDE_SELF_HARM"]["source_code"], "THIRD_PARTY_REPORT")
        self.assertNotIn("HARM_TO_OTHERS", third)  # a caller's silence is not a negative


class FindingStoreApiTests(CarePathwayApiTestCase):
    def setUp(self):
        super().setUp()
        with platform_admin_context():
            role, _ = Role.objects.get_or_create(
                name="Nurse", defaults={"scope": Role.SCOPE_ORG_TEMPLATE}
            )
            self.nurse.roles.add(role)
        registered = self.register(allergy_status="NONE")
        self.pid = registered.data["patient_id"]
        self.te_id = registered.data["triage_encounter_id"]

    def sign_v5(self, answers, priority=None, **extra):
        body = {"answers": answers, **extra}
        if priority:
            body["final_priority"] = priority
        return self.client.post(
            reverse("care-triage-sign", args=[self.te_id]), body, format="json", **self.auth
        )

    def findings(self, **params):
        return self.client.get(
            reverse("care-client-findings", args=[self.pid]), params, **self.auth
        ).data["results"]

    def test_signing_writes_findings_alerts_and_a_valid_r4_bundle(self):
        answers = {
            **BASE,
            **ALCOHOL_WD,
            **SAFETY,
            "d_suicidal": "yes",
            "d_act_now": "no",
            "b_encounter_type": "other",
            "b_encounter_type_other": "Court referral",
        }
        response = self.sign_v5(answers)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["rules_version"], "2026-10-28.1")
        self.assertEqual(response.data["final_priority"], "ORANGE")
        with platform_admin_context():
            codes = set(
                ClinicalAlert.objects.filter(patient_id=self.pid).values_list(
                    "alert_code", flat=True
                )
            )
        self.assertTrue({"SUICIDE_RISK", "WITHDRAWAL_RISK"} <= codes)

        current = {f["key"]: f for f in self.findings()}
        suicide = current["SUICIDE_SELF_HARM"]
        self.assertEqual(
            (suicide["status"], suicide["stage"], suicide["action"]),
            ("PRESENT", "TRIAGE", "RECORDED"),
        )
        self.assertEqual(suicide["source_label"], "Client report")
        self.assertTrue(suicide["recorded_by"] and suicide["recorded_at"])
        self.assertIn("SUBSTANCE:alcohol", current)

        bundle = self.client.get(reverse("care-triage-fhir", args=[self.te_id]), **self.auth).data
        self.assertEqual(validate_bundle(bundle), {})
        resources = [e["resource"] for e in bundle["entry"]]
        observations = [r for r in resources if r["resourceType"] == "Observation"]
        self.assertEqual(len(observations), len(current))
        self.assertTrue(all(o["derivedFrom"] and o["encounter"] for o in observations))
        encounter = next(r for r in resources if r["resourceType"] == "Encounter")
        self.assertEqual(encounter["type"][0]["text"], "Court referral")
        provenance = next(r for r in resources if r["resourceType"] == "Provenance")
        self.assertEqual(len(provenance["target"]), 1 + len(observations))

        # PAWSS is prompted from the triage finding before any intake exists (spec §19).
        with platform_admin_context():
            from apps.client_registry.models import Patient

            why = tools.triggers(Patient.objects.get(pk=self.pid))
        self.assertIn("PAWSS", why)
        self.assertIn("SRA", why)

    def test_retriage_and_review_keep_the_history(self):
        self.assertEqual(
            self.sign_v5({**BASE, **SAFETY, "d_suicidal": "yes", "d_act_now": "no"}).status_code,
            201,
        )
        with platform_admin_context():
            te = TriageEncounter.objects.get(pk=self.te_id)
            te.status = TriageEncounter.STATUS_IN_TRIAGE
            te.save(update_fields=["status"])
        self.assertEqual(self.sign_v5(dict(BASE)).status_code, 201)
        history = self.findings(key="SUICIDE_SELF_HARM")
        self.assertEqual([h["version"] for h in history], [2, 1])
        self.assertEqual([h["status"] for h in history], ["ABSENT", "PRESENT"])
        self.assertEqual(history[0]["action"], "UPDATED")
        harm = self.findings(key="HARM_TO_OTHERS")
        self.assertEqual(harm[0]["action"], "CONFIRMED")  # unchanged at re-triage

        url = reverse("care-client-finding-review", args=[self.pid])
        blocked = self.client.post(
            url, {"key": "HARM_TO_OTHERS", "action": "UPDATED"}, format="json", **self.auth
        )
        self.assertEqual(blocked.status_code, 400)
        updated = self.client.post(
            url,
            {
                "key": "HARM_TO_OTHERS",
                "action": "UPDATED",
                "status": "PRESENT",
                "note": "Threats to neighbour today",
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(updated.status_code, 201, updated.data)
        self.assertEqual((updated.data["version"], updated.data["stage"]), (3, "INTAKE"))
        with platform_admin_context():
            self.assertEqual(
                ClinicalFinding.objects.filter(patient_id=self.pid, key="HARM_TO_OTHERS").count(), 3
            )

    def test_intake_confirms_the_same_finding_instead_of_reasking(self):
        self.assertEqual(
            self.sign_v5({**BASE, **SAFETY, "d_suicidal": "yes", "d_act_now": "no"}).status_code,
            201,
        )
        draft = self.client.get(
            reverse("care-client-intake-draft", args=[self.pid]), **self.auth
        ).data
        risk = draft["sections"]["risk"]
        self.assertIn("Thoughts", risk["rows"]["suicide"])
        carried = {key: {**entry, "confirmed": True} for key, entry in risk["carried"].items()}
        saved = self.client.put(
            reverse("care-client-intake-draft", args=[self.pid]),
            {
                "sections": {
                    "risk": {**risk, "carried": carried},
                    "close": {"reason_incomplete": "Client tired", "message": "Continue tomorrow"},
                },
                "section_state": {},
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(saved.status_code, 200, saved.data)
        signed = self.client.post(
            reverse("care-client-intake-sign", args=[self.pid]),
            {"completeness": "PARTIAL"},
            format="json",
            **self.auth,
        )
        self.assertEqual(signed.status_code, 200, signed.data)
        latest = self.findings(key="SUICIDE_SELF_HARM")[0]
        self.assertEqual(
            (latest["version"], latest["stage"], latest["action"]), (2, "INTAKE", "CONFIRMED")
        )
        self.assertEqual(latest["status"], "PRESENT")

    def test_telephone_triage_records_only_what_was_reported(self):
        self.assertEqual(self.sign_v5({**REMOTE, "k_flags": ["suicide_concern"]}).status_code, 201)
        keys = {f["key"]: f for f in self.findings()}
        self.assertEqual(set(keys), {"PRESENTING_CONCERN", "SUICIDE_SELF_HARM"})
        self.assertEqual(keys["SUICIDE_SELF_HARM"]["source_code"], "THIRD_PARTY_REPORT")
        self.assertEqual(keys["SUICIDE_SELF_HARM"]["source_detail"], "Sister — Jane")
