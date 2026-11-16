"""Psychotherapy note across sessions (PSY-CHANGE) and as a FHIR R4 document.

Classes named `FhirR4Conformance*` run in CI's conformance step: the published
examples in `fhir_examples/psychotherapy-note-*.json` (guide.md §3 item 8) and
the bundle built from a real signed note, each against base R4 4.0.1 and our
profiles in `fhir_profiles/` (HL7's validator checks the same in CI).
"""

import json
from pathlib import Path

from django.test import SimpleTestCase
from django.urls import reverse

from apps.dha_interop.fhir_validation.validator import validate_bundle
from apps.tenancy.context import platform_admin_context

from . import psy_organizer as org
from . import psychotherapy_profiles as profiles
from .psychotherapy_fhir import NOTE_PROFILE, SAFETY_PROFILE
from .test_psychotherapy_note import FORBIDDEN_DENIALS, PsyNoteTestCase

EXAMPLES = Path(__file__).parent / "fhir_examples"
CONF = "http://terminology.hl7.org/CodeSystem/v3-Confidentiality"
ACT = "http://terminology.hl7.org/CodeSystem/v3-ActCode"


def _resources(bundle):
    return [e["resource"] for e in bundle["entry"]]


def _one(bundle, kind):
    return next(r for r in _resources(bundle) if r["resourceType"] == kind)


def _section(composition, key):
    return next(s for s in composition["section"] if s["code"]["coding"][0]["code"] == key)


class PsyDocumentAssertions:
    """What every psychotherapy document must hold, example or built."""

    def assert_document(self, bundle):
        self.assertEqual(validate_bundle(bundle), {})
        self.assertEqual(bundle["type"], "document")
        self.assertTrue(bundle["identifier"]["value"] and bundle["timestamp"])
        composition = bundle["entry"][0]["resource"]
        self.assertEqual(composition["resourceType"], "Composition")
        self.assertEqual(profiles.check(composition, NOTE_PROFILE), [])
        observation = _one(bundle, "Observation")
        self.assertEqual(profiles.check(observation, SAFETY_PROFILE), [])
        # The seven output sections, in order, each coded.
        self.assertEqual(
            [s["code"]["coding"][0]["code"] for s in composition["section"]], list(org.SECTION_KEYS)
        )
        # Who, when, on whose authority (§3 item 4).
        self.assertEqual(composition["attester"][0]["mode"], "legal")
        signing = next(
            r
            for r in _resources(bundle)
            if r["resourceType"] == "Provenance" and "Signed" in r["activity"]["text"]
        )
        self.assertIn(bundle["entry"][0]["fullUrl"], [t["reference"] for t in signing["target"]])
        # Every reference resolves inside the document.
        urls = {e["fullUrl"] for e in bundle["entry"]}
        for ref in _references(bundle):
            self.assertIn(ref, urls)
        # The Risk & Safety section carries the safety screen.
        entry = _section(composition, "risk_safety")["entry"][0]["reference"]
        self.assertEqual(
            next(e for e in bundle["entry"] if e["fullUrl"] == entry)["resource"]["resourceType"],
            "Observation",
        )
        # The episode is the spine (§4).
        self.assertTrue(_one(bundle, "Encounter")["episodeOfCare"])
        # Sensitivity (§3 item 6): R + PSY on every clinical resource.
        for resource in _resources(bundle):
            if resource["resourceType"] == "Patient":
                continue
            labels = {(c["system"], c["code"]) for c in resource["meta"]["security"]}
            self.assertTrue({(CONF, "R"), (ACT, "PSY")} <= labels, resource["resourceType"])
        self.assertEqual(composition["confidentiality"], "R")


def _references(node):
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "reference" and isinstance(value, str):
                yield value
            else:
                yield from _references(value)
    elif isinstance(node, list):
        for value in node:
            yield from _references(value)


class FhirR4ConformancePsychotherapyExamplesTests(PsyDocumentAssertions, SimpleTestCase):
    """Routine (no new concern, CBT, a score change the clinician read as
    improvement), edge (a new concern with a linked risk assessment, amended
    after signing) and omission (safety not assessed; questions left
    unanswered are "not recorded", never a negative)."""

    def load(self, name):
        return json.loads((EXAMPLES / f"psychotherapy-note-{name}.json").read_text())

    def test_every_example_is_a_conformant_document(self):
        paths = sorted(EXAMPLES.glob("psychotherapy-note-*.json"))
        self.assertGreaterEqual(len(paths), 3)
        for path in paths:
            with self.subTest(example=path.name):
                self.assert_document(json.loads(path.read_text()))

    def test_family_examples_show_family_type_and_only_the_recorded_attendees(self):
        paths = sorted(EXAMPLES.glob("psychotherapy-note-family-*.json"))
        self.assertGreaterEqual(len(paths), 3)
        actor_types = {}
        for path in paths:
            bundle = json.loads(path.read_text())
            encounter = _one(bundle, "Encounter")
            self.assertEqual(encounter["type"][0]["coding"][0]["code"], "FAMILY")
            actor_types[path.name] = {
                resource["resourceType"]
                for resource in _resources(bundle)
                if resource["resourceType"] in {"Practitioner", "RelatedPerson"}
            }
        self.assertEqual(
            actor_types["psychotherapy-note-family-routine.json"],
            {"Practitioner", "RelatedPerson"},
        )
        self.assertEqual(
            actor_types["psychotherapy-note-family-omission-no-family-present.json"],
            {"Practitioner"},
        )

    def test_family_answers_map_to_the_existing_profiled_sections(self):
        organized = org.organize_family(
            {
                "family_clinicians": {"text": "Clinician Example"},
                "family_present": {"text": "Family Member A"},
                "family_issues": {"text": "They discussed communication at home."},
                "family_dynamics": {"text": "Members took turns speaking."},
                "family_interventions": {"text": "Practised reflective listening."},
                "family_progress": {"text": "Agreed on a weekly check-in."},
                "family_attention": {"text": "Review conflict escalation."},
                "family_recommendations": {"text": "Continue family sessions."},
            },
            {"answer": "NO"},
            {"date": "16/11/2026", "time": "11:50", "session_type": "Family psychotherapy"},
        )
        sections = organized["sections"]
        self.assertIn("Clinicians present", sections["session_information"])
        self.assertIn("Family Member A", sections["session_information"])
        self.assertIn("They discussed communication at home.", sections["presenting_focus"])
        self.assertIn("Members took turns speaking.", sections["assessment"])
        self.assertIn("Practised reflective listening.", sections["interventions"])
        self.assertIn("Agreed on a weekly check-in.", sections["response"])
        self.assertIn("Review conflict escalation.", sections["plan"])
        self.assertIn("Continue family sessions.", sections["plan"])

    def test_routine_example_records_no_new_concern_and_a_decided_change(self):
        bundle = self.load("routine-cbt-no-new-concern")
        obs = _one(bundle, "Observation")
        self.assertEqual(obs["valueCodeableConcept"]["coding"][0]["code"], "NO")
        self.assertNotIn("component", obs)
        response = _section(bundle["entry"][0]["resource"], "response")["text"]["div"]
        self.assertIn("Clinician: improvement noted", response)

    def test_edge_example_is_a_concern_with_components_and_an_amendment(self):
        bundle = self.load("edge-new-concern-amended")
        composition = bundle["entry"][0]["resource"]
        self.assertEqual(composition["status"], "amended")
        obs = _one(bundle, "Observation")
        self.assertEqual(obs["valueCodeableConcept"]["coding"][0]["code"], "YES")
        self.assertTrue(obs["component"])
        amendments = [
            r
            for r in _resources(bundle)
            if r["resourceType"] == "Provenance" and r["activity"]["text"].startswith("Amendment")
        ]
        self.assertTrue(amendments and amendments[0]["reason"][0]["text"])

    def test_omission_example_never_turns_not_assessed_into_a_denial(self):
        bundle = self.load("omission-safety-not-assessed")
        obs = _one(bundle, "Observation")
        self.assertEqual(obs["valueCodeableConcept"]["coding"][0]["code"], "NOT_ASSESSED")
        self.assertNotIn("component", obs)
        composition = bundle["entry"][0]["resource"]
        text = " ".join(s["text"]["div"] for s in composition["section"]).lower()
        for phrase in FORBIDDEN_DENIALS:
            self.assertNotIn(phrase, text)
        self.assertIn(
            org.NOT_RECORDED.lower(), _section(composition, "plan")["text"]["div"].lower()
        )

    def test_profiles_bind_the_codes_the_note_uses(self):
        self.assertEqual(
            profiles.valueset_codes("urn:citramac:valueset:psy-note-section"),
            {("urn:citramac:codesystem:psy-note-section", k) for k in org.SECTION_KEYS},
        )
        self.assertEqual(
            profiles.valueset_codes("urn:citramac:valueset:psy-safety-answer"),
            {("urn:citramac:codesystem:psy-safety-answer", c) for c, _ in org.SAFETY_OPTIONS},
        )
        for sd in (NOTE_PROFILE, SAFETY_PROFILE):
            self.assertEqual(profiles.artifacts()[sd]["fhirVersion"], "4.0.1")


class FhirR4ConformancePsychotherapyExportTests(PsyDocumentAssertions, PsyNoteTestCase):
    def signed(self, **body):
        nid = self.start().data["id"]
        self.ready(nid, **body)
        self.assertEqual(self.act("care-psy-note-sign", nid).data["status"], "SIGNED")
        return nid

    def fhir(self, nid, auth=None):
        return self.client.get(reverse("care-psy-note-fhir", args=[nid]), **(auth or self.auth))

    def test_signed_note_exports_a_conformant_audited_document(self):
        from apps.sysadmin_audit.models import AuditLogEntry

        nid = self.signed(
            safety_answer="NO", **self.answers(q1="Talked about exams.", q3="Used CBT.")
        )
        response = self.fhir(nid)
        self.assertEqual(response.status_code, 200)
        self.assert_document(response.data)
        self.assertEqual(response.data["entry"][0]["resource"]["status"], "final")
        with platform_admin_context():
            self.assertTrue(
                AuditLogEntry.objects.filter(
                    model="care_pathway.psychotherapynote",
                    object_id=nid,
                    action=AuditLogEntry.ACTION_VIEW,
                    field_diff={"output": "fhir"},
                ).exists()
            )
        # The same note is the same document.
        self.assertEqual(self.fhir(nid).data["identifier"], response.data["identifier"])

    def test_family_attendee_is_a_per_client_encounter_participant(self):
        started = self.start(session_type="FAMILY")
        self.assertEqual(started.status_code, 201, started.data)
        nid = started.data["id"]
        answers = {
            "family_clinicians": {
                "participant_ids": [str(self.nurse.pk)],
                "none_present": False,
            },
            "family_present": {"participant_ids": [], "none_present": True},
            "family_issues": {
                "text": "The family discussed communication at home.",
                "mode": "TYPED",
            },
        }
        self.ready(nid, safety_answer="NO", answers=answers)
        self.assertEqual(self.act("care-psy-note-sign", nid).status_code, 200)

        bundle = self.fhir(nid).data
        self.assert_document(bundle)
        encounter = _one(bundle, "Encounter")
        self.assertEqual(len(encounter["participant"]), 1)
        reference = encounter["participant"][0]["individual"]["reference"]
        self.assertTrue(reference.startswith("urn:uuid:"))
        actor = next(
            resource for resource in _resources(bundle) if reference == f"urn:uuid:{resource['id']}"
        )
        self.assertEqual(actor["resourceType"], "Practitioner")
        self.assertEqual(actor["name"][0]["text"], self.nurse.get_full_name())

    def test_amended_yes_note_carries_concerns_and_the_amendment(self):
        nid = self.start().data["id"]
        self.patch(nid, {"safety_answer": "YES"})
        config = self.client.get(reverse("care-psy-config"), **self.auth).data
        category = config["concerns"]["categories"][0]["code"]
        self.patch(
            nid,
            {
                "safety_detail": {
                    "concerns": [{"category": category}],
                    "description": "New thoughts.",
                }
            },
        )
        self.patch(nid, {"link_risk_assessment": True})
        self.ready(nid, **self.answers(q1="Hard week."))
        self.assertEqual(self.act("care-psy-note-sign", nid).data["status"], "SIGNED")
        self.act(
            "care-psy-note-amend",
            nid,
            {
                "section": "plan",
                "text": "Review in three days.",
                "reason": "Plan agreed after the session.",
            },
        )
        bundle = self.fhir(nid).data
        self.assert_document(bundle)
        self.assertEqual(bundle["entry"][0]["resource"]["status"], "amended")
        obs = _one(bundle, "Observation")
        self.assertEqual(obs["component"][0]["code"]["coding"][0]["code"], category)
        self.assertEqual(obs["note"][0]["text"], "New thoughts.")

    def test_a_draft_is_not_a_document_and_other_staff_cannot_export(self):
        nid = self.start().data["id"]
        self.assertEqual(self.fhir(nid).status_code, 409)
        self.ready(nid, safety_answer="NO", **self.answers(q1="Talked."))
        self.act("care-psy-note-sign", nid)
        self.assertEqual(self.fhir(nid, auth=self.psych_auth).status_code, 403)


class ScoreChangeTests(PsyNoteTestCase):
    """PSY-CHANGE: a change between two recorded scores is suggested, and only
    the clinician says what it means."""

    def score(self, answers):
        return self.post(
            "care-client-assessments",
            {"instrument": "GAD7", "answers": answers, "context": "THERAPY"},
        ).data

    def test_score_change_is_offered_blocks_signing_and_is_used_once_decided(self):
        self.score([3] * 7)
        latest = self.score([1] * 7)
        nid = self.start().data["id"]
        data = self.ready(
            nid, safety_answer="NO", score_id=latest["id"], **self.answers(q4="Calmer this week.")
        ).data
        change = data["score_changes"][0]
        self.assertIn("GAD-7 21", change["summary"])
        self.assertIn("then 7", change["summary"])
        self.assertIn("Improved 14 points", change["change"])
        self.assertIn("CHANGES_UNRESOLVED", self.blocker_codes(data))
        self.assertNotIn("Clinician:", data["sections"]["response"])
        # The system never names it improvement on its own.
        self.assertNotIn("improvement noted", data["sections"]["response"])
        bad = self.patch(nid, {"change_link": {"key": "score:x:y", "decision": "IMPROVEMENT"}})
        self.assertEqual(bad.status_code, 400)
        self.patch(nid, {"change_link": {"key": change["key"], "decision": "IMPROVEMENT"}})
        data = self.ready(nid).data
        self.assertNotIn("CHANGES_UNRESOLVED", self.blocker_codes(data))
        self.assertIn("Clinician: improvement noted.", data["sections"]["response"])
        self.assertEqual(self.act("care-psy-note-sign", nid).data["status"], "SIGNED")

    def test_not_relevant_adds_nothing_and_a_first_score_offers_nothing(self):
        only = self.score([2] * 7)
        nid = self.start().data["id"]
        data = self.ready(nid, safety_answer="NO", score_id=only["id"], **self.answers(q1="x")).data
        self.assertEqual(data["score_changes"], [])
        later = self.score([2] * 7)
        data = self.ready(nid, score_id=later["id"]).data
        key = data["score_changes"][0]["key"]
        self.patch(nid, {"change_link": {"key": key, "decision": "NOT_RELEVANT"}})
        data = self.ready(nid).data
        self.assertNotIn("Change since the previous score", data["sections"]["response"])
        self.assertEqual(data["blockers"], [])


class SessionHistoryTests(PsyNoteTestCase):
    """PSY-CHANGE: the previous signed note's safety answer and goal decisions
    appear beside today's, in the clinician's own words of the time."""

    def sign_one(self, **body):
        nid = self.start().data["id"]
        self.ready(nid, **body)
        self.assertEqual(self.act("care-psy-note-sign", nid).data["status"], "SIGNED")

    def test_a_changed_safety_answer_names_the_previous_session(self):
        self.sign_one(safety_answer="NO", **self.answers(q1="Settled week."))
        nid = self.start().data["id"]
        self.patch(nid, {"safety_answer": "YES"})
        data = self.ready(nid).data
        self.assertIn(
            "Change from the previous psychotherapy session", data["sections"]["risk_safety"]
        )
        self.assertIn(
            "no new or changed safety concern was identified at that session",
            data["sections"]["risk_safety"],
        )

    def test_not_assessed_after_no_says_nothing_about_the_previous_session(self):
        self.sign_one(safety_answer="NO", **self.answers(q1="Settled week."))
        nid = self.start().data["id"]
        data = self.ready(nid, safety_answer="NOT_ASSESSED").data
        self.assertNotIn("previous", data["sections"]["risk_safety"].lower())

    def test_goal_decision_shows_the_previous_decision(self):
        from apps.client_registry.models import Patient

        from . import services

        with platform_admin_context():
            plan = services.get_or_create_care_plan(Patient.objects.get(pk=self.pid), self.nurse)
            plan.goal_items = [{"goal": "Sleep through the night"}]
            plan.save()
        first = self.start().data["id"]
        self.patch(first, {"goal_link": {"goal_index": 0, "decision": "PROGRESS"}})
        self.ready(first, safety_answer="NO", **self.answers(q4="Slept better."))
        self.act("care-psy-note-sign", first)
        nid = self.start().data["id"]
        self.patch(nid, {"goal_link": {"goal_index": 0, "decision": "BARRIER"}})
        data = self.ready(nid, safety_answer="NO", **self.answers(q4="Woke every night.")).data
        self.assertIn("barrier or setback noted. Previous session (", data["sections"]["response"])
        self.assertIn("): progress noted.", data["sections"]["response"])


class ChangeOrganizerUnitTests(SimpleTestCase):
    def test_safety_history_only_on_a_difference(self):
        before = {"answer": "YES", "date": "2026-11-01"}
        self.assertEqual(org.safety_history("YES", before), "")
        self.assertIn(
            "a new or changed safety concern was recorded", org.safety_history("NO", before)
        )
        self.assertIn("was recorded", org.safety_history("NOT_ASSESSED", before))
        self.assertEqual(org.safety_history("NOT_ASSESSED", {"answer": "NO", "date": "x"}), "")
        self.assertEqual(org.safety_history("NO", None), "")

    def test_change_lines_ignore_undecided_stale_and_not_relevant(self):
        changes = [{"key": "a", "summary": "GAD-7 21, then 7: Improved 14 points."}]
        self.assertEqual(org.change_lines(changes, []), [])
        self.assertEqual(org.change_lines(changes, [{"key": "old", "status": "IMPROVEMENT"}]), [])
        self.assertEqual(org.change_lines(changes, [{"key": "a", "status": "NOT_RELEVANT"}]), [])
        self.assertEqual(
            org.change_lines(changes, [{"key": "a", "status": "DETERIORATION"}]),
            ["GAD-7 21, then 7: Improved 14 points. Clinician: deterioration noted."],
        )
