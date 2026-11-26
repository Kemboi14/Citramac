"""Price schedule import and insurer-rate charging (guide.md 2026-11-26).

Workbook rows here are test fixtures shaped like the facility's sheet, not its
real prices."""

import uuid
from decimal import Decimal

from django.test import TestCase
from django.urls import reverse
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.care_pathway import price_schedule, pricing
from apps.care_pathway.management.commands.import_price_schedule import Command
from apps.care_pathway.models import BillingService, ChargeItem, ServiceCatalogueItem
from apps.care_pathway.services import _apply_details
from apps.client_registry.models import Patient
from apps.insurance_claims.models import Insurer, ServicePayerCode
from apps.insurance_claims.workspace import claim_insurer, claim_payer, invoice_lines, issue_invoice
from apps.tenancy.context import clear_tenant_context, platform_admin_context, set_tenant_context
from apps.tenancy.models import Organization

HEADER = {"A": "Code", "B": "Service", "C": "Description", "D": "Cost", "G": "Sales Price"}
INSURER_HEADER = {"A": "Code", "B": "Service", "C": "Description", "D": "Cost"}


def row(code, service, description, cost=None, sales=None, remarks=None):
    return {"A": code, "B": service, "C": description, "D": cost, "G": sales, "H": remarks}


def insurer_row(service, description, cost):
    return {"B": service, "C": description, "D": cost}


def issues_text(plan):
    return "\n".join(message for _, _, message in plan.issues)


class PlanTests(TestCase):
    def test_codes_are_normalised_and_reused_codes_are_not_stored(self):
        plan = price_schedule.plan(
            {
                "Out of pocket": [
                    HEADER,
                    row("1.0", "Toxicology", "Urine screen", "KES 1,500.00", "KES 1,500.00"),
                    row("84.0", "Medication", "Drug A 10mg", "KES 10.00", "10"),
                    row("84.0", "Lab Test Service", "Test B", "KES 500.00"),
                ]
            }
        )
        codes = {line.name: line.code for line in plan.lines}
        self.assertEqual(codes["Urine screen"], "1")
        self.assertEqual(codes["Drug A 10mg"], "")
        self.assertEqual(codes["Test B"], "")
        self.assertIn("Code 84 is used on rows 3, 4", issues_text(plan))

    def test_same_description_under_different_services_are_separate_lines(self):
        plan = price_schedule.plan(
            {
                "Out of pocket": [
                    HEADER,
                    row("13", "Counselling I", "Individual session", "5000", "5000"),
                    row("50", "Counselling I (Virtual)", "Individual session", "5000", "5000"),
                    row("70", "Counselling", "Individual session", "7500", "7500"),
                ]
            }
        )
        names = sorted(line.name for line in plan.lines)
        self.assertEqual(
            names,
            [
                "Individual session — Counselling",
                "Individual session — Counselling I",
                "Individual session — Counselling I (Virtual)",
            ],
        )

    def test_same_item_twice_is_one_line_or_a_conflict(self):
        plan = price_schedule.plan(
            {
                "Out of pocket": [
                    HEADER,
                    row("21", "Lab Test Service", "LFT", "2500", "2500"),
                    row("86", "Lab Test Service", "LFT", "2500", "2500"),
                    row("125", "Medication", "Drug C 25mg Injection", "50", "50"),
                    row("100", "Medication", "Drug C 25mg Injection", "30"),
                ]
            }
        )
        names = [line.name for line in plan.lines]
        self.assertEqual(names.count("LFT"), 1)
        self.assertNotIn("Drug C 25mg Injection", names)
        self.assertIn("Drug C 25mg Injection is listed at different prices", issues_text(plan))

    def test_cost_is_never_used_as_the_price(self):
        plan = price_schedule.plan(
            {"Out of pocket": [HEADER, row("145", "Inpatient", "2 weeks", "KES 70,000")]}
        )
        line = plan.lines[0]
        self.assertIsNone(line.rate)
        self.assertEqual(line.cost, Decimal("70000"))
        self.assertIn("no Sales Price — imported unpriced", issues_text(plan))

    def test_medication_name_and_strength_are_split(self):
        plan = price_schedule.plan(
            {"Out of pocket": [HEADER, row("31", "Medication ", "Drug D 5mg", "25", "25")]}
        )
        line = plan.lines[0]
        self.assertEqual(
            (line.medicine_name, line.mass, line.name), ("Drug D", "5mg", "Drug D 5mg")
        )

    def test_insurer_rows_match_a_cash_line_or_become_insurer_only_lines(self):
        plan = price_schedule.plan(
            {
                "Out of pocket": [
                    HEADER,
                    row("4", "Toxicology", "Point of Care urine drug screen", "1500", "1500"),
                ],
                "CIC": [
                    INSURER_HEADER,
                    insurer_row("Toxicology", "Point of Care Urine Drug Screen\n", 1500.0),
                    insurer_row("Consultation (Free)", "Short consultation", "Free\n"),
                    insurer_row("Package I", "90-day package", "210,000\n(Inclusive of NHIF)\n"),
                ],
                "AAR": [
                    INSURER_HEADER,
                    insurer_row("Consultation (Free)", "Short consultation", "Free"),
                    insurer_row("Outreach III", "Custom sessions", "TBD"),
                    insurer_row("Group", "Per head", "1,500 pp"),
                ],
            }
        )
        rates = {(r.payer, r.line_name): r.rate for r in plan.insurer_rates}
        self.assertEqual(rates[("CIC", "Point of Care urine drug screen")], Decimal("1500.0"))
        self.assertEqual(rates[("CIC", "Consultation (Free) — Short consultation")], Decimal("0"))
        self.assertEqual(rates[("AAR", "Consultation (Free) — Short consultation")], Decimal("0"))
        self.assertEqual(rates[("CIC", "Package I — 90-day package")], Decimal("210000"))
        package = next(line for line in plan.lines if line.name == "Package I — 90-day package")
        self.assertIsNone(package.rate)
        self.assertIn("Inclusive of NHIF", package.remarks)
        text = issues_text(plan)
        self.assertIn("Custom sessions: price to be decided (TBD)", text)
        self.assertIn("price not understood: '1,500 pp'", text)
        # The shared insurer-only line is one line carrying both insurers' rates.
        self.assertEqual(
            [line.name for line in plan.lines].count("Consultation (Free) — Short consultation"), 1
        )

    def test_long_insurer_line_names_fit_and_keep_the_full_text(self):
        long = "Medical and psychosocial treatment " * 6
        plan = price_schedule.plan(
            {"Out of pocket": [HEADER], "AAR": [INSURER_HEADER, insurer_row("Res", long, 25000)]}
        )
        line = plan.lines[0]
        self.assertLessEqual(len(line.name), price_schedule.NAME_MAX)
        self.assertTrue(line.name.endswith("…"))
        self.assertIn(" ".join(long.split()), line.description)


class ApplyTests(TestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org-price", facility_type="MENTAL_HEALTH_MHP"
            )
            self.other = Organization.objects.create(
                name="Other", slug="org-other", facility_type="MENTAL_HEALTH_MHP"
            )
            ServiceCatalogueItem.objects.get_or_create(name="Consultation", category="Psychiatry")
        self.plan = price_schedule.plan(
            {
                "Out of pocket": [HEADER, row("3", "Psychiatry", "Consultation", "5000", "5000")],
                "AAR": [
                    INSURER_HEADER,
                    insurer_row("Psychiatry", "Consultation", 4500),
                    insurer_row("Res II", "Daily option", 5000),
                ],
            }
        )
        self.names = ["Consultation", "Res II — Daily option"]

    def apply(self, dry_run=False, update_existing=False):
        set_tenant_context(organization_id=self.org.id)
        return Command()._apply(self.org, self.plan, dry_run, update_existing)

    def test_creates_lines_insurer_and_rates_in_the_named_organisation_only(self):
        counts = self.apply()
        self.assertEqual((counts["created"], counts["rates"], counts["insurers"]), (2, 2, 1))
        with platform_admin_context():
            consult = BillingService.objects.get(organization=self.org, name="Consultation")
            self.assertEqual(consult.rate, Decimal("5000"))
            self.assertEqual(consult.code, "3")
            self.assertEqual(consult.catalogue_item.name, "Consultation")
            aar = Insurer.objects.get(organization=self.org, name="AAR")
            rate = ServicePayerCode.objects.get(service=consult, insurer=aar)
            self.assertEqual((rate.payer, rate.rate), ("INSURER", Decimal("4500")))
            daily = BillingService.objects.get(organization=self.org, name=self.names[1])
            self.assertIsNone(daily.rate)
            self.assertFalse(
                BillingService.objects.filter(organization=self.other, name__in=self.names).exists()
            )
            self.assertFalse(Insurer.objects.filter(organization=self.other).exists())

    def test_dry_run_saves_nothing(self):
        self.apply(dry_run=True)
        with platform_admin_context():
            self.assertFalse(
                BillingService.objects.filter(organization=self.org, name__in=self.names).exists()
            )
            self.assertFalse(Insurer.objects.filter(organization=self.org).exists())

    def test_existing_values_are_kept_unless_update_existing(self):
        self.apply()
        with platform_admin_context():
            BillingService.objects.filter(organization=self.org, name="Consultation").update(
                rate=Decimal("6000")
            )
            ServicePayerCode.objects.filter(
                organization=self.org, service__name="Consultation"
            ).update(rate=Decimal("4000"))
        counts = self.apply()
        self.assertEqual(counts["insurers"], 0)
        with platform_admin_context():
            consult = BillingService.objects.get(organization=self.org, name="Consultation")
            self.assertEqual(consult.rate, Decimal("6000"))
            self.assertEqual(consult.payer_codes.get().rate, Decimal("4000"))
        self.apply(update_existing=True)
        with platform_admin_context():
            consult = BillingService.objects.get(organization=self.org, name="Consultation")
            self.assertEqual(consult.rate, Decimal("5000"))
            self.assertEqual(consult.payer_codes.get().rate, Decimal("4500"))


class InsurerPricingTests(TestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org-insurer", facility_type="MENTAL_HEALTH_MHP"
            )
        set_tenant_context(organization_id=self.org.id)
        self.aar = Insurer.objects.create(organization=self.org, name="Test insurer A")
        self.other_insurer = Insurer.objects.create(organization=self.org, name="Test insurer B")
        self.service = BillingService.objects.create(
            organization=self.org, name="Test consult", rate=Decimal("5000")
        )
        self.no_rate = BillingService.objects.create(
            organization=self.org, name="Test lab", rate=Decimal("700")
        )
        ServicePayerCode.objects.create(
            organization=self.org,
            service=self.service,
            payer="INSURER",
            insurer=self.aar,
            rate=Decimal("3000"),
        )
        ServicePayerCode.objects.create(
            organization=self.org,
            service=self.no_rate,
            payer="INSURER",
            insurer=self.aar,
            payer_code="X",
            rate=None,
        )

    def patient(self, payer, insurer=None):
        return Patient.objects.create(
            organization=self.org,
            first_name="Test",
            last_name="Client",
            payer=payer,
            insurer=insurer,
        )

    def test_insurer_client_is_charged_the_insurer_rate(self):
        client = self.patient("PRIVATE", self.aar)
        self.assertEqual(pricing.price_for(self.service, client), (Decimal("3000"), self.aar))
        self.assertEqual(pricing.price_for(self.no_rate, client), (Decimal("700"), None))

    def test_sha_plus_private_insurer_uses_the_insurer_rate(self):
        client = self.patient("SHA_PRIVATE", self.aar)
        self.assertEqual(pricing.price_for(self.service, client), (Decimal("3000"), self.aar))

    def test_cash_unrated_and_stale_insurer_pay_the_cash_price(self):
        for client in (
            self.patient("SELF_PAY"),
            self.patient("PRIVATE", self.other_insurer),
            self.patient("PRIVATE"),
            self.patient("SELF_PAY", self.aar),  # insurer left from an earlier payer
        ):
            self.assertEqual(pricing.price_for(self.service, client), (Decimal("5000"), None))

    def test_inactive_rate_or_retired_insurer_is_not_used(self):
        client = self.patient("PRIVATE", self.aar)
        ServicePayerCode.objects.filter(service=self.service).update(active=False)
        self.assertEqual(pricing.price_for(self.service, client), (Decimal("5000"), None))
        ServicePayerCode.objects.filter(service=self.service).update(active=True)
        Insurer.objects.filter(pk=self.aar.pk).update(active=False)
        self.assertEqual(pricing.price_for(self.service, client), (Decimal("5000"), None))

    def test_claim_goes_to_the_named_insurer(self):
        self.assertEqual(claim_payer(self.patient("PRIVATE", self.aar)), "PRIVATE")
        self.assertEqual(claim_insurer(self.patient("PRIVATE", self.aar)), self.aar)
        self.assertIsNone(claim_insurer(self.patient("SHA_PRIVATE", self.aar)))

    def test_invoice_says_which_insurer_rate_applied(self):
        client = self.patient("PRIVATE", self.aar)
        ChargeItem.objects.create(
            organization=self.org,
            patient=client,
            quantity=1,
            **pricing.charge_fields(self.service, client),
        )
        invoice, _ = issue_invoice(None, client)
        lines = invoice_lines(invoice)
        self.assertEqual(lines[0]["detail"], "Test insurer A rate")
        self.assertEqual(lines[0]["amount"], "3000.00")

    def test_registration_records_the_insurer_only_with_a_private_payer(self):
        client = self.patient("")
        _apply_details(client, {"payer": "PRIVATE", "insurer": str(self.aar.pk)})
        self.assertEqual(client.insurer, self.aar)
        _apply_details(client, {"payer": "SELF_PAY"})
        self.assertIsNone(client.insurer)
        for bad in ("not-a-uuid", str(uuid.uuid4())):
            with self.assertRaises(ValidationError):
                _apply_details(client, {"payer": "PRIVATE", "insurer": bad})
        Insurer.objects.filter(pk=self.aar.pk).update(active=False)
        with self.assertRaises(ValidationError):
            _apply_details(client, {"payer": "PRIVATE", "insurer": str(self.aar.pk)})


class TariffApiTests(APITestCase):
    """Org Admin's own tariff: add from the catalogue, write a line, insurers
    and their rates; Super Admin keeps the catalogue (guide.md 2026-11-26)."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org-tariff", facility_type="MENTAL_HEALTH_MHP"
            )
            self.other = Organization.objects.create(
                name="Other", slug="org-tariff-2", facility_type="MENTAL_HEALTH_MHP"
            )
            self.admin = self._user(self.org, "Org Admin")
            self.other_admin = self._user(self.other, "Org Admin")
            self.clinician = self._user(self.org, "Psychiatrist")
            self.super_admin = User.objects.create_superuser(
                email=f"super-{uuid.uuid4().hex[:5]}@platform.test", password="Password123!"
            )
            self.item = ServiceCatalogueItem.objects.create(
                name="Test catalogue service", category="Test category"
            )
            self.retired = ServiceCatalogueItem.objects.create(
                name="Test retired service", category="Test category", active=False
            )

    def _user(self, org, role):
        user = User.objects.create_user(
            email=f"{uuid.uuid4().hex[:8]}@org.test",
            password="Password123!",
            organization=org,
            is_active=True,
        )
        user.roles.add(Role.objects.get(name=role, organization__isnull=True))
        return user

    @staticmethod
    def auth(user):
        return {"HTTP_AUTHORIZATION": f"Bearer {issue_tokens(user)[0]}"}

    def test_add_from_catalogue_is_unpriced_and_only_in_this_organisation(self):
        url = reverse("care-billing-services-catalogue")
        listed = self.client.get(url, **self.auth(self.admin))
        self.assertEqual(listed.status_code, 200)
        entry = next(e for e in listed.data if e["id"] == str(self.item.id))
        self.assertFalse(entry["on_tariff"])
        self.assertNotIn(str(self.retired.id), [e["id"] for e in listed.data])
        added = self.client.post(
            url, {"items": [str(self.item.id)]}, format="json", **self.auth(self.admin)
        )
        self.assertEqual(added.status_code, 201, added.data)
        self.assertIsNone(added.data[0]["rate"])
        again = self.client.post(
            url, {"items": [str(self.item.id)]}, format="json", **self.auth(self.admin)
        )
        self.assertEqual(again.data, [])
        with platform_admin_context():
            self.assertEqual(
                BillingService.objects.filter(name="Test catalogue service").count(), 1
            )
            self.assertEqual(
                BillingService.objects.get(name="Test catalogue service").organization, self.org
            )
        retired = self.client.post(
            url, {"items": [str(self.retired.id)]}, format="json", **self.auth(self.admin)
        )
        self.assertEqual(retired.status_code, 400)
        self.assertEqual(self.client.get(url, **self.auth(self.clinician)).status_code, 403)

    def test_org_admin_writes_a_line(self):
        url = reverse("care-billing-services")
        made = self.client.post(
            url,
            {"category": "Medication", "medicine_name": "Test drug", "mass": "5mg", "rate": "12"},
            format="json",
            **self.auth(self.admin),
        )
        self.assertEqual(made.status_code, 201, made.data)
        self.assertEqual((made.data["name"], made.data["rate"]), ("Test drug 5mg", "12.00"))
        dup = self.client.post(
            url,
            {"category": "Medication", "medicine_name": "Test drug", "mass": "5mg"},
            format="json",
            **self.auth(self.admin),
        )
        self.assertEqual(dup.status_code, 400)
        refused = self.client.post(
            url, {"name": "Test"}, format="json", **self.auth(self.clinician)
        )
        self.assertEqual(refused.status_code, 403)

    def test_insurers_are_per_organisation_and_rated_per_service(self):
        url = reverse("insurer-list")
        made = self.client.post(
            url, {"name": "Test Insurer"}, format="json", **self.auth(self.admin)
        )
        self.assertEqual(made.status_code, 201, made.data)
        dup = self.client.post(
            url, {"name": "test insurer"}, format="json", **self.auth(self.admin)
        )
        self.assertEqual(dup.status_code, 400)
        refused = self.client.post(
            url, {"name": "Other"}, format="json", **self.auth(self.clinician)
        )
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(len(self.client.get(url, **self.auth(self.clinician)).data), 1)
        self.assertEqual(len(self.client.get(url, **self.auth(self.other_admin)).data), 0)

        with platform_admin_context():
            service = BillingService.objects.create(
                organization=self.org, name="Test rated", rate=Decimal("100")
            )
        patch = self.client.patch(
            reverse("care-billing-service", args=[service.id]),
            {"payer_rates": [{"insurer": made.data["id"], "rate": "80"}]},
            format="json",
            **self.auth(self.admin),
        )
        self.assertEqual(patch.status_code, 200, patch.data)
        self.assertEqual(patch.data["payer_rates"][0]["insurer_name"], "Test Insurer")
        self.assertEqual(patch.data["payer_rates"][0]["rate"], "80.00")
        with platform_admin_context():
            foreign = Insurer.objects.create(organization=self.other, name="Foreign")
        bad = self.client.patch(
            reverse("care-billing-service", args=[service.id]),
            {"payer_rates": [{"insurer": str(foreign.id), "rate": "1"}]},
            format="json",
            **self.auth(self.admin),
        )
        self.assertEqual(bad.status_code, 400)
        retire = self.client.patch(
            reverse("insurer-detail", args=[made.data["id"]]),
            {"active": False},
            format="json",
            **self.auth(self.admin),
        )
        self.assertEqual(retire.status_code, 200)
        gone = self.client.delete(
            reverse("insurer-detail", args=[made.data["id"]]), **self.auth(self.admin)
        )
        self.assertEqual(gone.status_code, 405)

    def test_super_admin_keeps_the_catalogue(self):
        url = reverse("platform-service-catalogue")
        self.assertEqual(self.client.get(url, **self.auth(self.admin)).status_code, 403)
        made = self.client.post(
            url,
            {"category": "Medication", "medicine_name": "Test med", "mass": "10mg"},
            format="json",
            **self.auth(self.super_admin),
        )
        self.assertEqual(made.status_code, 201, made.data)
        self.assertEqual(made.data["name"], "Test med 10mg")
        self.assertNotIn("rate", made.data)
        retire = self.client.patch(
            reverse("platform-service-catalogue-item", args=[made.data["id"]]),
            {"active": False},
            format="json",
            **self.auth(self.super_admin),
        )
        self.assertEqual(retire.status_code, 200)
        self.assertFalse(retire.data["active"])

    def test_catalogue_is_seeded_without_prices(self):
        with platform_admin_context():
            self.assertGreater(ServiceCatalogueItem.objects.count(), 100)
            self.assertTrue(
                ServiceCatalogueItem.objects.filter(
                    category="Medication", name="Olanzapine 5mg", mass="5mg"
                ).exists()
            )
            self.assertFalse(ServiceCatalogueItem.objects.filter(name__icontains="cafric").exists())
        self.assertFalse(hasattr(ServiceCatalogueItem, "rate"))
