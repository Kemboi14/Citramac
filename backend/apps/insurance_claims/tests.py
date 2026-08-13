from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.dha_interop.models import ShaTransactionLog
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .signing import SigningNotConfigured, sign_payload


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

    def test_sandbox_mode_fails_honestly_with_no_endpoint_configured(self):
        """
        docs/08-DHA-SHA-INTEGRATION.md §8.3/§8.4 — flipping SHA_GATEWAY_MODE
        to sandbox/production without also configuring the endpoint must
        fail loudly, never silently fall back to the stub's PENDING no-op.
        """
        create_response = self.client.post(
            reverse("pre-authorization-list"),
            {"patient": str(self.patient.id), "clinical_notes": "Needs inpatient stabilization."},
            format="json",
            **self.auth,
        )
        pre_auth_id = create_response.data["id"]

        with self.settings(SHA_GATEWAY_MODE="sandbox"):
            submit_response = self.client.post(
                reverse("pre-authorization-submit-to-sha", args=[pre_auth_id]), **self.auth
            )
        self.assertEqual(submit_response.status_code, 200, submit_response.data)
        with platform_admin_context():
            log = ShaTransactionLog.objects.get(
                organization_id=self.org.id, transaction_type="PRE_AUTHORIZATION"
            )
        self.assertEqual(log.status, "FAILED")
        self.assertIn("SHA_GATEWAY_ENDPOINT_URL", log.response_payload["detail"])

    def test_sandbox_mode_signs_and_posts_when_fully_configured(self):
        import tempfile
        from unittest.mock import Mock, patch

        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
        with tempfile.NamedTemporaryFile(suffix=".pem") as key_file:
            key_file.write(pem)
            key_file.flush()

            fake_response = Mock(status_code=200)
            fake_response.raise_for_status.return_value = None
            fake_response.json.return_value = {"reference": "SHA-REF-123"}
            with patch(
                "apps.insurance_claims.sha_gateway.requests.post", return_value=fake_response
            ) as post:
                with self.settings(
                    SHA_GATEWAY_MODE="sandbox",
                    SHA_GATEWAY_ENDPOINT_URL="https://sha.example.test/pre-auth",
                    SHA_GATEWAY_SIGNING_KEY_PATH=key_file.name,
                ):
                    create_response = self.client.post(
                        reverse("pre-authorization-list"),
                        {
                            "patient": str(self.patient.id),
                            "clinical_notes": "Needs inpatient stabilization.",
                        },
                        format="json",
                        **self.auth,
                    )
                    submit_response = self.client.post(
                        reverse(
                            "pre-authorization-submit-to-sha", args=[create_response.data["id"]]
                        ),
                        **self.auth,
                    )

        self.assertEqual(submit_response.status_code, 200, submit_response.data)
        post.assert_called_once()
        self.assertIn("X-Citramac-Signature", post.call_args.kwargs["headers"])
        with platform_admin_context():
            log = ShaTransactionLog.objects.get(
                organization_id=self.org.id, transaction_type="PRE_AUTHORIZATION"
            )
        self.assertEqual(log.status, "SUCCESS")
        self.assertEqual(log.response_payload["body"]["reference"], "SHA-REF-123")


class SigningTests(SimpleTestCase):
    """docs/08-DHA-SHA-INTEGRATION.md §8.4 — detached JWS over the JSON payload."""

    def test_sign_payload_raises_when_no_key_configured(self):
        with override_settings(SHA_GATEWAY_SIGNING_KEY_PATH=""):
            with self.assertRaises(SigningNotConfigured):
                sign_payload({"foo": "bar"})

    def test_sign_payload_produces_a_detached_jws(self):
        import tempfile

        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
        with tempfile.NamedTemporaryFile(suffix=".pem") as key_file:
            key_file.write(pem)
            key_file.flush()
            with override_settings(SHA_GATEWAY_SIGNING_KEY_PATH=key_file.name):
                jws = sign_payload({"foo": "bar"})

        header, payload, signature = jws.split(".")
        self.assertTrue(header)
        self.assertEqual(payload, "")  # detached — no payload segment
        self.assertTrue(signature)
