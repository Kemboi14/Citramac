"""Intake v4: structured MSE (INT-16), allergy type tiering (INT-06), instruments
(EPDS item 10, MDQ rule, PAWSS gate, timepoint), past-history link (INT-04-07/08),
substance cards (INT-08) and diagnosis certainty."""

from django.urls import reverse

from apps.client_registry.models import AllergyRecord, Patient
from apps.clinical_encounter.models import DiagnosisCode
from apps.dha_interop.models import IcdCodeIndex
from apps.tenancy.context import platform_admin_context

from . import attention, intake, tools
from .models import IntakeAssessment
from .test_care_plan import CarePlanTestCase


class IntakeV4TestCase(CarePlanTestCase):
    def post(self, name, body, *args):
        return self.client.post(reverse(name, args=args or [self.pid]), body, format="json", **self.auth)

    def proposals(self):
        url = reverse("care-client-proposals", args=[self.pid])
        return self.client.get(url, **self.auth).data["results"]

    def patient(self):
        return Patient.objects.get(pk=self.pid)


class StructuredMseTests(IntakeV4TestCase):
    def test_suicidal_and_homicidal_chips_raise_risk_proposals_and_the_sra(self):
        self.draft()
        response = self.save(sections={"mse": {
            "findings": {"thought_content": ["SUICIDAL", "HOMICIDAL"]},
            "thought_content": "Passive thoughts, no plan",
        }})
        self.assertEqual(response.status_code, 200, response.data)
        rows = {(p["row"], p["option"]) for p in self.proposals()}
        self.assertEqual(rows, {("suicide", "Thoughts"), ("violence", "Thoughts")})
        with platform_admin_context():
            self.assertIn("SRA", tools.triggers(self.patient()))
            exam = IntakeAssessment.objects.get(patient_id=self.pid, status="DRAFT").mse
            self.assertEqual(exam.thought_content, "Suicidal, Homicidal — Passive thoughts, no plan")

    def test_notes_are_never_parsed_once_findings_are_structured(self):
        self.draft()
        self.save(sections={"mse": {
            "findings": {"thought_content": ["NO_ABNORMALITY"], "perception": ["NO_DISTURBANCE"]},
            "thought_content": "Suicidal ideation denied", "perception": "no hallucinations",
        }})
        self.assertEqual(self.proposals(), [])
        with platform_admin_context():
            self.assertNotIn("SRA", tools.triggers(self.patient()))
            self.assertNotIn("psychosis", {i["key"] for i in attention.active_alerts(self.patient())})

    def test_unknown_codes_and_domains_are_rejected(self):
        self.draft()
        self.assertEqual(self.save(sections={"mse": {"findings": {"thought_content": ["MADE_UP"]}}}).status_code, 400)
        self.assertEqual(self.save(sections={"mse": {"findings": {"mood": ["LOW"]}}}).status_code, 400)
        self.assertEqual(self.save(sections={"mse": {"orient_time": "PARTLY"}}).status_code, 400)

    def test_orientation_spheres_and_required_domains(self):
        self.draft()
        self.save(sections={"mse": {
            "findings": {"thought_content": ["HOPELESSNESS"]},
            "orient_time": "DISORIENTED", "orient_place": "ORIENTED", "orient_person": "NOT_TESTED",
        }})
        missing = self.draft().data["outstanding_now"]
        self.assertTrue(any("Section 16" in m for m in missing))  # mood still missing
        self.save(sections={"mse": {"mood": "“Empty”"}})
        self.assertFalse(any("Section 16" in m for m in self.draft().data["outstanding_now"]))
        with platform_admin_context():
            exam = IntakeAssessment.objects.get(patient_id=self.pid, status="DRAFT").mse
            self.assertEqual(exam.orientation, "Time: Disoriented; Place: Oriented; Person: Not tested")
            self.assertIn("PHQ9", tools.triggers(self.patient()))

    def test_legacy_free_text_mse_is_still_read(self):
        self.draft()
        self.save(sections={"mse": {"mood": "Low", "thought_content": "Suicidal thoughts daily"}})
        self.assertIn(("suicide", "Thoughts"), {(p["row"], p["option"]) for p in self.proposals()})
        self.assertFalse(any("Section 16" in m for m in self.draft().data["outstanding_now"]))

    def test_signed_legacy_intake_is_read_but_never_rewritten(self):
        with platform_admin_context():
            signed = IntakeAssessment.objects.create(
                organization=self.org, patient=self.patient(), author=self.nurse, version=1,
                status=IntakeAssessment.STATUS_SIGNED,
                sections={"mse": {"perception": "Auditory hallucinations", "thought_content": "Suicidal"}},
            )
            before = dict(signed.sections)
            self.assertIn("SRA", tools.triggers(self.patient()))
        draft = self.draft().data  # clones the signed version
        self.assertEqual(draft["version"], 2)
        with platform_admin_context():
            signed.refresh_from_db()
            self.assertEqual(signed.sections, before)


class AllergyV4Tests(IntakeV4TestCase):
    def check(self, drug):
        return self.post("care-prescribing-checks", {"drug": drug}).data

    def add(self, **body):
        return self.post("care-client-allergy", {"substance": "Penicillin", **body})

    def test_true_allergy_blocks_and_intolerance_or_adr_only_warn(self):
        self.assertEqual(self.add(allergy_type="ALLERGY", severity="ANAPHYLAXIS").status_code, 201)
        self.post("care-client-allergy", {"substance": "Haloperidol", "allergy_type": "ADR", "reaction": "Dystonia"})
        self.post("care-client-allergy", {"substance": "Codeine", "allergy_type": "INTOLERANCE"})
        self.assertTrue(self.check("Penicillin V")["blocking"])
        for drug in ("Haloperidol", "Codeine"):
            result = self.check(drug)
            self.assertEqual(result["blocking"], [])
            self.assertTrue(any(drug in w for w in result["warnings"]))

    def test_type_and_severity_are_validated(self):
        self.assertEqual(self.add(allergy_type="RASH").status_code, 400)
        self.assertEqual(self.add(severity="Terrible").status_code, 400)
        self.assertEqual(self.post("care-client-allergy", {"substance": " "}).status_code, 400)

    def test_remove_resolves_or_refutes_and_never_deletes(self):
        records = self.add().data["records"]
        record_id = records[0]["id"]
        url = reverse("care-allergy-verify", args=[record_id])
        resolved = self.client.patch(url, {"status": "RESOLVED"}, format="json", **self.auth).data
        self.assertEqual(resolved["records"][0]["clinical_status"], "RESOLVED")
        self.assertEqual(resolved["status"], "UNKNOWN")  # nothing active — ask again
        self.assertEqual(self.check("Penicillin")["blocking"], [])
        refuted = self.client.patch(url, {"status": "REFUTED"}, format="json", **self.auth).data
        self.assertEqual(refuted["records"], [])
        with platform_admin_context():
            self.assertEqual(AllergyRecord.objects.get(pk=record_id).verification_status, "REFUTED")

    def test_confirm_unchanged_confirms_the_whole_record_with_source(self):
        with platform_admin_context():
            AllergyRecord.objects.create(
                organization=self.org, patient=self.patient(), substance="Sulfa",
                verification_status="UNCONFIRMED", source="REGISTRATION",
            )
            patient = self.patient()
            patient.allergy_status = "ACTIVE_ALLERGIES"
            patient.save()
        url = reverse("care-client-allergy", args=[self.pid])
        self.assertEqual(self.client.put(url, {"info_source": "NOPE"}, format="json", **self.auth).status_code, 400)
        data = self.client.put(
            url, {"info_source": "CLIENT_REPORT", "confirm": True}, format="json", **self.auth
        ).data
        self.assertEqual(data["info_source"], "CLIENT_REPORT")
        self.assertTrue(data["confirmed_at"])
        self.assertEqual(data["records"][0]["verification_status"], "CONFIRMED")
        self.assertFalse(any("Section 6" in m for m in self.draft().data["outstanding_now"]))


class InstrumentV4Tests(IntakeV4TestCase):
    def record(self, **body):
        return self.post("care-client-assessments", body)

    def test_epds_item_10_above_zero_raises_a_self_harm_proposal(self):
        self.assertEqual(self.record(instrument="EPDS", total=8).status_code, 400)  # item 10 required
        self.assertEqual(self.record(instrument="EPDS", total=8, detail={"item10": 0}).status_code, 201)
        self.assertEqual(self.proposals(), [])
        score = self.record(instrument="EPDS", total=8, detail={"item10": 2}, timepoint="REPEAT")
        self.assertEqual(score.status_code, 201, score.data)
        self.assertEqual((score.data["timepoint"], score.data["detail"]), ("REPEAT", {"item10": 2}))
        self.assertTrue(score.data["flags"])
        self.assertEqual([(p["row"], p["option"]) for p in self.proposals()], [("suicide", "Thoughts")])

    def test_mdq_positive_only_with_seven_yes_co_occurrence_and_impairment(self):
        seven = [1] * 7 + [0] * 6
        cases = [
            (seven, "YES", "MODERATE", True),
            (seven, "YES", "SERIOUS", True),
            (seven, "NO", "SERIOUS", False),
            (seven, "YES", "MINOR", False),
            ([1] * 6 + [0] * 7, "YES", "SERIOUS", False),
        ]
        for answers, co, impairment, expected in cases:
            score = self.record(instrument="MDQ", answers=answers, positive=not expected,
                                detail={"co_occurrence": co, "impairment": impairment})
            self.assertEqual(score.status_code, 201, score.data)
            self.assertIs(score.data["positive"], expected, (answers, co, impairment))
        self.assertEqual(self.record(instrument="MDQ", answers=seven).status_code, 400)

    def test_pawss_threshold_no_ends_the_screen_at_zero(self):
        score = self.record(instrument="PAWSS", detail={"threshold": "NO"})
        self.assertEqual((score.status_code, score.data["score"], score.data["items"]), (201, 0, []))
        self.assertEqual(self.record(instrument="PAWSS", detail={"threshold": "YES"}).status_code, 400)
        full = self.record(instrument="PAWSS", detail={"threshold": "YES"}, answers=[1] * 4 + [0] * 6)
        self.assertEqual(full.data["score"], 4)

    def test_unknown_timepoint_is_rejected(self):
        self.assertEqual(self.record(instrument="PHQ9", answers=[0] * 9, timepoint="intake").status_code, 400)


class LinksAndCardsTests(IntakeV4TestCase):
    def test_past_attempt_and_violence_link_to_risk_past_history(self):
        self.draft()
        sections = self.save(sections={"mh": {"past_attempts": "YES", "past_violence": "YES"}}).data["sections"]
        self.assertIn("Past history", sections["risk"]["rows"]["suicide"])
        self.assertIn("Past history", sections["risk"]["rows"]["violence"])
        self.assertEqual(set(sections["risk"]["linked"]), {"suicide:Past history", "violence:Past history"})
        sections = self.save(sections={"mh": {"past_attempts": "NONE"}}).data["sections"]
        self.assertNotIn("Past history", sections["risk"]["rows"]["suicide"])
        self.assertIn("Past history", sections["risk"]["rows"]["violence"])

    def test_clinician_ticked_past_history_is_kept_when_section_4_says_none(self):
        self.draft()
        self.save(sections={"risk": {"rows": {"suicide": ["None identified", "Past history"]}},
                            "mh": {"past_attempts": "NONE"}})
        rows = self.draft().data["sections"]["risk"]["rows"]
        self.assertEqual(rows["suicide"], ["None identified", "Past history"])

    def test_substance_cards_validate_and_hidden_harm_reduction_is_dropped(self):
        self.draft()
        bad = self.save(sections={"subs": {"substances": [{"substance": "ALCOHOL"}, {"substance": "ALCOHOL"}]}})
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(self.save(sections={"subs": {"substances": [{"substance": "GLUE"}]}}).status_code, 400)
        ok = self.save(sections={"subs": {
            "substances": [{"substance": "ALCOHOL", "current": "YES"}, {"substance": "NICOTINE"}],
            "injecting": "YES_CURRENTLY", "harm_reduction": ["NALOXONE_KIT_OFFERED"],
        }})
        self.assertEqual(ok.status_code, 200, ok.data)
        self.assertEqual(ok.data["sections"]["subs"]["harm_reduction"], ["NALOXONE_KIT_OFFERED"])
        with platform_admin_context():
            self.assertIn("PAWSS", tools.triggers(self.patient()))
        hidden = self.save(sections={"subs": {"injecting": "NO_NEVER_INJECTED"}}).data["sections"]["subs"]
        self.assertNotIn("harm_reduction", hidden)


class DiagnosisCertaintyTests(IntakeV4TestCase):
    def test_ruled_out_does_not_count_as_a_working_diagnosis(self):
        with platform_admin_context():
            from . import services

            code, _ = IcdCodeIndex.objects.get_or_create(code="6A70", defaults={"description": "Depression"})
            episode = services.get_or_open_episode(self.patient(), self.nurse)
            encounter = services.clinical_encounter_for(self.patient(), episode, self.nurse)
            dx = DiagnosisCode.objects.create(organization=self.org, encounter=encounter, icd11_code=code)
            self.assertEqual(dx.verification_status, "PROVISIONAL")
            self.assertEqual(DiagnosisCode.FHIR_VERIFICATION["RULED_OUT"], "refuted")
        self.draft()
        self.assertFalse(any("Section 19" in m for m in self.draft().data["outstanding_now"]))
        patch = self.client.patch(
            reverse("diagnosis-code-detail", args=[dx.pk]),
            {"verification_status": "RULED_OUT", "clinical_notes": "Organic cause found"},
            format="json", **self.auth,
        )
        self.assertEqual(patch.status_code, 200, patch.data)
        self.assertTrue(any("Section 19" in m for m in self.draft().data["outstanding_now"]))
        with platform_admin_context():
            self.assertTrue(any("Section 19" in m for m in intake.outstanding_items(
                IntakeAssessment.objects.get(patient_id=self.pid, status="DRAFT"))))


class SectionNavigationTests(IntakeV4TestCase):
    def test_required_section_cannot_be_set_not_applicable(self):
        self.draft()
        self.assertEqual(self.save(section_state={"mse": "Not applicable"}).status_code, 400)
        self.assertEqual(self.save(section_state={"family": "Not applicable"}).status_code, 200)
