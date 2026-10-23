"""SHA through the DHA HIE: eligibility, the consented visit (OTP and
fingerprint), billing and dispatch, preauthorisation, status callbacks and
remittances. The HIE is the scripted FakeHie; every request is checked
against the vendored eClaims / Consent specifications."""

import uuid
from decimal import Decimal

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.billing.gate import BillingNotCleared, check_billing_clearance
from apps.care_pathway.models import BillingService, ChargeItem
from apps.client_registry.models import InsuranceCoverage, Patient, PatientIdentifier
from apps.clinical_encounter.models import DiagnosisCode, Encounter
from apps.dha_interop.models import IcdCodeIndex, ShaCallbackEvent
from apps.dha_interop.test_support import FakeHie
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.crypto import encrypt_value
from apps.tenancy.models import Branch, Organization, PlatformHieSettings

from .models import InsuranceClaim, ServicePayerCode, ShaIntervention, ShaVisit

FR = "TEST-FR-1"  # test fixtures — not real SHA, CR or intervention codes
CR = "TEST-CR-0001"
REHAB = "TEST-10-005"  # a package-10 code shape (benefit-intervention-codes.md)
OTHER = "TEST-07-001"


class ShaFixture(APITestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug=f"sha-{uuid.uuid4().hex[:6]}", facility_type="MENTAL_HEALTH_MHP"
            )
            self.branch = Branch.objects.create(
                organization=self.org, name="Main", facility_level="L4",
                sha_claims_enabled=True, sha_fr_code=FR,
            )
            self.finance = User.objects.create_user(
                email=f"fin-{uuid.uuid4().hex[:6]}@org.test", password="Password123!",
                organization=self.org, is_active=True, first_name="Finance", last_name="Clerk",
            )
            self.finance.roles.add(Role.objects.get(name="Billing Clerk", organization=None))
            self.patient = Patient.objects.create(
                organization=self.org, first_name="Amina", last_name="Kamau", gender="FEMALE",
                date_of_birth="1992-03-14", payer="SHA",
            )
            PatientIdentifier.objects.create(
                organization=self.org, patient=self.patient, kind="CLIENT_REGISTRY_ID", value=CR,
                verified_at=timezone.now(), verified_by_source="DHA Client Registry",
            )
            PatientIdentifier.objects.create(
                organization=self.org, patient=self.patient, kind="NATIONAL_ID",
                value="TEST-NID-1", verified_at=timezone.now(),
            )
            self.service = BillingService.objects.create(
                organization=self.org, name="Rehabilitation programme", rate=Decimal("67200.00")
            )
            ServicePayerCode.objects.create(
                organization=self.org, service=self.service, payer="SHA", payer_code=REHAB
            )
            ShaIntervention.objects.update_or_create(
                code=REHAB,
                defaults={"name": "Rehabilitation (test)", "applicable_document_types": ["DISCHARGE_SUMMARY"]},
            )
            self.charge = ChargeItem.objects.create(
                organization=self.org, patient=self.patient, service=self.service,
                unit_price=Decimal("67200.00"), delivered_at=timezone.now(),
            )
            icd, _ = IcdCodeIndex.objects.get_or_create(code="TEST-DX", defaults={"description": "Test"})
            encounter = Encounter.objects.create(organization=self.org, patient=self.patient)
            DiagnosisCode.objects.create(
                organization=self.org, encounter=encounter, icd11_code=icd, is_primary=True
            )
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(self.finance)[0]}"}

    def post(self, name, args, data=None):
        return self.client.post(reverse(name, args=args), data or {}, format="json", **self.auth)

    def eligibility(self, hie, **extra):
        hie.on(
            "GET",
            "/patients/eligibility",
            {
                "memberCrNumber": CR,
                "isAlive": True,
                "whitelistedForOTP": True,
                "facilityBiometricsEnforced": False,
                "schemes": [{"schemeId": 1, "schemeName": "SHIF", "coverage": {"status": "COVERED"}}],
                "statusCode": "10",
                **extra,
            },
        )
        return self.post("client-sha-eligibility", [self.patient.id], {"branch": str(self.branch.id)})

    def open_visit(self, hie, codes=(REHAB,), service_type="INPATIENT"):
        hie.on(
            "POST",
            "/claims/visit",
            {"authorization_code": "TOKEN1", "edi_claim_guid": "g-1", "workflow_state": "DRAFT"},
        )
        return self.post(
            "client-sha-visits",
            [self.patient.id],
            {
                "branch": str(self.branch.id),
                "service_type": service_type,
                "intervention_codes": list(codes),
                "consent_method": "OTP",
                "otp": "123456",
            },
        )


class ShaEligibilityTests(ShaFixture):
    def test_eligibility_is_checked_by_cr_id_and_kept_as_received(self):
        with FakeHie() as hie:
            response = self.eligibility(hie)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            hie.calls[0][2]["params"],
            {"identification_type": "ClientRegistry ID", "identification_number": CR},
        )
        sha = response.data["sha"]["eligibility"]
        self.assertTrue(sha["found"])
        # No coverage-status vocabulary is published: nothing is "active"
        # until the deployment configures which values mean active.
        self.assertFalse(sha["active"])
        self.assertFalse(sha["active_rule_configured"])
        self.assertEqual(sha["schemes"][0]["coverage_status"], "COVERED")

    def test_configured_active_status_clears_billing_and_mirrors_coverage(self):
        with platform_admin_context():
            InsuranceCoverage.objects.create(
                organization=self.org, patient=self.patient, scheme_type="SHA_SHIF"
            )
            encounter = Encounter.objects.create(organization=self.org, patient=self.patient)
            with self.assertRaises(BillingNotCleared):
                check_billing_clearance(encounter)
        with self.settings(SHA_ACTIVE_COVERAGE_STATUSES=["COVERED"]), FakeHie() as hie:
            self.eligibility(hie)
        with platform_admin_context():
            coverage = InsuranceCoverage.objects.get(patient=self.patient)
            self.assertTrue(coverage.sha_verified)
            self.assertTrue(coverage.sha_premium_compliant)
            check_billing_clearance(encounter)

    def test_a_deceased_member_blocks_every_sha_transaction(self):
        with FakeHie() as hie:
            self.eligibility(hie, isAlive=False)
            refused = self.open_visit(hie)
        self.assertEqual(refused.status_code, 400)
        self.assertIn("deceased", refused.data["error"]["message"])
        self.assertEqual(hie.call("POST", "/claims/visit"), [])


class ShaVisitTests(ShaFixture):
    def test_otp_visit_is_opened_and_the_authorization_code_kept_as_consent_token(self):
        with FakeHie() as hie:
            self.eligibility(hie)
            opened = self.open_visit(hie)
        self.assertEqual(opened.status_code, 201, opened.data)
        body = hie.call("POST", "/claims/visit")[0][2]["json"]
        self.assertEqual(
            body,
            {"intervention_codes": [REHAB], "patient_id": CR, "service_type": "INPATIENT", "otp": "123456"},
        )
        visit = opened.data["sha"]["visits"][0]
        self.assertEqual(visit["status"], "OPEN")
        self.assertEqual(visit["consent_token"], "TOKEN1")

    def test_mental_wellness_must_be_billed_alone(self):
        with FakeHie() as hie:
            refused = self.open_visit(hie, codes=("SHA-10-005", "SHA-07-001"))
        self.assertEqual(refused.status_code, 400)
        self.assertIn("billed alone", refused.data["error"]["message"])
        self.assertEqual(hie.calls, [])

    def test_biometric_facility_refuses_otp_unless_whitelisted(self):
        with FakeHie() as hie:
            self.eligibility(hie, facilityBiometricsEnforced=True, whitelistedForOTP=False)
            refused = self.open_visit(hie)
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.data["error"]["field"], "consent_method")

    def test_fingerprint_consent_opens_the_visit_once_authorized(self):
        with FakeHie() as hie:
            hie.on(
                "POST",
                "/claims/authorize",
                {
                    "guid": "auth-1",
                    "token": "AUTHTOK",
                    "status": "PENDING",
                    "shaVerificationRequest": {"requestUrl": "https://capture.example.test/x"},
                },
            )
            started = self.post(
                "client-sha-visits",
                [self.patient.id],
                {
                    "branch": str(self.branch.id),
                    "service_type": "OUTPATIENT",
                    "intervention_codes": [OTHER],
                    "consent_method": "BIOMETRIC",
                    "agent_id": "TEST-AGENT-ID",
                    "work_station_id": "WS-TEST",
                },
            )
            self.assertEqual(started.status_code, 201, started.data)
            visit = started.data["sha"]["visits"][0]
            self.assertEqual(visit["status"], "AWAITING_CONSENT")
            self.assertEqual(visit["biometric_capture_url"], "https://capture.example.test/x")
            authorize = hie.call("POST", "/claims/authorize")[0][2]["json"]
            self.assertEqual(authorize["provider"], FR)
            self.assertEqual(authorize["factors"], ["SHA"])
            self.assertTrue(authorize["is_integration"])

            hie.on("GET", "/claims/authorizations", {"status": "AUTHORIZED", "guid": "auth-1"})
            hie.on("POST", "/claims/visit", {"authorization_code": "TOKEN2", "workflow_state": "DRAFT"})
            refreshed = self.post("sha-visit-action", [visit["id"], "refresh"])
        self.assertEqual(refreshed.data["sha"]["visits"][0]["status"], "OPEN")
        self.assertEqual(hie.call("POST", "/claims/visit")[0][2]["json"]["auth_guid"], "auth-1")

    def test_no_usable_fingerprints_points_to_otp(self):
        with platform_admin_context():
            visit = ShaVisit.objects.create(
                organization=self.org, patient=self.patient, branch=self.branch, cr_id=CR,
                service_type="OUTPATIENT", intervention_codes=[OTHER], consent_method="BIOMETRIC",
                authorization_guid="auth-9", opened_by=self.finance,
            )
        with FakeHie() as hie:
            hie.on(
                "GET",
                "/claims/authorizations",
                {"status": "REJECTED", "authorizationReason": "BIOMETRICS_NOT_FOUND_OTP_ALLOWED"},
            )
            refreshed = self.post("sha-visit-action", [visit.id, "refresh"])
        data = refreshed.data["sha"]["visits"][0]
        self.assertEqual(data["status"], "REJECTED")
        self.assertTrue(data["otp_fallback_allowed"])


class ShaClaimTests(ShaFixture):
    def ready_claim(self, hie):
        self.eligibility(hie)
        opened = self.open_visit(hie)
        visit_id = opened.data["sha"]["visits"][0]["id"]
        claim = self.post("client-billing-claims", [self.patient.id]).data["claims"][0]
        self.client.patch(
            reverse("billing-claim", args=[claim["id"]]), {"guarantor": "Next of kin"},
            format="json", **self.auth,
        )
        attached = self.post("billing-claim-sha", [claim["id"], "visit"], {"visit": visit_id})
        self.assertEqual(attached.status_code, 200, attached.data)
        return claim

    def attach_discharge_summary(self, claim):
        from django.core.files.base import ContentFile

        from apps.client_registry.models import Attachment

        with platform_admin_context():
            filed = Attachment.objects.create(
                organization=self.org, patient=self.patient, classification="CURRENT",
                category="CLINICAL", file=ContentFile(b"%PDF-1.4 test", name="discharge.pdf"),
            )
        return self.post(
            "billing-claim-attachments",
            [claim["id"]],
            {"category": "DISCHARGE_SUMMARY", "file": str(filed.id), "sha_document_type": "DISCHARGE_SUMMARY"},
        )

    def test_dispatch_pushes_lines_diagnoses_documents_then_discharges(self):
        with FakeHie() as hie:
            claim = self.ready_claim(hie)
            missing = self.post("billing-claim-submit", [claim["id"]], {"lines_checked": True})
            self.assertEqual(missing.status_code, 400)
            self.assertEqual(missing.data["error"]["field"], "sha_documents")
            workspace = self.client.get(
                reverse("client-billing-workspace", args=[self.patient.id]), **self.auth
            )
            documents = next(
                i for i in workspace.data["claims"][0]["checklist"] if i["key"] == "sha_documents"
            )
            self.assertIn("DISCHARGE_SUMMARY", documents["detail"])
            self.assertEqual(self.attach_discharge_summary(claim).status_code, 201)

            hie.on("POST", "/claims/lines", {"id": "line-1"})
            hie.on("POST", "/claims/diagnoses", {})
            hie.on("POST", "/claims/attachments", {"id": "att-1"})
            hie.on("POST", "/claims/discharge", {"workflow_state": "SUBMITTED", "edi_claim_guid": "g-1"})
            no_otp = self.post(
                "billing-claim-submit", [claim["id"]],
                {"lines_checked": True, "sha": {"discharge_reason": "RECOVERED"}},
            )
            self.assertEqual(no_otp.status_code, 400)
            self.assertEqual(no_otp.data["error"]["field"], "otp")
            submitted = self.post(
                "billing-claim-submit", [claim["id"]],
                {"lines_checked": True, "sha": {"discharge_reason": "RECOVERED", "otp": "654321"}},
            )
        self.assertEqual(submitted.status_code, 200, submitted.data)
        line = hie.call("POST", "/claims/lines")[0][2]["json"]
        self.assertEqual(line["consent_token"], "TOKEN1")
        self.assertEqual(line["intervention_code"], REHAB)
        self.assertEqual(line["unit_price"], "67200.00")
        dx = hie.call("POST", "/claims/diagnoses")[0][2]["json"]
        self.assertEqual(dx["icd_code"], "TEST-DX")
        attachment = hie.call("POST", "/claims/attachments")[0][2]
        self.assertEqual(attachment["data"]["document_type"], "DISCHARGE_SUMMARY")
        self.assertIn("file_blob", attachment["files"])
        discharge = hie.call("POST", "/claims/discharge")[0][2]["json"]
        self.assertEqual(discharge["invoice_number"], claim["claim_number"])
        self.assertEqual(discharge["otp"], "654321")
        # Lines are sent once: the first (refused) attempt pushed them already.
        self.assertEqual(len(hie.call("POST", "/claims/lines")), 1)
        data = submitted.data["claims"][0]
        self.assertEqual(data["status"], "SUBMITTED")
        self.assertIn("DHA HIE", data["status_history"][-1]["note"])

    def test_an_hie_refusal_leaves_the_claim_a_draft(self):
        with FakeHie() as hie:
            claim = self.ready_claim(hie)
            self.attach_discharge_summary(claim)
            hie.on("POST", "/claims/lines", {"id": "line-1"})
            hie.on("POST", "/claims/diagnoses", {})
            hie.on("POST", "/claims/attachments", {"id": "att-1"})
            hie.on(
                "POST", "/claims/discharge",
                {"error": "Bad Request", "message": "Invalid discharge OTP", "trace_id": "t-9"},
                status=400,
            )
            refused = self.post(
                "billing-claim-submit", [claim["id"]],
                {"lines_checked": True, "sha": {"discharge_reason": "RECOVERED", "otp": "000000"}},
            )
        self.assertEqual(refused.status_code, 400)
        self.assertIn("Invalid discharge OTP", refused.data["error"]["message"])
        self.assertIn("t-9", refused.data["error"]["message"])
        with platform_admin_context():
            self.assertEqual(InsuranceClaim.objects.get(pk=claim["id"]).status, "DRAFT")

    def test_payer_decisions_are_never_typed_in_for_sha(self):
        with FakeHie() as hie:
            claim = self.ready_claim(hie)
        refused = self.post(
            "billing-claim-status", [claim["id"]], {"status": "APPROVED", "approved_amount": "1"}
        )
        self.assertEqual(refused.status_code, 400)
        self.assertIn("SHA posts its own decision", refused.data["error"]["message"])


class ShaCallbackTests(ShaFixture):
    def setUp(self):
        super().setUp()
        settings_row = PlatformHieSettings.get_solo()
        settings_row.callback_token_encrypted = encrypt_value("secret-path-token")
        settings_row.save()
        self.addCleanup(lambda: PlatformHieSettings.objects.all().delete())
        with platform_admin_context():
            visit = ShaVisit.objects.create(
                organization=self.org, patient=self.patient, branch=self.branch, cr_id=CR,
                service_type="INPATIENT", intervention_codes=[REHAB], consent_method="OTP",
                status="SUBMITTED", consent_token="TOKEN1", opened_by=self.finance,
                payer_workflow_state="SUBMITTED_PAYER",
            )
            self.claim = InsuranceClaim.objects.create(
                organization=self.org, patient=self.patient, payer="SHA", status="SUBMITTED",
                claim_number="CLM-TEST-1", sha_visit=visit, total_claimed_amount=Decimal("67200"),
            )

    def deliver(self, payload, token="secret-path-token", entity="claim"):
        return self.client.post(
            f"/api/v1/integrations/dha/{token}/callbacks/{entity}-status/", payload, format="json"
        )

    def test_a_wrong_token_is_not_found(self):
        self.assertEqual(self.deliver({}, token="guess").status_code, 404)
        self.assertFalse(ShaCallbackEvent.objects.exists())

    def test_claim_callback_is_acknowledged_applied_and_deduplicated(self):
        payload = {
            "subject_guid": "claim-guid-1",
            "provider_claim_no": "CLM-TEST-1",
            "from_state": "SUBMITTED_PAYER",
            "to_state": "APPROVED",
            "entity_type": "claim",
            "facility_fr_code": FR,
            "timestamp": "2026-10-23T10:00:00+00:00",
            "notes": "Approved in full",
        }
        with self.captureOnCommitCallbacks(execute=True):
            first = self.deliver(payload)
        with self.captureOnCommitCallbacks(execute=True):
            second = self.deliver(payload)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(ShaCallbackEvent.objects.count(), 1)
        event = ShaCallbackEvent.objects.get()
        self.assertIsNotNone(event.processed_at)
        self.assertEqual(event.organization_id, self.org.id)
        with platform_admin_context():
            claim = InsuranceClaim.objects.get(pk=self.claim.pk)
        self.assertEqual(claim.status, "APPROVED")
        self.assertIn("Approved in full", claim.status_history[-1]["note"])

    def test_an_out_of_order_callback_rereads_instead_of_applying(self):
        payload = {
            "subject_guid": "claim-guid-1",
            "provider_claim_no": "CLM-TEST-1",
            "from_state": "IN_REVIEW",
            "to_state": "APPROVED",
            "entity_type": "claim",
        }
        with FakeHie() as hie:
            hie.on(
                "GET", "/claims/preview/payer",
                {"results": [{"workflowState": "MEDICAL_REVIEW", "providerClaimNo": "CLM-TEST-1"}]},
            )
            with self.captureOnCommitCallbacks(execute=True):
                self.deliver(payload)
        self.assertEqual(
            hie.call("GET", "/claims/preview/payer")[0][2]["params"],
            {"provider_claim_no": "CLM-TEST-1"},
        )
        with platform_admin_context():
            claim = InsuranceClaim.objects.get(pk=self.claim.pk)
        self.assertEqual(claim.status, "UNDER_REVIEW")  # the HIE's current state, not the callback's

    def test_registration_names_the_facility_and_never_a_placeholder(self):
        settings_row = PlatformHieSettings.get_solo()
        settings_row.tenant_code = "tenant-code"
        settings_row.public_api_base_url = "https://app.example.test/api/v1"
        settings_row.save()
        from .sha_callbacks import register_callbacks

        with FakeHie() as hie:
            hie.on("GET", f"/tenants/{FR}/endpoints", [])
            hie.on("POST", "/tenants/tenant-code/endpoints", {"endpoint_id": "ep-1"})
            hie.on("POST", f"/tenants/{FR}/endpoints/ep-1/operations", {"operation_id": "op-1"})
            with platform_admin_context():
                results = register_callbacks(self.branch)
        self.assertEqual([r["entity_type"] for r in results], ["claim", "preauth", "authorization"])
        endpoint = hie.call("POST", "/tenants/tenant-code/endpoints")[0][2]["json"]
        self.assertEqual(endpoint["auth_type"], "none")
        self.assertEqual(endpoint["facility_fr_code"], FR)
        self.assertEqual(endpoint["environment"], "sandbox")
        self.assertTrue(endpoint["base_url"].endswith("/integrations/dha/secret-path-token"))
        operation = hie.call("POST", f"/tenants/{FR}/endpoints/ep-1/operations")[0][2]["json"]
        self.assertEqual(operation["action"], "status_changed")


class ShaRemittanceTests(ShaFixture):
    def test_unpublished_remittance_path_is_refused_not_guessed(self):
        with FakeHie() as hie:
            response = self.client.post(
                reverse("sha-remittances"), {"branch": str(self.branch.id)}, format="json", **self.auth
            )
        self.assertEqual(response.status_code, 400)
        self.assertIn("not configured", response.data["error"]["message"])
        self.assertEqual(hie.calls, [])
