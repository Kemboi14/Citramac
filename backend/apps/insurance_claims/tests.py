from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
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
                name="Org", slug="org", facility_type="MENTAL_HEALTH_MHP"
            )
            self.clinician = User.objects.create_user(
                email="clinician@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            # Writes are finance-only (apps.billing.permissions).
            self.clinician.roles.add(Role.objects.get(name="Billing Clerk", organization=None))
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Faith",
                last_name="Mwangi",
                gender="FEMALE",
                date_of_birth="1997-03-14",
            )
        self.access, _ = issue_tokens(self.clinician)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.access}"}

    def test_there_is_no_unreviewed_pre_authorization_submission(self):
        """The old encounter-level "submit to SHA" action bypassed the visit and
        the finance review; SHA pre-authorisation now goes only through a claim
        line on a consented SHA visit (workspace.request_preauth)."""
        create_response = self.client.post(
            reverse("pre-authorization-list"),
            {"patient": str(self.patient.id), "clinical_notes": "Needs inpatient stabilization."},
            format="json",
            **self.auth,
        )
        self.assertEqual(create_response.status_code, 201, create_response.data)
        response = self.client.post(
            f"/api/v1/claims/pre-authorizations/{create_response.data['id']}/submit-to-sha/",
            **self.auth,
        )
        self.assertEqual(response.status_code, 404)

    def test_e_claim_submit_to_sha_refuses_an_unreviewed_claim(self):
        """No submission path skips the finance review: a claim with no lines
        from documented care is refused and nothing reaches the gateway."""
        create_response = self.client.post(
            reverse("e-claim-list"),
            {"patient": str(self.patient.id), "total_claimed_amount": "5000.00"},
            format="json",
            **self.auth,
        )
        self.assertEqual(create_response.status_code, 201, create_response.data)
        self.assertEqual(create_response.data["total_claimed_amount"], "0.00")
        claim_id = create_response.data["id"]

        submit_response = self.client.post(
            reverse("e-claim-submit-to-sha", args=[claim_id]),
            {"lines_checked": True},
            format="json",
            **self.auth,
        )
        self.assertEqual(submit_response.status_code, 400, submit_response.data)
        self.assertIn("Finance review is incomplete", submit_response.data["error"]["message"])

        with platform_admin_context():
            self.assertFalse(
                ShaTransactionLog.objects.filter(
                    organization_id=self.org.id, transaction_type="E_CLAIM"
                ).exists()
            )
