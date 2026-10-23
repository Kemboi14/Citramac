"""Client record → Billing stage: claims lifecycle, minimum-necessary
attachments, finance role gating and payment allocation (v4 mockup
stageBilling / billingExtras).

The generic lifecycle runs against a private insurer — a payer CITRAMAC has
no connection to, whose submission and decisions finance records. The SHA
path (consented visit, dispatch through the DHA HIE) is in test_sha.py."""

from decimal import Decimal

from django.db import IntegrityError, transaction
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.billing.models import Invoice, Payment
from apps.care_pathway.models import BillingService, ChargeItem
from apps.care_pathway.services import billing_overview
from apps.client_registry.models import Patient, PatientIdentifier
from apps.clinical_encounter.models import DiagnosisCode, Encounter
from apps.dha_interop.models import IcdCodeIndex, ShaTransactionLog
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Branch, Organization

from .models import (
    AttachmentNotPermitted,
    ClaimAttachment,
    InsuranceClaim,
    Remittance,
    ServicePayerCode,
)


class BillingWorkspaceTests(APITestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org-billing", facility_type="MENTAL_HEALTH_MHP"
            )
            # The organisation's one branch, so SHA claims resolve to it.
            # Test fixture value — not a real FR code.
            self.branch = Branch.objects.create(
                organization=self.org,
                name="Main",
                facility_level="L4",
                sha_claims_enabled=True,
                sha_fr_code="TEST-FR-1",
            )
            self.finance = User.objects.create_user(
                email="finance@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.finance.roles.add(Role.objects.get(name="Billing Clerk", organization=None))
            self.clinician = User.objects.create_user(
                email="psych@org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.clinician.roles.add(Role.objects.get(name="Psychiatrist", organization=None))
            self.patient = Patient.objects.create(
                organization=self.org,
                first_name="Faith",
                last_name="Mwangi",
                gender="FEMALE",
                date_of_birth="1997-03-14",
                payer="PRIVATE",
            )
            # Test fixtures only — not real tariff, payer or ICD-11 codes.
            self.svc_a = BillingService.objects.create(
                organization=self.org, name="Test service A", rate=Decimal("1000.00")
            )
            self.svc_b = BillingService.objects.create(
                organization=self.org, name="Test service B", rate=Decimal("500.00")
            )
            ServicePayerCode.objects.create(
                organization=self.org,
                service=self.svc_b,
                payer="PRIVATE",
                payer_code="TEST-B",
                requires_preauth=True,
            )
            now = timezone.now()
            self.charge_a = ChargeItem.objects.create(
                organization=self.org,
                patient=self.patient,
                service=self.svc_a,
                unit_price=Decimal("1000.00"),
                delivered_at=now - timezone.timedelta(hours=2),
            )
            self.charge_b = ChargeItem.objects.create(
                organization=self.org,
                patient=self.patient,
                service=self.svc_b,
                unit_price=Decimal("500.00"),
                delivered_at=now - timezone.timedelta(hours=1),
            )
        self.f_auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(self.finance)[0]}"}
        self.c_auth = {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(self.clinician)[0]}"}

    # helpers

    def _make_ready(self):
        with platform_admin_context():
            icd, _ = IcdCodeIndex.objects.get_or_create(
                code="TEST-DX", defaults={"description": "Test condition"}
            )
            encounter = Encounter.objects.create(organization=self.org, patient=self.patient)
            DiagnosisCode.objects.create(
                organization=self.org, encounter=encounter, icd11_code=icd, is_primary=True
            )
            PatientIdentifier.objects.create(
                organization=self.org,
                patient=self.patient,
                kind="NATIONAL_ID",
                value="TEST-ID-1",
                verified_at=timezone.now(),
            )

    def _post(self, name, args, data=None, auth=None):
        return self.client.post(
            reverse(name, args=args), data or {}, format="json", **(auth or self.f_auth)
        )

    def _create_claim(self, charge_items=None):
        data = {"charge_items": charge_items} if charge_items is not None else {}
        response = self._post("client-billing-claims", [self.patient.id], data)
        self.assertEqual(response.status_code, 201, response.data)
        return response.data["claims"][0]

    def _line(self, claim, service):
        return next(line for line in claim["lines"] if line["service"] == service)

    # lifecycle

    def test_claim_lifecycle_draft_preauth_submit_adjudicate(self):
        claim = self._create_claim()
        self.assertEqual(claim["status"], "DRAFT")
        self.assertEqual(claim["timeline_stage"], 0)
        self.assertTrue(claim["claim_number"].startswith("CLM-"))
        self.assertEqual(claim["total_claimed_amount"], "1500.00")
        # Unconfigured service: no payer code is invented.
        line_a = self._line(claim, "Test service A")
        self.assertEqual(line_a["payer_code"], "")
        self.assertIsNone(line_a["requires_preauth"])
        line_b = self._line(claim, "Test service B")
        self.assertEqual(line_b["payer_code"], "TEST-B")
        self.assertTrue(line_b["requires_preauth"])
        self.assertEqual(
            sorted(a["category"] for a in claim["attachments"]), ["FINAL_BILL", "INVOICE"]
        )

        # Creating again is conditional: same draft, no duplicate lines.
        response = self._post("client-billing-claims", [self.patient.id])
        self.assertEqual(response.status_code, 400)

        # Checklist blocks submission: no diagnosis, identity, pre-auth, confirmation.
        refused = self._post("billing-claim-submit", [claim["id"]], {"lines_checked": True})
        self.assertEqual(refused.status_code, 400)
        self.assertIn("Diagnosis coded", refused.data["error"]["message"])
        self._make_ready()

        # Pre-auth is only offered for a line configured to need it.
        self.assertEqual(
            self._post("billing-claim-line-preauth", [claim["id"], line_a["id"]]).status_code, 400
        )
        requested = self._post("billing-claim-line-preauth", [claim["id"], line_b["id"]])
        self.assertEqual(requested.status_code, 200, requested.data)
        pre_auth = self._line(requested.data["claims"][0], "Test service B")["pre_authorization"]
        self.assertEqual(pre_auth["status"], "SUBMITTED")
        with platform_admin_context():
            # No connection to this payer: nothing is sent anywhere.
            self.assertFalse(ShaTransactionLog.objects.exists())

        no_ref = self._post("billing-preauth-decision", [pre_auth["id"]], {"status": "APPROVED"})
        self.assertEqual(no_ref.status_code, 400)
        approved = self._post(
            "billing-preauth-decision",
            [pre_auth["id"]],
            {"status": "APPROVED", "approval_reference": "PAYER-REF-1"},
        )
        self.assertEqual(approved.status_code, 200, approved.data)

        unconfirmed = self._post("billing-claim-submit", [claim["id"]], {})
        self.assertEqual(unconfirmed.status_code, 400)
        self.assertEqual(unconfirmed.data["error"]["field"], "lines_checked")

        submitted = self._post("billing-claim-submit", [claim["id"]], {"lines_checked": True})
        self.assertEqual(submitted.status_code, 200, submitted.data)
        claim = submitted.data["claims"][0]
        self.assertEqual(claim["status"], "SUBMITTED")
        self.assertEqual(claim["timeline_stage"], 1)
        self.assertEqual(
            claim["diagnoses"], [{"system": "ICD-11", "code": "TEST-DX", "is_primary": True}]
        )
        self.assertTrue(all(item["ok"] for item in claim["checklist"]))
        self.assertIn("Recorded as submitted", claim["status_history"][-1]["note"])
        with platform_admin_context():
            self.assertFalse(ShaTransactionLog.objects.exists())

        # A submitted claim is no longer editable.
        self.assertEqual(
            self.client.patch(
                reverse("billing-claim", args=[claim["id"]]),
                {"guarantor": "X"},
                format="json",
                **self.f_auth,
            ).status_code,
            400,
        )

        with_payer = self._post("billing-claim-status", [claim["id"]], {"status": "UNDER_REVIEW"})
        self.assertEqual(with_payer.data["claims"][0]["timeline_stage"], 2)
        too_much = self._post(
            "billing-claim-status",
            [claim["id"]],
            {"status": "PARTIALLY_APPROVED", "approved_amount": "9999"},
        )
        self.assertEqual(too_much.status_code, 400)
        done = self._post(
            "billing-claim-status",
            [claim["id"]],
            {"status": "PARTIALLY_APPROVED", "approved_amount": "1200.00"},
        )
        self.assertEqual(done.status_code, 200, done.data)
        claim = done.data["claims"][0]
        self.assertEqual(claim["timeline_stage"], 3)
        self.assertEqual(claim["approved_amount"], "1200.00")
        self.assertEqual(
            [h["status"] for h in claim["status_history"]],
            ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "PARTIALLY_APPROVED"],
        )

    def test_guarantor_required_when_a_balance_is_left_to_the_client(self):
        self._make_ready()
        claim = self._create_claim([str(self.charge_a.id)])
        refused = self._post("billing-claim-submit", [claim["id"]], {"lines_checked": True})
        self.assertEqual(refused.status_code, 400)
        self.assertIn("Guarantor", refused.data["error"]["message"])
        self.client.patch(
            reverse("billing-claim", args=[claim["id"]]),
            {"guarantor": "Next of kin — test"},
            format="json",
            **self.f_auth,
        )
        ok = self._post("billing-claim-submit", [claim["id"]], {"lines_checked": True})
        self.assertEqual(ok.status_code, 200, ok.data)

    def test_sha_claim_blocked_without_the_branch_fr_code(self):
        self._make_ready()
        with platform_admin_context():
            Patient.objects.filter(pk=self.patient.pk).update(payer="SHA")
            Branch.objects.filter(pk=self.branch.pk).update(sha_fr_code="")
        claim = self._create_claim([str(self.charge_a.id)])
        self.client.patch(
            reverse("billing-claim", args=[claim["id"]]),
            {"guarantor": "Test guarantor"},
            format="json",
            **self.f_auth,
        )
        refused = self._post("billing-claim-submit", [claim["id"]], {"lines_checked": True})
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.data["error"]["field"], "facility")
        self.assertIn("Facility SHA FR code", refused.data["error"]["message"])
        with platform_admin_context():
            self.assertFalse(ShaTransactionLog.objects.filter(transaction_type="E_CLAIM").exists())
            Branch.objects.filter(pk=self.branch.pk).update(sha_fr_code="TEST-FR-1")
        # With the FR code, SHA still needs the client's consented visit.
        still = self._post("billing-claim-submit", [claim["id"]], {"lines_checked": True})
        self.assertEqual(still.status_code, 400)
        self.assertEqual(still.data["error"]["field"], "sha_visit")

    def test_sha_claim_blocked_when_the_branch_is_ambiguous(self):
        self._make_ready()
        with platform_admin_context():
            Patient.objects.filter(pk=self.patient.pk).update(payer="SHA")
            Branch.objects.create(
                organization=self.org, name="Second", facility_level="L3", sha_fr_code="TEST-FR-2"
            )
        claim = self._create_claim()
        facility = next(i for i in claim["checklist"] if i["key"] == "facility")
        self.assertFalse(facility["ok"])
        self.assertIn("isn't recorded", facility["detail"])

    def test_rejected_claim_releases_its_charges(self):
        self._make_ready()
        claim = self._create_claim([str(self.charge_a.id)])
        self.client.patch(
            reverse("billing-claim", args=[claim["id"]]),
            {"guarantor": "Test guarantor"},
            format="json",
            **self.f_auth,
        )
        self._post("billing-claim-submit", [claim["id"]], {"lines_checked": True})
        with platform_admin_context():
            self.assertEqual(
                billing_overview(self.patient)["summary"]["claimed"]["amount"], "1000.00"
            )
        self._post("billing-claim-status", [claim["id"]], {"status": "REJECTED"})
        with platform_admin_context():
            self.assertEqual(billing_overview(self.patient)["summary"]["claimed"]["amount"], "0")
        again = self._post(
            "client-billing-claims", [self.patient.id], {"charge_items": [str(self.charge_a.id)]}
        )
        self.assertEqual(again.status_code, 201, again.data)

    def test_self_pay_client_has_no_payer_claim(self):
        with platform_admin_context():
            Patient.objects.filter(pk=self.patient.pk).update(payer="SELF_PAY")
        response = self._post("client-billing-claims", [self.patient.id])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["field"], "payer")

    # minimum-necessary attachments

    def test_psychotherapy_notes_and_trauma_history_are_never_attached(self):
        claim = self._create_claim()
        for category in ("PSYCHOTHERAPY_NOTES", "TRAUMA_HISTORY"):
            response = self._post(
                "billing-claim-attachments", [claim["id"]], {"category": category}
            )
            self.assertEqual(response.status_code, 400, category)
            self.assertIn("never attached", response.data["error"]["message"])
        ok = self._post("billing-claim-attachments", [claim["id"]], {"category": "LAB_RESULTS"})
        self.assertEqual(ok.status_code, 201, ok.data)

        with platform_admin_context():
            db_claim = InsuranceClaim.objects.get(pk=claim["id"])
            with self.assertRaises(AttachmentNotPermitted):
                ClaimAttachment.objects.create(
                    organization=self.org, claim=db_claim, category="TRAUMA_HISTORY"
                )
            # Even a bulk write that skips save() is refused by the database.
            with self.assertRaises(IntegrityError), transaction.atomic():
                ClaimAttachment.objects.filter(claim=db_claim, category="LAB_RESULTS").update(
                    category="PSYCHOTHERAPY_NOTES"
                )

    # role gating

    def test_clinicians_view_only_finance_writes(self):
        view = self.client.get(
            reverse("client-billing-workspace", args=[self.patient.id]), **self.c_auth
        )
        self.assertEqual(view.status_code, 200)
        self.assertFalse(view.data["can_edit"])
        self.assertIsNone(view.data["package_ceiling"])
        for name, data in (
            ("client-billing-claims", {}),
            ("client-billing-invoice", {}),
            ("client-billing-payments", {"amount": "10", "method": "CASH"}),
        ):
            self.assertEqual(
                self._post(name, [self.patient.id], data, auth=self.c_auth).status_code, 403, name
            )
        self.assertEqual(
            self.client.get(
                reverse("client-billing-export", args=[self.patient.id]), **self.c_auth
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                reverse("invoice-list"),
                {"patient": str(self.patient.id), "lines": []},
                format="json",
                **self.c_auth,
            ).status_code,
            403,
        )
        claim = self._create_claim()
        self.assertEqual(
            self._post(
                "billing-claim-submit", [claim["id"]], {"lines_checked": True}, self.c_auth
            ).status_code,
            403,
        )
        finance_view = self.client.get(
            reverse("client-billing-workspace", args=[self.patient.id]), **self.f_auth
        )
        self.assertTrue(finance_view.data["can_edit"])
        export = self.client.get(
            reverse("client-billing-export", args=[self.patient.id]), **self.f_auth
        )
        self.assertEqual(export.status_code, 200)
        self.assertIn("Test service A", export.content.decode())

    # invoice + payments, allocation through billing_overview

    def test_payments_allocate_exactly_as_billing_overview(self):
        self._make_ready()
        claim = self._create_claim([str(self.charge_b.id)])
        pre = self._post("billing-claim-line-preauth", [claim["id"], claim["lines"][0]["id"]])
        pa = pre.data["claims"][0]["lines"][0]["pre_authorization"]
        self._post(
            "billing-preauth-decision",
            [pa["id"]],
            {"status": "APPROVED", "approval_reference": "R1"},
        )
        self.client.patch(
            reverse("billing-claim", args=[claim["id"]]),
            {"guarantor": "Test guarantor"},
            format="json",
            **self.f_auth,
        )
        self.assertEqual(
            self._post("billing-claim-submit", [claim["id"]], {"lines_checked": True}).status_code,
            200,
        )

        no_invoice = self._post(
            "client-billing-payments", [self.patient.id], {"amount": "100", "method": "CASH"}
        )
        self.assertEqual(no_invoice.data["error"]["field"], "invoice")
        issued = self._post("client-billing-invoice", [self.patient.id])
        self.assertEqual(issued.data["invoice"]["total"], "1500.00")
        self.assertFalse(issued.data["invoice"]["stale"])

        mpesa = self._post(
            "client-billing-payments", [self.patient.id], {"amount": "100", "method": "MPESA"}
        )
        self.assertEqual(mpesa.data["error"]["field"], "reference")
        cash = self._post(
            "client-billing-payments",
            [self.patient.id],
            {"amount": "300", "method": "CASH", "idempotency_key": "k-1"},
        )
        self.assertEqual(cash.status_code, 201, cash.data)
        retry = self._post(
            "client-billing-payments",
            [self.patient.id],
            {"amount": "300", "method": "CASH", "idempotency_key": "k-1"},
        )
        self.assertEqual(retry.status_code, 201)
        remit = self._post(
            "client-billing-payments",
            [self.patient.id],
            {"amount": "500", "method": "INSURANCE", "claim": claim["id"], "reference": "REM-1"},
        )
        self.assertEqual(remit.status_code, 201, remit.data)
        too_much = self._post(
            "client-billing-payments", [self.patient.id], {"amount": "701", "method": "CASH"}
        )
        self.assertEqual(too_much.data["error"]["field"], "amount")

        with platform_admin_context():
            self.assertEqual(Payment.objects.filter(invoice__patient=self.patient).count(), 2)
            self.assertEqual(Remittance.objects.get().payment.amount, Decimal("500.00"))
            overview = billing_overview(self.patient)
        events = {e["service"]: e for e in overview["events"]}
        # Claimed balances are settled first: B (claimed) fully paid, then A.
        self.assertEqual(events["Test service B"]["status"], "paid")
        self.assertEqual(events["Test service A"]["paid_amount"], "300.00")
        self.assertEqual(events["Test service A"]["unbilled_balance"], "700.00")
        self.assertEqual(overview["summary"]["paid"]["amount"], "800.00")
        totals = remit.data["totals"]
        self.assertEqual(totals["paid"], "800.00")
        self.assertEqual(totals["outstanding"], "700.00")
        self.assertEqual(
            Decimal(totals["services"]) - Decimal(totals["paid"]), Decimal(totals["outstanding"])
        )

        # A newly documented service makes the invoice stale; re-issue is a new version.
        with platform_admin_context():
            ChargeItem.objects.create(
                organization=self.org,
                patient=self.patient,
                service=self.svc_a,
                unit_price=Decimal("1000.00"),
            )
        stale = self.client.get(
            reverse("client-billing-workspace", args=[self.patient.id]), **self.f_auth
        )
        self.assertTrue(stale.data["invoice"]["stale"])
        reissued = self._post("client-billing-invoice", [self.patient.id])
        self.assertEqual(reissued.data["invoice"]["version"], 2)
        self.assertEqual(reissued.data["invoice"]["total"], "2500.00")
        with platform_admin_context():
            first = Invoice.objects.get(patient=self.patient, version=1)
            first_payments = first.payments.count()
        self.assertEqual(first.status, "CANCELLED")
        self.assertEqual(first_payments, 2)  # payments are never moved
