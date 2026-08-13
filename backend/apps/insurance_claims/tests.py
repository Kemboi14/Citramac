from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.dha_interop.models import ShaTransactionLog
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization


class InsuranceClaimsTests(APITestCase):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.11, docs/08-DHA-SHA-INTEGRATION.md §8.3."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org", facility_type="MENTAL_HEALTH_CCP"
            )
            self.clinician = User.objects.create_user(
                email="clinician@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Faith",
                last_name="Mwangi",
                gender="FEMALE",
                date_of_birth="1997-03-14",
            )
        self.access, _ = issue_tokens(self.clinician)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.access}"}

    def test_pre_authorization_submit_to_sha_is_an_honest_stub(self):
        create_response = self.client.post(
            reverse("pre-authorization-list"),
            {"patient": str(self.patient.id), "clinical_notes": "Needs inpatient stabilization."},
            format="json",
            **self.auth,
        )
        self.assertEqual(create_response.status_code, 201, create_response.data)
        pre_auth_id = create_response.data["id"]

        submit_response = self.client.post(
            reverse("pre-authorization-submit-to-sha", args=[pre_auth_id]), **self.auth
        )
        self.assertEqual(submit_response.status_code, 200, submit_response.data)
        self.assertEqual(submit_response.data["status"], "SUBMITTED")
        self.assertTrue(submit_response.data["sha_reference"])

        with platform_admin_context():
            log = ShaTransactionLog.objects.get(
                organization_id=self.org.id, transaction_type="PRE_AUTHORIZATION"
            )
        self.assertEqual(log.status, "PENDING")
        self.assertIn("Phase 6 stub", log.response_payload["detail"])

    def test_e_claim_submit_to_sha_is_logged(self):
        create_response = self.client.post(
            reverse("e-claim-list"),
            {"patient": str(self.patient.id), "total_claimed_amount": "5000.00"},
            format="json",
            **self.auth,
        )
        claim_id = create_response.data["id"]

        submit_response = self.client.post(
            reverse("e-claim-submit-to-sha", args=[claim_id]), **self.auth
        )
        self.assertEqual(submit_response.status_code, 200, submit_response.data)
        self.assertEqual(submit_response.data["status"], "SUBMITTED")

        with platform_admin_context():
            self.assertTrue(
                ShaTransactionLog.objects.filter(
                    organization_id=self.org.id, transaction_type="E_CLAIM"
                ).exists()
            )
