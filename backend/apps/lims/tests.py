from django.urls import reverse
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.clinical_encounter.models import Encounter
from apps.dha_interop.models import LoincCodeIndex
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .models import LabOrder, LabResult, LabSpecimen


class LimsTests(APITestCase):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.4 — Module 4 QC gate."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org", facility_type="MENTAL_HEALTH_CCP"
            )
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Faith",
                last_name="Mwangi",
                gender="FEMALE",
                date_of_birth="1997-03-14",
            )
            self.encounter = Encounter.objects.create(organization=self.org, patient=self.patient)
            self.loinc = LoincCodeIndex.objects.get(code="2345-7")

            self.clinician = User.objects.create_user(
                email="clinician@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.lab_tech = User.objects.create_user(
                email="labtech@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.lab_tech.roles.add(
                Role.objects.get(name="Lab Technician", organization__isnull=True)
            )

            self.lab_order = LabOrder.objects.create(
                organization=self.org,
                encounter=self.encounter,
                loinc_code=self.loinc,
                ordered_by=self.clinician,
            )
            self.specimen = LabSpecimen.objects.create(
                organization=self.org, lab_order=self.lab_order, collected_by=self.lab_tech
            )
            self.result = LabResult.objects.create(
                organization=self.org,
                lab_order=self.lab_order,
                specimen=self.specimen,
                result_value="98",
                unit="mg/dL",
                recorded_by=self.lab_tech,
            )

        self.access_clinician, _ = issue_tokens(self.clinician)
        self.access_lab_tech, _ = issue_tokens(self.lab_tech)

    def _auth(self, token):
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    def test_specimen_barcode_is_auto_generated(self):
        self.assertTrue(self.specimen.barcode.startswith("SPEC-"))

    def test_clinician_cannot_see_unvalidated_result_value(self):
        response = self.client.get(
            reverse("lab-result-detail", args=[self.result.id]), **self._auth(self.access_clinician)
        )
        self.assertEqual(response.status_code, 404)  # filtered out of queryset entirely

    def test_clinician_list_excludes_unvalidated_results(self):
        response = self.client.get(reverse("lab-result-list"), **self._auth(self.access_clinician))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 0)

    def test_lab_technician_sees_unvalidated_result_value(self):
        response = self.client.get(
            reverse("lab-result-detail", args=[self.result.id]), **self._auth(self.access_lab_tech)
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["result_value"], "98")

    def test_validate_action_flips_result_and_order_status(self):
        response = self.client.post(
            reverse("lab-result-validate", args=[self.result.id]),
            **self._auth(self.access_lab_tech),
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["is_validated"])
        with platform_admin_context():
            self.lab_order.refresh_from_db()
        self.assertEqual(self.lab_order.status, "RESULT_VALIDATED")

    def test_clinician_sees_result_after_validation(self):
        with platform_admin_context():
            self.result.is_validated = True
            self.result.save(update_fields=["is_validated"])
        response = self.client.get(
            reverse("lab-result-detail", args=[self.result.id]), **self._auth(self.access_clinician)
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["result_value"], "98")

    def test_lab_order_creation_blocked_by_pos_gate_with_no_cleared_billing(self):
        response = self.client.post(
            reverse("lab-order-list"),
            {"encounter": str(self.encounter.id), "loinc_code": self.loinc.code},
            format="json",
            **self._auth(self.access_clinician),
        )
        self.assertEqual(response.status_code, 402)
        self.assertEqual(response.data["error"]["code"], "BILLING_NOT_CLEARED")

    def test_lab_order_creation_succeeds_once_billing_is_cleared(self):
        from apps.billing.models import Invoice, InvoiceLine, Payment

        with platform_admin_context():
            invoice = Invoice.objects.create(
                organization=self.org, patient=self.patient, encounter=self.encounter
            )
            InvoiceLine.objects.create(
                organization=self.org,
                invoice=invoice,
                description="Glucose panel",
                quantity=1,
                unit_price="500.00",
            )
            Payment.objects.create(
                organization=self.org, invoice=invoice, amount="500.00", method="CASH"
            )

        response = self.client.post(
            reverse("lab-order-list"),
            {"encounter": str(self.encounter.id), "loinc_code": self.loinc.code},
            format="json",
            **self._auth(self.access_clinician),
        )
        self.assertEqual(response.status_code, 201, response.data)
