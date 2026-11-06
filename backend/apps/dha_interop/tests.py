from django.test import SimpleTestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.clinical_encounter.models import Encounter
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .fhir_mapper import (
    build_admission_bundle,
    build_client_history_bundle,
    build_condition_resource,
)
from .fhir_validation import assert_conformant, validate_resource
from .models import IcdCodeIndex
from .sync import sync_terminology_source


class TerminologySearchTests(APITestCase):
    """
    docs/10-API-SPECIFICATION.md §10.5-10.8 — these are autocomplete
    endpoints and must return a plain list, not the paginated
    {count, next, previous, results} envelope (caught by a real browser
    walkthrough during Phase 3: the frontend expected an array and silently
    rendered nothing when it got the envelope object instead).
    """

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            org = Organization.objects.create(
                name="Org", slug="org", facility_type="MENTAL_HEALTH_MHP"
            )
            self.user = User.objects.create_user(
                email="clinician@org.test",
                password="Password123!",
                organization=org,
                is_active=True,
            )
        self.access, _ = issue_tokens(self.user)

    def test_icd11_search_returns_plain_list(self):
        response = self.client.get(
            reverse("terminology-icd11-search") + "?q=depress",
            HTTP_AUTHORIZATION=f"Bearer {self.access}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.data, list)
        self.assertIn("6A70", [row["code"] for row in response.data])

    def test_icd11_search_empty_query_still_returns_a_list(self):
        response = self.client.get(
            reverse("terminology-icd11-search"), HTTP_AUTHORIZATION=f"Bearer {self.access}"
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.data, list)


class ClientHistoryFhirBundleTests(APITestCase):
    """
    docs/08-DHA-SHA-INTEGRATION.md §8.1 names `Observation` as a target
    resource nothing constructed until this — closes that gap for Client
    History's substance-use screening entries, per
    /home/nick/.claude/plans/drifting-baking-falcon.md.
    """

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org", facility_type="MENTAL_HEALTH_MHP"
            )
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Faith",
                last_name="Mwangi",
                gender="FEMALE",
                date_of_birth="1997-03-14",
            )

    def test_build_client_history_bundle_includes_condition_and_observation(self):
        from apps.mhp_program.models import BiopsychosocialAssessment, SubstanceUseEntry

        from .fhir_mapper import build_client_history_bundle

        with platform_admin_context():
            assessment = BiopsychosocialAssessment.objects.create(
                organization=self.org,
                patient=self.patient,
                presenting_problem="Persistent anxiety and sleep disturbance.",
                status="SUBMITTED",
            )
            SubstanceUseEntry.objects.create(
                organization=self.org,
                assessment=assessment,
                substance="Alcohol",
                frequency="Weekly",
                route="Oral",
            )
            bundle = build_client_history_bundle(assessment)

        self.assertEqual(bundle["resourceType"], "Bundle")
        self.assertEqual(bundle["type"], "document")
        resource_types = [e["resource"]["resourceType"] for e in bundle["entry"]]
        self.assertIn("Composition", resource_types)
        self.assertIn("Patient", resource_types)
        self.assertIn("Condition", resource_types)
        self.assertIn("Observation", resource_types)

        observation = next(
            e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Observation"
        )
        # CLAUDE.md §6: no LOINC code is verified for this yet — text only.
        self.assertEqual(observation["code"], {"text": "Substance use"})
        self.assertEqual(observation["category"][0]["coding"][0]["code"], "social-history")
        self.assertEqual(observation["valueCodeableConcept"]["text"], "Alcohol")

    def test_build_client_history_bundle_without_substance_entries_still_builds(self):
        from apps.mhp_program.models import BiopsychosocialAssessment

        from .fhir_mapper import build_client_history_bundle

        with platform_admin_context():
            assessment = BiopsychosocialAssessment.objects.create(
                organization=self.org, patient=self.patient, status="DRAFT"
            )
            bundle = build_client_history_bundle(assessment)

        self.assertEqual(bundle["resourceType"], "Bundle")
        resource_types = [e["resource"]["resourceType"] for e in bundle["entry"]]
        self.assertIn("Patient", resource_types)
        self.assertIn("Composition", resource_types)
        self.assertNotIn("Observation", resource_types)


class TerminologySyncTests(APITestCase):
    """docs/08-DHA-SHA-INTEGRATION.md §8.2 — generic terminology sync job pattern."""

    def test_sync_skips_honestly_when_source_not_configured(self):
        run = sync_terminology_source("ICD11")
        self.assertEqual(run.status, "SKIPPED_NOT_CONFIGURED")
        self.assertIn("not configured", run.detail)
        self.assertIsNotNone(run.finished_at)

    def test_sync_upserts_records_when_source_configured(self):
        from unittest.mock import Mock, patch

        fake_response = Mock(status_code=200)
        fake_response.raise_for_status.return_value = None
        fake_response.json.return_value = [
            {"code": "9Z99", "description": "Test synced ICD-11 code"},
        ]
        with patch("apps.dha_interop.sync.requests.get", return_value=fake_response):
            with self.settings(ICD11_SYNC_SOURCE_URL="https://icd.example.test/codes"):
                run = sync_terminology_source("ICD11")
        self.assertEqual(run.status, "SUCCESS")
        self.assertEqual(run.records_synced, 1)
        self.assertEqual(
            IcdCodeIndex.objects.get(code="9Z99").description, "Test synced ICD-11 code"
        )

    def test_sync_reports_failure_honestly_on_http_error(self):
        from unittest.mock import patch

        import requests

        with patch(
            "apps.dha_interop.sync.requests.get", side_effect=requests.ConnectionError("down")
        ):
            with self.settings(ICD11_SYNC_SOURCE_URL="https://icd.example.test/codes"):
                run = sync_terminology_source("ICD11")
        self.assertEqual(run.status, "FAILED")
        self.assertIn("down", run.detail)


class FhirR4ConformanceTests(APITestCase):
    """
    CLAUDE.md "Project standing rules — FHIR R4 conformance" §2 rung 2 —
    every FHIR bundle/resource this app actually constructs must pass HL7's
    real R4 4.0.1 base schema (`apps.dha_interop.fhir_validation`),
    independent of `fhir_mapper.py`'s use of `fhir.resources.R4B` for
    construction (see that module's docstring, and CLAUDE.md §1's documented
    exception, for why R4B). A failure here means `fhir_mapper.py` produced
    something R4B allows but real R4 doesn't — exactly the drift this
    validator exists to catch, and exactly what "Validator green in CI ...
    a profile violation fails the build" (CLAUDE.md §3 item 5) means for the
    resources this app already builds.
    """

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org-fhir-conformance", facility_type="MENTAL_HEALTH_MHP"
            )
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Faith",
                last_name="Mwangi",
                gender="FEMALE",
                date_of_birth="1997-03-14",
            )

    def test_validator_rejects_a_resource_missing_a_required_field(self):
        """Proves the gate has teeth: a real R4 cardinality violation must fail."""
        errors = validate_resource(
            {
                "resourceType": "Encounter",
                "status": "in-progress",
                "subject": {"reference": "urn:x"},
            }
        )
        self.assertTrue(any("class" in message for message in errors))

    def test_validator_accepts_a_conformant_resource(self):
        self.assertEqual(validate_resource({"resourceType": "Patient", "gender": "female"}), [])

    def test_admission_bundle_for_voluntary_admission_is_r4_conformant(self):
        from apps.ipd_ward.models import Admission, Bed, Ward

        with platform_admin_context():
            ward = Ward.objects.create(organization=self.org, name="Ward A")
            bed = Bed.objects.create(organization=self.org, ward=ward, bed_number="A1")
            admission = Admission.objects.create(
                organization=self.org,
                patient=self.patient,
                bed=bed,
                admission_type="VOLUNTARY",
                reason_for_admission="Stabilization",
            )
            bundle = build_admission_bundle(admission)
        assert_conformant(bundle)
        types = [e["resource"]["resourceType"] for e in bundle["entry"]]
        self.assertEqual(types, ["Patient", "Encounter"])

    def test_admission_bundle_for_involuntary_admission_with_risk_flags_is_r4_conformant(self):
        """Edge case: risk flags recorded at an involuntary admission. The bundle
        carries the RiskAssessment and nothing that names the legal basis."""
        from apps.ipd_ward.models import Admission, Bed, Ward

        with platform_admin_context():
            ward = Ward.objects.create(organization=self.org, name="Ward B")
            bed = Bed.objects.create(organization=self.org, ward=ward, bed_number="B1")
            admission = Admission.objects.create(
                organization=self.org,
                patient=self.patient,
                bed=bed,
                admission_type="INVOLUNTARY",
                risk_self_harm=True,
                risk_to_others=False,
                observation_level="CLOSE",
                risk_summary="Actively suicidal on presentation; continuous observation ordered.",
            )
            bundle = build_admission_bundle(admission)
        assert_conformant(bundle)
        types = [e["resource"]["resourceType"] for e in bundle["entry"]]
        self.assertEqual(types, ["Patient", "Encounter", "RiskAssessment"])
        self.assertNotIn("INVOLUNTARY", str(bundle).upper())

    def test_client_history_bundle_with_substance_entry_is_r4_conformant(self):
        from apps.mhp_program.models import BiopsychosocialAssessment, SubstanceUseEntry

        with platform_admin_context():
            assessment = BiopsychosocialAssessment.objects.create(
                organization=self.org,
                patient=self.patient,
                presenting_problem="Persistent anxiety and sleep disturbance.",
                status="SUBMITTED",
            )
            SubstanceUseEntry.objects.create(
                organization=self.org,
                assessment=assessment,
                substance="Alcohol",
                frequency="Weekly",
                route="Oral",
            )
            bundle = build_client_history_bundle(assessment)
        assert_conformant(bundle)

    def test_client_history_bundle_without_substance_entries_is_r4_conformant(self):
        """Refusal/omission case: a draft intake with no presenting problem or substance entries."""
        from apps.mhp_program.models import BiopsychosocialAssessment

        with platform_admin_context():
            assessment = BiopsychosocialAssessment.objects.create(
                organization=self.org, patient=self.patient, status="DRAFT"
            )
            bundle = build_client_history_bundle(assessment)
        assert_conformant(bundle)

    def test_condition_carries_verification_and_clinical_status(self):
        """A ruled-out diagnosis must travel as `refuted` — both statuses are R4
        modifier elements, so leaving them off asserts the diagnosis."""
        import json

        from apps.clinical_encounter.models import DiagnosisCode

        with platform_admin_context():
            encounter = Encounter.objects.create(organization=self.org, patient=self.patient)
            for code, primary, certainty in (
                ("6A70", True, "CONFIRMED"),
                ("6A60", False, "RULED_OUT"),
            ):
                DiagnosisCode.objects.create(
                    organization=self.org,
                    encounter=encounter,
                    icd11_code=IcdCodeIndex.objects.get(code=code),
                    is_primary=primary,
                    verification_status=certainty,
                )
            unstated = DiagnosisCode.objects.create(
                organization=self.org,
                encounter=encounter,
                icd11_code=IcdCodeIndex.objects.get(code="6B00"),
                verification_status="",
            )
            resources = [
                build_condition_resource(d, "urn:citramac:patient:x")
                for d in encounter.diagnoses.select_related("icd11_code")
            ]
        conditions = {}
        for resource in resources:
            data = json.loads(resource.model_dump_json(exclude_none=True))
            self.assertEqual(validate_resource(data), [])
            conditions[data["code"]["coding"][0]["code"]] = data
        confirmed, refuted = conditions["6A70"], conditions["6A60"]
        self.assertEqual(confirmed["verificationStatus"]["coding"][0]["code"], "confirmed")
        self.assertEqual(confirmed["clinicalStatus"]["coding"][0]["code"], "active")
        self.assertEqual(refuted["verificationStatus"]["coding"][0]["code"], "refuted")
        self.assertNotIn("clinicalStatus", refuted)
        self.assertNotIn("verificationStatus", conditions[unstated.icd11_code_id])


class FhirR4ConformanceInteropExamplesTests(SimpleTestCase):
    """Published admission and client-history examples (CLAUDE.md §3 item 8): a
    routine case, an edge case and a refusal or omission for each."""

    def _folder(self):
        from pathlib import Path

        return Path(__file__).parent / "fhir_examples"

    def _load(self, name):
        import json

        return json.loads((self._folder() / f"{name}.json").read_text())

    def _resources(self, bundle, resource_type):
        return [
            e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == resource_type
        ]

    def test_every_example_is_valid_r4_with_three_per_kind(self):
        import json

        from .fhir_validation.validator import validate_bundle

        for kind in ("admission", "client-history"):
            paths = sorted(self._folder().glob(f"{kind}-*.json"))
            self.assertGreaterEqual(len(paths), 3, kind)
            for path in paths:
                with self.subTest(example=path.name):
                    self.assertEqual(validate_bundle(json.loads(path.read_text())), {})

    def test_admission_never_names_its_legal_basis(self):
        for path in sorted(self._folder().glob("admission-*.json")):
            with self.subTest(example=path.name):
                bundle = self._load(path.stem)
                self.assertEqual(self._resources(bundle, "Consent"), [])
                self.assertNotIn("INVOLUNTARY", path.read_text().upper())

    def test_involuntary_admission_carries_its_recorded_risk(self):
        bundle = self._load("admission-edge-involuntary-with-risk-flags")
        self.assertEqual(len(self._resources(bundle, "RiskAssessment")), 1)

    def test_omissions_send_only_what_was_recorded(self):
        for name in ("client-history-omission-draft-nothing-recorded",):
            with self.subTest(example=name):
                types = [e["resource"]["resourceType"] for e in self._load(name)["entry"]]
                self.assertEqual(types, ["Composition", "Patient"])
