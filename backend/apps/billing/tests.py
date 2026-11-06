from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.clinical_encounter.models import Encounter
from apps.insurance_claims.models import PreAuthorization
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .gate import BillingNotCleared, check_billing_clearance
from .models import Invoice


class BillingTests(APITestCase):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.10, docs/10-API-SPECIFICATION.md §10.11."""

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
            self.encounter = Encounter.objects.create(organization=self.org, patient=self.patient)
        self.access, _ = issue_tokens(self.clinician)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.access}"}

    def _order_lab_test(self):
        """A lab order — one of the order paths behind the billing gate."""
        from apps.dha_interop.models import LoincCodeIndex

        with platform_admin_context():
            loinc = LoincCodeIndex.objects.get(code="2345-7")
        return self.client.post(
            reverse("lab-order-list"),
            {"encounter": str(self.encounter.id), "loinc_code": loinc.code},
            format="json",
            **self.auth,
        )

    def test_billing_gate_blocks_orders_with_no_cleared_payment_path(self):
        response = self._order_lab_test()
        self.assertEqual(response.status_code, 402)
        self.assertEqual(response.data["error"]["code"], "BILLING_NOT_CLEARED")

    def test_billing_gate_allows_orders_once_invoice_is_paid(self):
        with platform_admin_context():
            invoice = Invoice.objects.create(
                organization=self.org, patient=self.patient, encounter=self.encounter
            )
            invoice.lines.create(
                organization=self.org, description="Upfront cash", quantity=1, unit_price=1000
            )
            invoice.payments.create(organization=self.org, amount=1000, method="CASH")

        response = self._order_lab_test()
        self.assertEqual(response.status_code, 201, response.data)

    def test_billing_gate_allows_orders_with_verified_sha_coverage(self):
        with platform_admin_context():
            self.patient.insurance_coverages.create(
                organization=self.org,
                scheme_type="SHA_SHIF",
                sha_verified=True,
                sha_premium_compliant=True,
            )
        response = self._order_lab_test()
        self.assertEqual(response.status_code, 201, response.data)

    def test_billing_gate_allows_orders_with_approved_pre_authorization(self):
        with platform_admin_context():
            PreAuthorization.objects.create(
                organization=self.org,
                patient=self.patient,
                encounter=self.encounter,
                status="APPROVED",
            )
        response = self._order_lab_test()
        self.assertEqual(response.status_code, 201, response.data)

    def test_check_billing_clearance_raises_with_clear_reason(self):
        with self.assertRaises(BillingNotCleared) as ctx:
            with platform_admin_context():
                check_billing_clearance(self.encounter)
        self.assertIn("cleared payment method", str(ctx.exception))
