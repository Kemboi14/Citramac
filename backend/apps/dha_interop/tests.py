from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.clinical_encounter.models import Encounter, ReferralPacket
from apps.insurance_claims.models import InsuranceClaim, PreAuthorization, Remittance
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .fhir_mapper import build_admission_bundle, build_client_history_bundle, build_referral_bundle
from .fhir_validation import assert_conformant, validate_resource
from .hie_client import transmit_referral
from .models import FhirResourceCache, IcdCodeIndex, NationalDrugIndex
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


class FhirMapperAndHieClientTests(APITestCase):
    """docs/08-DHA-SHA-INTEGRATION.md §8.1 — real FHIR Bundle construction + honest HIE stub."""

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
            self.encounter = Encounter.objects.create(organization=self.org, patient=self.patient)
            self.referral = ReferralPacket.objects.create(
                organization=self.org, encounter=self.encounter, destination_facility="KNH"
            )

    def test_build_referral_bundle_is_a_valid_fhir_document_bundle(self):
        with platform_admin_context():
            bundle = build_referral_bundle(self.referral)
        self.assertEqual(bundle["resourceType"], "Bundle")
        self.assertEqual(bundle["type"], "document")
        composition = bundle["entry"][0]["resource"]
        self.assertEqual(composition["resourceType"], "Composition")
        patient_resource = next(
            e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Patient"
        )
        self.assertEqual(patient_resource["name"][0]["family"], "Mwangi")

    def test_build_referral_bundle_includes_diagnoses(self):
        with platform_admin_context():
            from apps.clinical_encounter.models import DiagnosisCode

            DiagnosisCode.objects.create(
                organization=self.org,
                encounter=self.encounter,
                icd11_code=IcdCodeIndex.objects.get(code="6A70"),
                is_primary=True,
            )
            bundle = build_referral_bundle(self.referral)
        conditions = [
            e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Condition"
        ]
        self.assertEqual(len(conditions), 1)
        self.assertEqual(conditions[0]["code"]["coding"][0]["code"], "6A70")

    def test_transmit_referral_caches_and_reports_failure_with_no_endpoint(self):
        with platform_admin_context():
            bundle = build_referral_bundle(self.referral)
            cache_entry = transmit_referral(self.referral, bundle)
        self.assertEqual(cache_entry.status, "FAILED")
        self.assertIn("not configured", cache_entry.transmission_detail)
        with platform_admin_context():
            self.assertEqual(
                FhirResourceCache.objects.filter(related_object_id=self.referral.id).count(), 1
            )

    def test_transmit_referral_sends_when_endpoint_configured(self):
        from unittest.mock import Mock, patch

        fake_response = Mock(status_code=200)
        fake_response.raise_for_status.return_value = None
        with patch("apps.dha_interop.hie_client.requests.post", return_value=fake_response) as post:
            with self.settings(HIE_ENDPOINT_URL="https://hie.example.test/fhir/Bundle"):
                with platform_admin_context():
                    bundle = build_referral_bundle(self.referral)
                    cache_entry = transmit_referral(self.referral, bundle)
        post.assert_called_once()
        self.assertEqual(cache_entry.status, "SENT")


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
        self.assertEqual(observation["code"]["coding"][0]["system"], "http://loinc.org")
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


class SeedDhaSandboxDemoCommandTests(TestCase):
    """
    docs/08-DHA-SHA-INTEGRATION.md §8.6 / docs/11-ROADMAP-AND-PHASES.md
    Phase 9 — the seeded-sandbox demo data DHA evaluators walk through live.
    """

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Demo Org", slug="demo-org", facility_type="MENTAL_HEALTH_MHP"
            )
            self.patient = Patient.objects.create(
                organization=self.org,
                citramac_number="TEST-SEED-0001",
                first_name="Faith",
                last_name="Mwangi",
                gender="FEMALE",
                date_of_birth="1997-03-14",
            )
            self.encounter = Encounter.objects.create(organization=self.org, patient=self.patient)

    def test_seeds_full_cycle(self):
        call_command("seed_dha_sandbox_demo", org_slug="demo-org")

        with platform_admin_context():
            pre_auth = PreAuthorization.objects.get(patient=self.patient)
            claim = InsuranceClaim.objects.get(patient=self.patient)
            remittance = Remittance.objects.get(claim=claim)
            referral = ReferralPacket.objects.get(encounter=self.encounter)

            self.assertEqual(pre_auth.status, "SUBMITTED")
            self.assertTrue(pre_auth.sha_reference)
            self.assertEqual(claim.status, "SUBMITTED")
            self.assertTrue(claim.sha_reference)
            self.assertGreater(remittance.amount_paid, 0)
            self.assertEqual(referral.fhir_bundle_json.get("resourceType"), "Bundle")

    def test_rerun_is_idempotent(self):
        call_command("seed_dha_sandbox_demo", org_slug="demo-org")
        call_command("seed_dha_sandbox_demo", org_slug="demo-org")

        with platform_admin_context():
            self.assertEqual(PreAuthorization.objects.filter(patient=self.patient).count(), 1)
            self.assertEqual(InsuranceClaim.objects.filter(patient=self.patient).count(), 1)
            self.assertEqual(Remittance.objects.filter(claim__patient=self.patient).count(), 1)
            self.assertEqual(ReferralPacket.objects.filter(encounter=self.encounter).count(), 1)

    def test_raises_without_patient(self):
        with platform_admin_context():
            empty_org = Organization.objects.create(
                name="Empty Org", slug="empty-org", facility_type="MENTAL_HEALTH_MHP"
            )
        with self.assertRaises(CommandError):
            call_command("seed_dha_sandbox_demo", org_slug=empty_org.slug)

    def test_raises_without_encounter(self):
        with platform_admin_context():
            org = Organization.objects.create(
                name="No Encounter Org", slug="no-encounter-org", facility_type="MENTAL_HEALTH_MHP"
            )
            Patient.objects.create(
                organization=org,
                citramac_number="TEST-SEED-0002",
                first_name="No",
                last_name="Encounter",
                gender="FEMALE",
                date_of_birth="1990-01-01",
            )
        with self.assertRaises(CommandError):
            call_command("seed_dha_sandbox_demo", org_slug=org.slug)


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

    def test_referral_bundle_with_diagnosis_and_prescription_is_r4_conformant(self):
        from apps.clinical_encounter.models import DiagnosisCode, Prescription, PrescriptionItem

        with platform_admin_context():
            encounter = Encounter.objects.create(organization=self.org, patient=self.patient)
            DiagnosisCode.objects.create(
                organization=self.org,
                encounter=encounter,
                icd11_code=IcdCodeIndex.objects.get(code="6A70"),
                is_primary=True,
            )
            drug = NationalDrugIndex.objects.create(
                code="RX-CONF-001", generic_name="Fluoxetine", form="Capsule", strength="20mg"
            )
            prescription = Prescription.objects.create(organization=self.org, encounter=encounter)
            PrescriptionItem.objects.create(
                organization=self.org,
                prescription=prescription,
                drug=drug,
                dose="20mg",
                route="Oral",
                frequency="Once daily",
                duration="30 days",
            )
            referral = ReferralPacket.objects.create(
                organization=self.org, encounter=encounter, destination_facility="KNH"
            )
            bundle = build_referral_bundle(referral)
        assert_conformant(bundle)

    def test_referral_bundle_with_no_diagnoses_or_prescriptions_is_r4_conformant(self):
        """Edge case: a referral with nothing but the Composition + Patient."""
        with platform_admin_context():
            encounter = Encounter.objects.create(organization=self.org, patient=self.patient)
            referral = ReferralPacket.objects.create(
                organization=self.org, encounter=encounter, destination_facility="KNH"
            )
            bundle = build_referral_bundle(referral)
        assert_conformant(bundle)

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
                consent_status="OBTAINED",
                consent_at=timezone.now(),
            )
            bundle = build_admission_bundle(admission)
        assert_conformant(bundle)

    def test_admission_bundle_for_involuntary_admission_with_risk_flags_is_r4_conformant(self):
        """
        Edge case: Mental Health Act (Cap. 248) involuntary admission with
        active risk flags — the RiskAssessment branch, not the Consent one.
        """
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
                legal_status="Cap. 248 s.14 order",
            )
            bundle = build_admission_bundle(admission)
        assert_conformant(bundle)

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
