from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.client_registry.models import Patient
from apps.clinical_encounter.models import Encounter, Prescription, PrescriptionItem
from apps.dha_interop.models import NationalDrugIndex
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .fefo import InsufficientStock, dispense_fefo
from .models import DrugStockItem, Store


class PharmacyFefoTests(APITestCase):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.6 — FEFO dispensing + POS gate."""

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
            self.clinician = User.objects.create_user(
                email="clinician@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            # Dispensing needs pharmacy.dispense (the Pharmacist role).
            self.clinician.roles.add(Role.objects.get(name="Pharmacist", organization=None))
            self.other_staff = User.objects.create_user(
                email="reception@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.drug = NationalDrugIndex.objects.create(
                code="TEST-001", generic_name="Fluoxetine", form="Tablet", strength="20mg"
            )
            self.store = Store.objects.create(
                organization=self.org, name="Main Pharmacy", store_type="OUTPATIENT"
            )
            self.batch_expiring_soon = DrugStockItem.objects.create(
                organization=self.org,
                store=self.store,
                drug=self.drug,
                batch_number="A1",
                expiry_date=timezone.localdate() + timedelta(days=30),
                quantity_on_hand=5,
            )
            self.batch_expiring_later = DrugStockItem.objects.create(
                organization=self.org,
                store=self.store,
                drug=self.drug,
                batch_number="A2",
                expiry_date=timezone.localdate() + timedelta(days=365),
                quantity_on_hand=10,
            )
            prescription = Prescription.objects.create(
                organization=self.org, encounter=self.encounter, prescribed_by=self.clinician
            )
            self.prescription_item = PrescriptionItem.objects.create(
                organization=self.org, prescription=prescription, drug=self.drug, dose="20mg"
            )
        self.access, _ = issue_tokens(self.clinician)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.access}"}

    def test_fefo_consumes_earliest_expiring_batch_first(self):
        with platform_admin_context():
            consumed = dispense_fefo(
                store=self.store,
                drug=self.drug,
                quantity=3,
                user=self.clinician,
                organization=self.org,
            )
            self.batch_expiring_soon.refresh_from_db()
        self.assertEqual(len(consumed), 1)
        batch, taken = consumed[0]
        self.assertEqual(batch.id, self.batch_expiring_soon.id)
        self.assertEqual(taken, 3)
        self.assertEqual(self.batch_expiring_soon.quantity_on_hand, 2)

    def test_fefo_spills_into_next_batch_when_first_is_insufficient(self):
        with platform_admin_context():
            consumed = dispense_fefo(
                store=self.store,
                drug=self.drug,
                quantity=8,
                user=self.clinician,
                organization=self.org,
            )
            self.batch_expiring_soon.refresh_from_db()
            self.batch_expiring_later.refresh_from_db()
        self.assertEqual(len(consumed), 2)
        self.assertEqual(self.batch_expiring_soon.quantity_on_hand, 0)
        self.assertEqual(self.batch_expiring_later.quantity_on_hand, 7)

    def test_fefo_never_dispenses_an_expired_batch(self):
        with platform_admin_context():
            expired = DrugStockItem.objects.create(
                organization=self.org,
                store=self.store,
                drug=self.drug,
                batch_number="OLD",
                expiry_date=timezone.localdate() - timedelta(days=1),
                quantity_on_hand=50,
            )
            consumed = dispense_fefo(
                store=self.store,
                drug=self.drug,
                quantity=3,
                user=self.clinician,
                organization=self.org,
            )
            expired.refresh_from_db()
        self.assertEqual(consumed[0][0].id, self.batch_expiring_soon.id)
        self.assertEqual(expired.quantity_on_hand, 50)

    def test_stock_on_hand_changes_only_through_movements(self):
        response = self.client.patch(
            reverse("pharmacy-stock-item-detail", args=[self.batch_expiring_later.id]),
            {"quantity_on_hand": 999},
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 400)

    def test_fefo_raises_when_stock_is_insufficient(self):
        with platform_admin_context(), self.assertRaises(InsufficientStock):
            dispense_fefo(
                store=self.store,
                drug=self.drug,
                quantity=100,
                user=self.clinician,
                organization=self.org,
            )

    def test_only_a_pharmacist_dispenses_and_a_dispense_is_never_edited(self):
        other = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(self.other_staff)[0]}"}
        response = self.client.post(
            reverse("pharmacy-dispense-list"),
            {
                "prescription_item": str(self.prescription_item.id),
                "quantity_dispensed": 1,
                "store": str(self.store.id),
            },
            format="json",
            **other,
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            self.client.patch(
                reverse("pharmacy-dispense-detail", args=[self.prescription_item.id]),
                {"quantity_dispensed": 9},
                format="json",
                **self.auth,
            ).status_code,
            405,
        )

    def test_dispense_endpoint_blocked_by_pos_gate_with_no_cleared_billing(self):
        response = self.client.post(
            reverse("pharmacy-dispense-list"),
            {
                "prescription_item": str(self.prescription_item.id),
                "store": str(self.store.id),
                "quantity_dispensed": 3,
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 402)
        self.assertEqual(response.data["error"]["code"], "BILLING_NOT_CLEARED")

    def test_dispense_endpoint_succeeds_once_billing_is_cleared(self):
        from apps.billing.models import Invoice, InvoiceLine, Payment

        with platform_admin_context():
            invoice = Invoice.objects.create(
                organization=self.org, patient=self.patient, encounter=self.encounter
            )
            InvoiceLine.objects.create(
                organization=self.org,
                invoice=invoice,
                description="Fluoxetine",
                quantity=3,
                unit_price="10.00",
            )
            Payment.objects.create(
                organization=self.org, invoice=invoice, amount="30.00", method="CASH"
            )

        response = self.client.post(
            reverse("pharmacy-dispense-list"),
            {
                "prescription_item": str(self.prescription_item.id),
                "store": str(self.store.id),
                "quantity_dispensed": 3,
            },
            format="json",
            **self.auth,
        )
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            self.batch_expiring_soon.refresh_from_db()
        self.assertEqual(self.batch_expiring_soon.quantity_on_hand, 2)

    def test_store_list_endpoint_returns_this_orgs_stores(self):
        """
        Regression test: StoreViewSet must use get_queryset(), not a class-level
        `queryset = Store.objects.all()` — the latter binds the tenant-scoped
        manager's filter at import time (no request context yet), so it would
        return zero rows for every org, forever.
        """
        response = self.client.get(reverse("pharmacy-store-list"), **self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], str(self.store.id))
