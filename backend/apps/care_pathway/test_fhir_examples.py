"""Published discharge-summary examples (docs/17, CLAUDE.md §3 item 8).

Every example under `fhir_examples/` must stay valid against HL7's R4 4.0.1
base schema. The class name starts with `FhirR4Conformance` so the CI step that
selects `-k FhirR4Conformance` runs it on every build.
"""

import json
from pathlib import Path

from django.test import SimpleTestCase

from apps.dha_interop.fhir_validation.validator import validate_bundle

EXAMPLES = Path(__file__).parent / "fhir_examples"


def _load(name):
    return json.loads((EXAMPLES / f"{name}.json").read_text())


def _types(bundle):
    return [entry["resource"]["resourceType"] for entry in bundle["entry"]]


class FhirR4ConformanceDischargeExamplesTests(SimpleTestCase):
    def test_there_are_at_least_three_examples(self):
        self.assertGreaterEqual(len(list(EXAMPLES.glob("*.json"))), 3)

    def test_every_example_is_a_valid_r4_document_bundle(self):
        for path in sorted(EXAMPLES.glob("*.json")):
            with self.subTest(example=path.name):
                bundle = json.loads(path.read_text())
                self.assertEqual(validate_bundle(bundle), {})
                self.assertEqual(bundle["type"], "document")
                self.assertEqual(_types(bundle)[0], "Composition")
                composition = bundle["entry"][0]["resource"]
                # Who, when and on whose authority (CLAUDE.md §3 item 4).
                self.assertTrue(composition["author"])
                self.assertEqual(composition["attester"][0]["mode"], "legal")
                provenance = bundle["entry"][-1]["resource"]
                self.assertEqual(provenance["resourceType"], "Provenance")
                self.assertTrue(provenance["agent"][0]["role"][0]["text"])

    def test_routine_example_has_a_coded_diagnosis_and_a_live_medicine(self):
        bundle = _load("discharge-routine-home")
        self.assertIn("Condition", _types(bundle))
        medicines = [
            e["resource"]
            for e in bundle["entry"]
            if e["resource"]["resourceType"] == "MedicationRequest"
        ]
        self.assertEqual([m["status"] for m in medicines], ["active"])

    def test_edge_example_records_legal_status_and_a_stopped_medicine(self):
        bundle = _load("discharge-edge-involuntary-ama")
        composition = bundle["entry"][0]["resource"]
        self.assertIn("Legal status at discharge", [s["title"] for s in composition["section"]])
        medicines = [
            e["resource"]
            for e in bundle["entry"]
            if e["resource"]["resourceType"] == "MedicationRequest"
        ]
        self.assertEqual([m["status"] for m in medicines], ["stopped"])
        encounter = next(
            e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Encounter"
        )
        self.assertEqual(
            encounter["hospitalization"]["dischargeDisposition"]["coding"][0]["code"], "AMA"
        )

    def test_amendment_example_replaces_the_earlier_version(self):
        composition = _load("discharge-amendment-v2")["entry"][0]["resource"]
        self.assertEqual(composition["status"], "amended")
        self.assertEqual(composition["relatesTo"][0]["code"], "replaces")

    def test_omission_example_leaves_out_what_was_not_recorded(self):
        bundle = _load("discharge-omission-no-diagnosis-or-medication")
        self.assertNotIn("Condition", _types(bundle))
        self.assertNotIn("MedicationRequest", _types(bundle))
        titles = [s["title"] for s in bundle["entry"][0]["resource"]["section"]]
        self.assertNotIn("Diagnoses", titles)
        self.assertNotIn("Discharge medications", titles)
