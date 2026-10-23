"""DHA HIE integration: transport, registries, Super Admin settings, the
Shared Health Record exporter and its Kenya Core conformance. The HIE itself
is the scripted FakeHie (test_support) — every request is asserted against
the vendored specification's paths and fields."""

import json
import uuid
from pathlib import Path

import requests
from django.conf import settings
from django.test import SimpleTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import PractitionerCredential, Role, User
from apps.accounts.tokens import issue_tokens
from apps.care_pathway.models import EpisodeOfCare
from apps.client_registry.consent import (
    HIE_GENERAL,
    HIE_MENTAL_HEALTH,
    capture_consent,
)
from apps.client_registry.models import Patient, PatientIdentifier
from apps.clinical_encounter.models import DiagnosisCode, Encounter
from apps.mhp_program.models import CareTeamMembership
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.crypto import decrypt_value
from apps.tenancy.models import Branch, Organization, PlatformHieSettings

from . import hie_api, hie_client, registries, shr
from .fhir_validation import kenya_core, validate_resource
from .models import FhirResourceCache, IcdCodeIndex, ShaTransactionLog, ShrConsent
from .test_support import FakeHie

FR = "TEST-FR-1"  # test fixture, not a real facility code
CR = "TEST-CR-0001"  # test fixture, not a real Client Registry ID
LABELS = {
    "data": [
        {"label": "N", "system": "http://terminology.hl7.org/CodeSystem/v3-Confidentiality"},
        {"label": "R", "system": "http://terminology.hl7.org/CodeSystem/v3-Confidentiality"},
        {"label": "PSY", "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode"},
        {"label": "SUD", "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode"},
    ]
}
EXAMPLES = Path(__file__).parent / "fhir_examples"


class HieFixture(APITestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug=f"hie-{uuid.uuid4().hex[:6]}", facility_type="MENTAL_HEALTH_MHP"
            )
            self.branch = Branch.objects.create(
                organization=self.org,
                name="Main",
                facility_level="L4",
                sha_claims_enabled=True,
                sha_fr_code=FR,
            )
            self.clinician = User.objects.create_user(
                email=f"dr-{uuid.uuid4().hex[:6]}@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
                first_name="Wanjiru",
                last_name="Otieno",
            )
            self.clinician.roles.add(Role.objects.get(name="Psychiatrist", organization=None))
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Amina",
                last_name="Kamau",
                gender="FEMALE",
                date_of_birth="1992-03-14",
                payer="SHA",
            )
            CareTeamMembership.objects.create(
                organization=self.org, patient=self.patient, user=self.clinician, role="THERAPIST"
            )
            self.episode = EpisodeOfCare.objects.create(
                organization=self.org,
                patient=self.patient,
                branch=self.branch,
                status="active",
                period_start=timezone.now() - timezone.timedelta(days=3),
            )
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(self.clinician)[0]}"}

    def verified_cr(self):
        with platform_admin_context():
            PatientIdentifier.objects.create(
                organization=self.org,
                patient=self.patient,
                kind=PatientIdentifier.KIND_CLIENT_REGISTRY,
                value=CR,
                verified_at=timezone.now(),
                verified_by_source=registries.CLIENT_REGISTRY_SOURCE,
            )


# ── Transport ──


class HieTransportTests(HieFixture):
    def test_not_configured_is_refused_and_logged_never_silent(self):
        with FakeHie(configured=False):
            with platform_admin_context(), self.assertRaises(hie_api.HieNotConfigured):
                hie_api.call("GET", "/patients", transaction_type="CLIENT_LOOKUP", platform=True)
            with platform_admin_context():
                log = ShaTransactionLog.objects.get()
        self.assertEqual(log.status, "FAILED")
        self.assertIn("not configured", log.error_detail)

    def test_token_is_cached_and_refreshed_once_on_401(self):
        with FakeHie() as hie:
            hie.sequence(
                "GET",
                "/facilities/search",
                (200, {"frCode": FR}),
                (401, {"error": "Unauthorized", "message": "expired"}),
                (200, {"frCode": FR}),
            )
            with platform_admin_context():
                hie_api.call("GET", "/facilities/search", transaction_type="FACILITY_LOOKUP", platform=True)
                hie_api.call("GET", "/facilities/search", transaction_type="FACILITY_LOOKUP", platform=True)
        # One sign-in served the first call; the 401 forced exactly one more.
        self.assertEqual(hie.token_calls, 2)
        self.assertEqual(len(hie.calls), 3)
        self.assertEqual(hie.calls[-1][2]["headers"]["Authorization"], "Bearer tok-2")

    def test_service_account_names_the_facility_by_fr_code(self):
        with FakeHie() as hie:
            hie.on("GET", "/patients/eligibility", {"memberCrNumber": CR})
            with platform_admin_context():
                hie_api.call(
                    "GET", "/patients/eligibility", transaction_type="MEMBER_VERIFICATION",
                    branch=self.branch,
                )
        headers = hie.calls[0][2]["headers"]
        self.assertEqual(headers["X-Facility-Id"], FR)
        self.assertEqual(headers["X-Facility-Id-Type"], "fr-code")

    def test_a_branch_with_its_own_credentials_sends_no_facility_headers(self):
        from apps.tenancy.crypto import encrypt_value

        with platform_admin_context():
            Branch.objects.filter(pk=self.branch.pk).update(
                sha_api_credentials_encrypted=encrypt_value(
                    json.dumps({"client_id": "facility", "client_secret": "s"})
                )
            )
            self.branch.refresh_from_db()
        with FakeHie() as hie:
            hie.on("GET", "/patients/eligibility", {})
            with platform_admin_context():
                hie_api.call(
                    "GET", "/patients/eligibility", transaction_type="MEMBER_VERIFICATION",
                    branch=self.branch,
                )
        self.assertNotIn("X-Facility-Id", hie.calls[0][2]["headers"])

    def test_errors_keep_the_message_and_trace_id_and_otps_are_redacted(self):
        with FakeHie() as hie:
            hie.on(
                "POST",
                "/claims/visit",
                {"error": "Bad Request", "message": "OTP is invalid", "trace_id": "abc123"},
                status=400,
            )
            with platform_admin_context(), self.assertRaises(hie_api.HieError) as raised:
                hie_api.call(
                    "POST", "/claims/visit", transaction_type="CLAIM_VISIT", branch=self.branch,
                    json_body={"patient_id": CR, "otp": "123456"},
                )
            with platform_admin_context():
                log = ShaTransactionLog.objects.get()
        self.assertEqual(raised.exception.message, "OTP is invalid")
        self.assertEqual(raised.exception.trace_id, "abc123")
        self.assertEqual(log.trace_id, "abc123")
        self.assertEqual(log.request_payload["json"]["otp"], "[redacted]")
        self.assertNotIn("123456", json.dumps(log.request_payload))

    def test_a_write_is_not_retried_on_timeout_unless_marked_retry_safe(self):
        with FakeHie() as hie:
            hie.on("POST", "/claims/lines", requests.Timeout("slow"))
            with platform_admin_context(), self.assertRaises(hie_api.HieError):
                hie_api.call("POST", "/claims/lines", transaction_type="E_CLAIM", branch=self.branch)
            self.assertEqual(len(hie.calls), 1)
            hie.on("POST", "/claims/submit", requests.Timeout("slow"))
            with platform_admin_context(), self.assertRaises(hie_api.HieError):
                hie_api.call(
                    "POST", "/claims/submit", transaction_type="E_CLAIM", branch=self.branch,
                    retry_safe=True,
                )
        self.assertEqual(len(hie.call("POST", "/claims/submit")), 2)


# ── Registries ──


class RegistryTests(HieFixture):
    def test_facility_found_is_recorded_verbatim_and_not_found_says_so(self):
        record = {"frCode": FR, "officialName": "Test Facility", "shaContractStatus": "As worded"}
        with FakeHie() as hie:
            hie.on("GET", "/facilities/search", record)
            with platform_admin_context():
                registries.verify_branch_facility(self.branch)
        self.assertEqual(hie.calls[0][2]["params"], {"identifier": FR, "identifier-type": "fr-code"})
        self.assertEqual(self.branch.registry_status, Branch.REGISTRY_VERIFIED)
        self.assertEqual(registries.facility_summary(self.branch)["sha_contract_status"], "As worded")
        with FakeHie() as hie:
            hie.on("GET", "/facilities/search", {"error": "Not Found"}, status=404)
            with platform_admin_context():
                registries.verify_branch_facility(self.branch)
        self.assertEqual(self.branch.registry_status, Branch.REGISTRY_NOT_FOUND)
        self.assertIn(FR, self.branch.registry_problem)

    def test_client_registry_search_then_confirm_adds_a_verified_slice(self):
        with platform_admin_context():
            PatientIdentifier.objects.create(
                organization=self.org, patient=self.patient, kind="NATIONAL_ID", value="TEST-NID-1"
            )
        record = {
            "id": CR,
            "first_name": "Amina",
            "last_name": "Kamau",
            "identification_type": "National ID",
            "identification_number": "TEST-NID-1",
        }
        url = reverse("patient-client-registry", args=[self.patient.id])
        with FakeHie() as hie:
            hie.on("GET", "/patients", record)
            shown = self.client.post(url, {}, format="json", **self.auth)
            self.assertEqual(shown.status_code, 200, shown.data)
            self.assertEqual(shown.data["match"]["cr_id"], CR)
            self.assertEqual(
                hie.calls[0][2]["params"],
                {"identification_type": "National ID", "identification_number": "TEST-NID-1"},
            )
            with platform_admin_context():
                self.assertFalse(
                    PatientIdentifier.objects.filter(kind="CLIENT_REGISTRY_ID").exists()
                )
            wrong = self.client.post(
                url, {"confirm": True, "cr_id": "SOMEONE-ELSE"}, format="json", **self.auth
            )
            self.assertEqual(wrong.status_code, 400)
            confirmed = self.client.post(
                url, {"confirm": True, "cr_id": CR}, format="json", **self.auth
            )
        self.assertEqual(confirmed.status_code, 200, confirmed.data)
        with platform_admin_context():
            cr = PatientIdentifier.objects.get(kind="CLIENT_REGISTRY_ID")
            nid = PatientIdentifier.objects.get(kind="NATIONAL_ID")
            self.assertEqual(Patient.objects.get(pk=self.patient.pk).first_name, "Amina")
        self.assertEqual(cr.value, CR)
        self.assertIsNotNone(cr.verified_at)
        self.assertEqual(nid.verified_by_source, registries.CLIENT_REGISTRY_SOURCE)

    def test_practitioner_lookup_uses_the_published_regulator_enum(self):
        with platform_admin_context():
            credential = PractitionerCredential.objects.create(
                organization=self.org, user=self.clinician, registration_number="TEST-REG-1"
            )
            with self.assertRaises(registries.RegistryError):
                registries.verify_practitioner(credential)
            credential.hwr_regulator = "KMPDC"
            with FakeHie() as hie:
                hie.on(
                    "GET",
                    "/professionals",
                    {"message": {"membership": {"full_name": "Wanjiru Otieno", "is_active": 1}}},
                )
                registries.verify_practitioner(credential)
        self.assertEqual(hie.calls[0][2]["params"]["regulator"], "KMPDC")
        self.assertEqual(registries.practitioner_summary(credential)["full_name"], "Wanjiru Otieno")
        self.assertEqual(
            registries.claim_practitioner_fields(self.clinician)["practitioner_regulation_body"],
            "KMPDC",
        )


# ── Super Admin settings ──


class PlatformHieSettingsApiTests(APITestCase):
    def setUp(self):
        self.addCleanup(lambda: PlatformHieSettings.objects.all().delete())
        with platform_admin_context():
            self.admin = User.objects.create_superuser(
                email=f"sa-{uuid.uuid4().hex[:6]}@platform.test", password="Password123!"
            )
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(self.admin)[0]}"}

    def test_secret_is_write_only_and_encrypted_and_callback_url_is_shown(self):
        response = self.client.patch(
            reverse("platform-hie-settings"),
            {
                "base_url": "https://hie.example.test/api/v1/",
                "client_id": "client",
                "client_secret": "s3cret",  # pragma: allowlist secret
                "public_api_base_url": "https://app.example.test/api/v1",
                "rotate_callback_token": True,
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn("client_secret", response.data)
        self.assertTrue(response.data["has_credentials"])
        self.assertEqual(response.data["source"], "saved")
        self.assertTrue(
            response.data["callback_url"].startswith("https://app.example.test/api/v1/integrations/dha/")
        )
        stored = PlatformHieSettings.get_solo()
        self.assertEqual(stored.base_url, "https://hie.example.test/api/v1")
        self.assertNotIn("s3cret", stored.client_secret_encrypted)
        self.assertEqual(decrypt_value(stored.client_secret_encrypted), "s3cret")

    def test_test_connection_reports_the_hie_refusal(self):
        with FakeHie():
            with self.settings(HIE_API_CLIENT_SECRET=""):
                result = self.client.post(reverse("platform-hie-settings-test"), {}, **self.auth)
        self.assertFalse(result.data["success"])
        self.assertIn("not configured", result.data["message"])


# ── Kenya Core ──


class KenyaCorePackageTests(SimpleTestCase):
    def test_identifier_system_defaults_are_the_kenya_core_slices(self):
        systems = settings.FHIR_NATIONAL_IDENTIFIER_SYSTEMS
        self.assertEqual(systems["NATIONAL_ID"], kenya_core.identifier_system("nationalId"))
        self.assertEqual(systems["SHA_MEMBER"], kenya_core.identifier_system("shaNumber"))

    def test_codes_only_come_from_the_package(self):
        self.assertEqual(
            kenya_core.coding(shr.CONDITION_CLINICAL_VS, "ACTIVE")["system"],
            "https://fhir.dha.go.ke/terminology/CodeSystem/condition-clinical-status-cs",
        )
        with self.assertRaises(KeyError):
            kenya_core.coding(shr.CONDITION_CLINICAL_VS, "active")

    def test_profile_check_catches_missing_required_and_unbound_codes(self):
        problems = kenya_core.check(
            {
                "resourceType": "Condition",
                "id": "x",
                "meta": {"profile": [kenya_core.condition_profile()]},
                "clinicalStatus": {"coding": [{"system": "urn:wrong", "code": "ACTIVE"}]},
            },
            kenya_core.condition_profile(),
        )
        joined = " ".join(problems)
        self.assertIn("Condition.code: required", joined)
        self.assertIn("Condition.recordedDate: required", joined)
        self.assertIn("Condition.clinicalStatus: not in required ValueSet", joined)


# ── Shared Health Record ──


class ShrTests(HieFixture):
    def setUp(self):
        super().setUp()
        self.verified_cr()
        with platform_admin_context():
            icd, _ = IcdCodeIndex.objects.get_or_create(
                code="TEST-DX", defaults={"description": "Test condition"}
            )
            self.encounter = Encounter.objects.create(
                organization=self.org, patient=self.patient, episode=self.episode,
                opened_by=self.clinician, encounter_type="PSYCHIATRY", status="CLOSED",
                closed_at=timezone.now(),
            )
            self.dx = DiagnosisCode.objects.create(
                organization=self.org, encounter=self.encounter, icd11_code=icd, is_primary=True,
                verification_status="CONFIRMED",
            )

    def consent_yes(self, *types):
        with platform_admin_context():
            for consent_type in types:
                capture_consent(
                    self.patient, self.clinician, True, "v1", "wording", consent_type=consent_type,
                    decision="YES",
                )

    def open_visit(self, hie):
        hie.on("POST", "/shr/consents", {"consent_id": "c-1", "otp_record": "o-1"})
        hie.on(
            "POST", "/shr/consents/c-1/verify",
            {"consent_token": "token-1", "visit_id": "v-1", "consent_status": "Approved"},
        )
        hie.on("GET", "/shr/security-labels", LABELS)
        hie.on("GET", "/shr/resource-labels", {"data": {"labels": [{"label": "R"}]}})
        requested = self.client.post(
            reverse("shr-client", args=[self.patient.id]),
            {"branch": str(self.branch.id), "episode": str(self.episode.id), "visit_type": "OP"},
            format="json",
            **self.auth,
        )
        self.assertEqual(requested.status_code, 201, requested.data)
        verified = self.client.post(
            reverse("shr-consent-action", args=[requested.data["id"], "verify"]),
            {"otp": "4321"},
            format="json",
            **self.auth,
        )
        self.assertEqual(verified.status_code, 200, verified.data)
        self.assertEqual(verified.data["status"], "APPROVED")
        return requested.data["id"]

    def test_consent_request_carries_the_cr_id_and_the_token_is_stored_encrypted(self):
        with FakeHie() as hie:
            consent_id = self.open_visit(hie)
        body = hie.call("POST", "/shr/consents")[0][2]["json"]
        self.assertEqual(body["cr_id"], CR)
        self.assertEqual(body["facility_id"], FR)
        self.assertEqual(body["visit_type"], "OP")
        with platform_admin_context():
            consent = ShrConsent.objects.get(pk=consent_id)
        self.assertNotIn("token-1", consent.consent_token_encrypted)
        self.assertEqual(decrypt_value(consent.consent_token_encrypted), "token-1")

    def test_a_refusal_is_recorded_upstream_not_dropped(self):
        with FakeHie() as hie:
            hie.on("POST", "/shr/consents", {"consent_id": "c-2", "otp_record": "o-2"})
            hie.on("POST", "/shr/consents/c-2/verify", {"consent_status": "Rejected"})
            requested = self.client.post(
                reverse("shr-client", args=[self.patient.id]),
                {"branch": str(self.branch.id), "episode": str(self.episode.id), "visit_type": "OP"},
                format="json",
                **self.auth,
            )
            refused = self.client.post(
                reverse("shr-consent-action", args=[requested.data["id"], "refuse"]),
                {"rejection_reason": "Does not want records shared"},
                format="json",
                **self.auth,
            )
        self.assertEqual(refused.data["status"], "REJECTED")
        body = hie.call("POST", "/shr/consents/c-2/verify")[0][2]["json"]
        self.assertEqual(body["consent_decision"], "Reject")
        self.assertEqual(body["rejection_reason"], "Does not want records shared")

    def test_nothing_is_sent_without_explicit_mental_health_consent(self):
        self.consent_yes(HIE_GENERAL)
        with FakeHie() as hie:
            consent_id = self.open_visit(hie)
            sent = self.client.post(
                reverse("shr-consent-action", args=[consent_id, "send"]), {}, **self.auth
            )
        self.assertEqual(sent.status_code, 400)
        self.assertIn("mental-health", sent.data["error"]["message"])
        self.assertEqual(hie.call("POST", "/shr/bundles"), [])

    def test_substance_use_content_needs_its_own_yes(self):
        from apps.mhp_program.models import SudRehabPlan

        self.consent_yes(HIE_GENERAL, HIE_MENTAL_HEALTH)
        with platform_admin_context():
            SudRehabPlan.objects.create(organization=self.org, patient=self.patient)
        with FakeHie() as hie:
            consent_id = self.open_visit(hie)
            sent = self.client.post(
                reverse("shr-consent-action", args=[consent_id, "send"]), {}, **self.auth
            )
        self.assertEqual(sent.status_code, 400)
        self.assertIn("substance-use", sent.data["error"]["message"])
        self.assertEqual(hie.call("POST", "/shr/bundles"), [])

    def test_a_conformant_labelled_bundle_is_sent_once_and_audited(self):
        self.consent_yes(HIE_GENERAL, HIE_MENTAL_HEALTH)
        with platform_admin_context():
            Encounter.objects.create(
                organization=self.org, patient=self.patient, episode=self.episode,
                encounter_type="PSYCHOTHERAPY",
            )
        with FakeHie() as hie:
            consent_id = self.open_visit(hie)
            hie.on("POST", "/shr/bundles", {"mediator_id": "x", "status": "accepted"})
            preview = self.client.post(
                reverse("shr-consent-action", args=[consent_id, "preview"]), {}, **self.auth
            )
            self.assertEqual(preview.data["problems"], [])
            sent = self.client.post(
                reverse("shr-consent-action", args=[consent_id, "send"]), {}, **self.auth
            )
            again = self.client.post(
                reverse("shr-consent-action", args=[consent_id, "send"]), {}, **self.auth
            )
        self.assertEqual(sent.status_code, 200, sent.data)
        self.assertEqual(again.status_code, 200)
        posts = hie.call("POST", "/shr/bundles")
        self.assertEqual(len(posts), 1)  # same content, same bundle id → not re-sent
        bundle = posts[0][2]["json"]
        self.assertEqual(bundle["type"], "collection")
        types = [e["resource"]["resourceType"] for e in bundle["entry"]]
        self.assertEqual(types, ["EpisodeOfCare", "Encounter", "Condition"])  # no psychotherapy
        encounter = bundle["entry"][1]["resource"]
        self.assertEqual(encounter["episodeOfCare"], [{"reference": f"EpisodeOfCare/{self.episode.id}"}])
        self.assertEqual(encounter["subject"], {"reference": f"Patient/{CR}"})
        for entry in bundle["entry"]:
            codes = {s["code"] for s in entry["resource"]["meta"]["security"]}
            self.assertEqual(codes, {"R", "PSY"})
        self.assertEqual(shr.conformance_problems(bundle), [])
        self.assertEqual(sent.data["sends"][0]["status"], "SENT")
        with platform_admin_context():
            audit = AuditLogEntry.objects.filter(action=AuditLogEntry.ACTION_HIE_DISCLOSURE)
            self.assertEqual(audit.count(), 1)
            self.assertEqual(audit.get().field_diff["labels"], ["R", "PSY"])

    def test_a_missing_psy_label_in_the_catalogue_blocks_sending(self):
        self.consent_yes(HIE_GENERAL, HIE_MENTAL_HEALTH)
        with FakeHie() as hie:
            consent_id = self.open_visit(hie)
            from django.core.cache import cache

            cache.delete("shr-security-labels")
            hie.on("GET", "/shr/security-labels", {"data": LABELS["data"][:2]})
            sent = self.client.post(
                reverse("shr-consent-action", args=[consent_id, "send"]), {}, **self.auth
            )
        self.assertEqual(sent.status_code, 400)
        self.assertIn("PSY", sent.data["error"]["message"])

    def test_reading_the_national_record_needs_a_puid_and_is_audited(self):
        with FakeHie() as hie:
            consent_id = self.open_visit(hie)
            hie.on("GET", "/shr/patient-records", {"resourceType": "Bundle", "type": "searchset"})
            refused = self.client.post(
                reverse("shr-consent-action", args=[consent_id, "records"]), {}, **self.auth
            )
            self.assertEqual(refused.status_code, 400)
            with platform_admin_context():
                PractitionerCredential.objects.create(
                    organization=self.org, user=self.clinician, hwr_puid="TEST-PUID-1"
                )
            read = self.client.post(
                reverse("shr-consent-action", args=[consent_id, "records"]),
                {"resources": ["Condition"]},
                format="json",
                **self.auth,
            )
        self.assertEqual(read.status_code, 200, read.data)
        call = hie.call("GET", "/shr/patient-records")[0][2]
        self.assertEqual(call["headers"]["X-Consent-Token"], "token-1")
        self.assertEqual(call["params"]["practitioner_id"], "TEST-PUID-1")
        with platform_admin_context():
            log = ShaTransactionLog.objects.filter(endpoint="/shr/patient-records").get()
            self.assertNotIn("searchset", json.dumps(log.response_payload))
            self.assertTrue(
                AuditLogEntry.objects.filter(
                    action=AuditLogEntry.ACTION_VIEW, object_id=str(self.patient.id)
                ).exists()
            )

    def test_only_the_care_team_may_use_the_shr(self):
        with platform_admin_context():
            outsider = User.objects.create_user(
                email=f"x-{uuid.uuid4().hex[:6]}@org.test", password="Password123!",
                organization=self.org, is_active=True,
            )
        auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(outsider)[0]}"}
        response = self.client.get(reverse("shr-client", args=[self.patient.id]), **auth)
        self.assertEqual(response.status_code, 403)


class ShrOutboxTests(HieFixture):
    def test_only_shr_bundles_are_deliverable(self):
        with platform_admin_context():
            entry = hie_client.enqueue(self.org.id, "Patient", {"id": "1"}, "k-1")
            hie_client.deliver(entry)
        self.assertEqual(entry.status, "FAILED")
        self.assertIn("Shared Health Record", entry.transmission_detail)

    def test_unconfigured_hie_holds_the_bundle(self):
        with platform_admin_context():
            consent = ShrConsent.objects.create(
                organization=self.org, patient=self.patient, branch=self.branch,
                episode=self.episode, cr_id=CR, visit_type="OP", requested_by=self.clinician,
            )
            entry = hie_client.enqueue(
                self.org.id, hie_client.SHR_BUNDLE, {"resourceType": "Bundle", "id": "b"}, "k-2",
                related=("ShrConsent", consent.id),
            )
        with FakeHie(configured=False):
            with platform_admin_context():
                hie_client.deliver(entry)
        self.assertEqual(entry.status, "CACHED")
        self.assertIn("not configured", entry.transmission_detail)
        with platform_admin_context():
            self.assertEqual(FhirResourceCache.objects.get(pk=entry.pk).attempts, 0)


class FhirR4ConformanceShrExamplesTests(SimpleTestCase):
    """Published SHR examples (CLAUDE.md §3 item 8): a routine visit, an edge
    case (inpatient, substance use) and an omission. Each must be valid base
    R4 4.0.1 and conform to its Kenya Core profile."""

    def test_three_examples_are_r4_and_kenya_core_conformant(self):
        files = sorted(EXAMPLES.glob("shr-*.json"))
        self.assertGreaterEqual(len(files), 3)
        kinds = {f.name.split("-")[1] for f in files}
        self.assertTrue({"routine", "edge"} <= kinds and ({"omission", "refusal"} & kinds))
        for path in files:
            bundle = json.loads(path.read_text())
            self.assertEqual(validate_resource(bundle), [], path.name)
            self.assertEqual(shr.conformance_problems(bundle), [], path.name)
            for entry in bundle["entry"]:
                codes = {s["code"] for s in entry["resource"]["meta"]["security"]}
                self.assertTrue({"R", "PSY"} <= codes, path.name)

    def test_substance_use_example_carries_the_sud_label(self):
        bundle = json.loads((EXAMPLES / "shr-edge-inpatient-substance-use.json").read_text())
        for entry in bundle["entry"]:
            self.assertIn("SUD", {s["code"] for s in entry["resource"]["meta"]["security"]})
