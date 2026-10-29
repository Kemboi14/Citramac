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
        self.assertEqual(result["rules_version"], "2026-10-29.1")
        self.assertEqual(result["ruleset_label"], "Approved by the project owner, 2026-10-29")

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

    def test_an_other_substance_concern_is_described(self):
        other = {**BASE, **ALCOHOL_WD, "g_alcohol_concern": "other"}
        problems = {key for _m, key in v5.required_problems(v5.clean_answers(other))}
        self.assertIn("g_alcohol_concern_other", problems)
        described = {**other, "g_alcohol_concern_other": "Drinking before driving the school bus"}
        cleaned = v5.clean_answers(described)
        self.assertEqual(
            cleaned["g_alcohol_concern_other"], "Drinking before driving the school bus"
        )
        self.assertNotIn(
            "g_alcohol_concern_other",
            {key for _m, key in v5.required_problems(cleaned)},
        )
        items = {f["key"]: f for f in v5.domain_findings(described)}
        self.assertIn(
            "concern: Drinking before driving the school bus", items["SUBSTANCE:alcohol"]["summary"]
        )
        # Kept only while "Other" is the concern and substance use is recorded.
        for answers in (
            {**described, "g_alcohol_concern": "withdrawal"},
            {**described, "g_use": "no"},
        ):
            self.assertNotIn("g_alcohol_concern_other", v5.clean_answers(answers))


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
        self.assertEqual(response.data["rules_version"], "2026-10-29.1")
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

    def test_the_episode_takes_its_presenting_problems_from_the_triage(self):
        # Registration no longer asks the reason for attending (QA, 2026-10-29).
        with platform_admin_context():
            te = TriageEncounter.objects.get(pk=self.te_id)
            te.presenting_concern = ""
            te.save(update_fields=["presenting_concern"])
            te.episode.presenting_problems = ""
            te.episode.save(update_fields=["presenting_problems"])
        self.assertEqual(self.sign_v5(BASE).status_code, 201)
        with platform_admin_context():
            te.episode.refresh_from_db()
        self.assertEqual(te.episode.presenting_problems, "Low mood, drinking more")

    def test_the_triage_does_not_overwrite_the_episodes_presenting_problems(self):
        self.assertEqual(self.sign_v5({**BASE, "c_concern": "Hearing voices"}).status_code, 201)
        with platform_admin_context():
            te = TriageEncounter.objects.select_related("episode").get(pk=self.te_id)
        self.assertEqual(te.presenting_concern, "Hearing voices")
        self.assertEqual(te.episode.presenting_problems, "Low mood, drinking more")

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


GLUCOSE_LOW = {"v_glucose": "3.1", "v_measured_at": "2026-10-28T09:30", "v_source": "here"}
OPIOID_WD = {
    "g_use": "yes",
    "g_opioids_last": "this morning",
    "g_opioids_amount": "heroin, daily",
    "g_opioids_concern": "withdrawal",
}


class MedicalEscalationRulesTests(SimpleTestCase):
    """Rules 2026-10-28.2 (owner, after QA): critical measurements, the next step
    for an acute medical concern, the referral received, vitals time and source,
    and the per-section AUTO-TRIGGER list."""

    def test_a_critical_measurement_is_an_acute_medical_concern(self):
        result = rec(**GLUCOSE_LOW)
        codes = {a["code"] for a in result["alerts"]}
        self.assertTrue({"MEDICAL_CONCERN", "ABNORMAL_VITALS"} <= codes)
        self.assertTrue(result["medical_escalation"])
        self.assertIn("urgent_medical_review", result["recommended_actions"])
        normal = rec(v_hr="80", v_measured_at="2026-10-28T09:30", v_source="here")
        self.assertFalse(normal["medical_escalation"])
        self.assertNotIn("MEDICAL_CONCERN", {a["code"] for a in normal["alerts"]})

    def test_escalation_asks_the_next_step_and_the_referral(self):
        a = v5.clean_answers({**BASE, **GLUCOSE_LOW})
        keys = {key for _m, key in v5.required_problems(a)}
        self.assertTrue({"h_next", "h_referred_in"} <= keys)
        a = v5.clean_answers({**BASE, **GLUCOSE_LOW, "h_next": "refer_out", "h_referred_in": "yes"})
        keys = {key for _m, key in v5.required_problems(a)}
        self.assertTrue(
            {"h_refer_facility", "h_refer_reason", "h_ref_facility", "h_ref_note"} <= keys
        )

    def test_no_escalation_drops_the_escalation_answers(self):
        a = v5.clean_answers(
            {**BASE, "h_next": "refer_out", "h_refer_facility": "X", "h_referred_in": "yes"}
        )
        for key in ("h_next", "h_refer_facility", "h_referred_in"):
            self.assertNotIn(key, a)

    def test_vitals_need_a_measured_time_and_source(self):
        keys = {key for _m, key in v5.required_problems(v5.clean_answers({**BASE, "v_hr": "80"}))}
        self.assertTrue({"v_measured_at", "v_source"} <= keys)
        future = v5.clean_answers(
            {**BASE, "v_hr": "80", "v_measured_at": "2099-01-01T00:00", "v_source": "here"}
        )
        self.assertIn("v_measured_at", {key for _m, key in v5.required_problems(future)})
        self.assertNotIn("v_measured_at", v5.clean_answers({**BASE, "v_measured_at": "x"}))

    def test_vitals_from_the_referring_facility_need_the_referral(self):
        answers = {**BASE, "v_hr": "80", "v_measured_at": "2026-10-28T09:30"}
        result = rec(**{**answers, "v_source": "referring_facility"})
        self.assertTrue(result["referral_in_asked"])
        self.assertFalse(result["medical_escalation"])
        a = v5.clean_answers({**answers, "v_source": "referring_facility", "h_referred_in": "no"})
        self.assertIn("h_referred_in", {key for _m, key in v5.required_problems(a)})

    def test_auto_triggers_name_the_alert_and_the_tool_per_section(self):
        from .valuesets import VALUESETS

        labels = {(vs, c): d for vs, (_t, concepts) in VALUESETS.items() for c, d in concepts}
        triggers = v5.evaluate({**BASE, **OPIOID_WD}, labels)["auto_triggers"]
        cows = next(t for t in triggers if t["code"] == "TOOL:cows")
        self.assertEqual((cows["section"], cows["alert"]), ("g", "Opioid withdrawal"))
        self.assertTrue(cows["pathway"].startswith("COWS"))
        self.assertIn("WITHDRAWAL_RISK", {t["code"] for t in triggers})
        cleared = rec(**{**OPIOID_WD, "g_opioids_concern": "none"})["auto_triggers"]
        self.assertNotIn("TOOL:cows", {t["code"] for t in cleared})
        medical = {t["code"]: t["section"] for t in rec(**GLUCOSE_LOW)["auto_triggers"]}
        self.assertEqual(medical["MEDICAL_CONCERN"], "h")
        self.assertEqual(rec()["auto_triggers"], [])
        # An alert that only goes on the client record is raised, not listed.
        psychosis = rec(f_change="yes", f_features=["psychotic_symptoms"])
        self.assertTrue(
            {"MENTAL_STATE_CHANGE", "PSYCHOSIS_AGITATION"}
            <= {x["code"] for x in psychosis["alerts"]}
        )
        self.assertEqual(psychosis["auto_triggers"], [])


class MedicalEscalationApiTests(FindingStoreApiTests):
    def test_each_trigger_raised_and_cleared_is_audited(self):
        from apps.sysadmin_audit.models import AuditLogEntry

        url = reverse("care-triage-draft", args=[self.te_id])
        for answers in ({**BASE, **OPIOID_WD}, {**BASE, **OPIOID_WD}, BASE):
            response = self.client.put(url, {"answers": answers}, format="json", **self.auth)
            self.assertEqual(response.status_code, 200, response.data)
        with platform_admin_context():
            entries = list(
                AuditLogEntry.objects.filter(
                    model="TriageAutoTrigger", object_id=self.te_id
                ).order_by("timestamp")
            )
        # The unchanged second save writes nothing.
        self.assertEqual(len(entries), 2)
        self.assertTrue(
            any(t.startswith("Opioid withdrawal → COWS") for t in entries[0].field_diff["raised"])
        )
        self.assertEqual(entries[0].field_diff["cleared"], [])
        self.assertTrue(
            any(t.startswith("Opioid withdrawal → COWS") for t in entries[1].field_diff["cleared"])
        )
        self.assertEqual(entries[1].field_diff["rules_version"], v5.RULES_VERSION)

    def test_signing_records_the_referrals_tasks_and_measured_vitals(self):
        from apps.triage.models import VitalSigns

        answers = {
            **BASE,
            **SAFETY,
            "v_glucose": "3.1",
            "v_measured_at": "2026-10-28T08:15",
            "v_source": "referring_facility",
            "h_next": "refer_out",
            "h_refer_facility": "County Referral Hospital",
            "h_refer_fr": "FR-0001",
            "h_refer_reason": "Hypoglycaemia not responding to oral glucose",
            "h_referred_in": "yes",
            "h_ref_facility": "Kibera Health Centre",
            "h_ref_note": "Found confused at home; glucose 2.9 at 07:50; given oral glucose.",
        }
        response = self.sign_v5(answers, priority="RED")
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            vitals = VitalSigns.objects.get(encounter__triage_encounter__id=self.te_id)
            tasks = set(
                TriageEncounter.objects.get(pk=self.te_id).tasks.values_list(
                    "focus_type", flat=True
                )
            )
        self.assertEqual(vitals.source, "referring_facility")
        # When measured (facility time), not when signed.
        self.assertEqual(vitals.recorded_at, v5.parse_local_datetime("2026-10-28T08:15"))
        self.assertIn("EXTERNAL_REFERRAL", tasks)

        bundle = self.client.get(reverse("care-triage-fhir", args=[self.te_id]), **self.auth).data
        self.assertEqual(validate_bundle(bundle), {})
        resources = [e["resource"] for e in bundle["entry"]]
        requests = [r for r in resources if r["resourceType"] == "ServiceRequest"]
        self.assertEqual(len(requests), 2)
        incoming = next(r for r in requests if "supportingInfo" in r)
        self.assertIn("Kibera Health Centre", incoming["requester"]["display"])
        outgoing = next(r for r in requests if "performer" in r)
        self.assertIn("FR code FR-0001", outgoing["performer"][0]["display"])
        note = next(r for r in resources if r["resourceType"] == "DocumentReference")
        self.assertEqual(
            note["context"]["encounter"][0]["reference"], incoming["encounter"]["reference"]
        )
        provenance = next(r for r in resources if r["resourceType"] == "Provenance")
        targets = {t["reference"] for t in provenance["target"]}
        self.assertTrue(
            all(
                e["fullUrl"] in targets
                for e in bundle["entry"]
                if e["resource"]["resourceType"] in ("ServiceRequest", "DocumentReference")
            )
        )

    def test_facility_lookup_says_when_the_registry_cannot_answer(self):
        from unittest import mock

        url = reverse("care-triage-facility-lookup", args=[self.te_id])
        self.assertEqual(self.client.get(url, **self.auth).status_code, 400)
        unreachable = self.client.get(url, {"fr_code": "FR-0001"}, **self.auth)
        self.assertEqual(unreachable.status_code, 503)
        with mock.patch(
            "apps.dha_interop.registries.lookup_facility",
            return_value={"fr_code": "FR-0001", "official_name": "County Referral Hospital"},
        ):
            found = self.client.get(url, {"fr_code": "FR-0001"}, **self.auth)
        self.assertEqual(found.data["match"]["official_name"], "County Referral Hospital")
