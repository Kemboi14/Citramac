"""CITRAMAC subscription billing by branches, private rooms and shared rooms
(owner decisions 2026-11-26) — apps.tenancy.subscription_billing."""

from datetime import date, timedelta
from decimal import Decimal

from django.db import DatabaseError, connection, transaction
from django.test import TransactionTestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import clear_tenant_context, platform_admin_context, set_tenant_context

from . import subscription_billing as billing
from .models import (
    Branch,
    Organization,
    Subscription,
    SubscriptionPlan,
    SubscriptionStatement,
)
from .subscription_lifecycle import process_all_subscriptions


def _make_type(org, name, room_class):
    from apps.care_pathway.models import BillingService
    from apps.ipd_ward.models import AccommodationType

    service, _ = BillingService.all_objects.get_or_create(
        organization=org, name=f"Bed-day — {name}"
    )
    kind, _ = AccommodationType.all_objects.get_or_create(
        organization=org, name=name, defaults={"billing_service": service}
    )
    kind.room_class = room_class
    kind.save()
    return kind


class PeriodTests(APITestCase):
    def _sub(self, end, cycle="MONTHLY", started_on=None):
        return Subscription(current_period_end=end, billing_cycle=cycle, started_on=started_on)

    def test_monthly_period_is_the_month_ending_on_the_period_end(self):
        self.assertEqual(
            billing.current_period(self._sub(date(2026, 12, 31))),
            (date(2026, 12, 1), date(2026, 12, 31)),
        )
        self.assertEqual(
            billing.current_period(self._sub(date(2026, 3, 31))),
            (date(2026, 3, 1), date(2026, 3, 31)),
        )
        self.assertEqual(
            billing.current_period(self._sub(date(2027, 1, 15))),
            (date(2026, 12, 16), date(2027, 1, 15)),
        )

    def test_annual_period_is_twelve_months(self):
        self.assertEqual(
            billing.current_period(self._sub(date(2027, 11, 25), "ANNUAL")),
            (date(2026, 11, 26), date(2027, 11, 25)),
        )

    def test_period_never_starts_before_the_subscription(self):
        sub = self._sub(date(2027, 3, 31), "ANNUAL", started_on=date(2026, 11, 26))
        self.assertEqual(billing.current_period(sub), (date(2026, 11, 26), date(2027, 3, 31)))


class SubscriptionBillingTests(APITestCase):
    def setUp(self):
        from apps.ipd_ward.models import AccommodationType, Bed, Room, Ward

        self.addCleanup(clear_tenant_context)
        self.today = timezone.localdate()
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Amani Wellness", slug="amani-bill", facility_type="CLINIC"
            )
            self.other_org = Organization.objects.create(
                name="Other Clinic", slug="other-bill", facility_type="CLINIC"
            )
            self.branch = Branch.objects.create(
                organization=self.org, name="Chiromo", facility_level="L4"
            )
            self.closed = Branch.objects.create(
                organization=self.org, name="Closed", facility_level="L4", is_active=False
            )
            self.plan = SubscriptionPlan.objects.create(
                name="Growth",
                code="growth-bill",
                max_branches=5,
                price_monthly="1000.00",
                rate_per_branch="500.00",
                rate_per_private_room="300.00",
                rate_per_shared_room=None,
            )
            self.subscription = Subscription.objects.create(
                organization=self.org,
                plan=self.plan,
                billing_cycle="MONTHLY",
                current_period_end=self.today + timedelta(days=20),
            )
            self.other_subscription = Subscription.objects.create(
                organization=self.other_org,
                plan=self.plan,
                billing_cycle="MONTHLY",
                current_period_end=self.today + timedelta(days=20),
            )

            private = _make_type(self.org, "Private room", AccommodationType.CLASS_PRIVATE_ROOM)
            shared = _make_type(self.org, "Shared room", AccommodationType.CLASS_SHARED_ROOM)
            bay = _make_type(self.org, "Shared bed", AccommodationType.CLASS_WARD_BAY)
            self.vip = _make_type(self.org, "VIP", AccommodationType.CLASS_UNCLASSIFIED)

            ward = Ward.objects.create(organization=self.org, name="Ward A", branch=self.branch)
            Room.objects.create(
                organization=self.org, ward=ward, name="P1", accommodation_type=private
            )
            p2 = Room.objects.create(
                organization=self.org, ward=ward, name="P2", accommodation_type=private
            )
            Room.objects.create(
                organization=self.org, ward=ward, name="S1", accommodation_type=shared
            )
            Room.objects.create(
                organization=self.org, ward=ward, name="Bay", accommodation_type=bay
            )
            Room.objects.create(organization=self.org, ward=ward, name="Untyped")
            Room.objects.create(
                organization=self.org, ward=ward, name="Suite", accommodation_type=self.vip
            )
            # A bed in P2 carries a shared-room type: P2 still counts as private.
            Bed.objects.create(
                organization=self.org,
                ward=ward,
                bed_number="P2-1",
                room=p2,
                accommodation_type=shared,
            )
            Bed.objects.create(organization=self.org, ward=ward, bed_number="Loose-1")

            closed_ward = Ward.objects.create(
                organization=self.org, name="Old ward", branch=self.closed
            )
            Room.objects.create(
                organization=self.org, ward=closed_ward, name="P9", accommodation_type=private
            )
            no_branch = Ward.objects.create(organization=self.org, name="Annex")
            Room.objects.create(
                organization=self.org, ward=no_branch, name="P3", accommodation_type=private
            )

            self.org_admin = User.objects.create_user(
                email="admin@amani-bill.test",
                password="Password123!",  # pragma: allowlist secret
                organization=self.org,
                is_active=True,
            )
            self.org_admin.roles.add(Role.objects.get(name="Org Admin", organization__isnull=True))
            self.nurse = User.objects.create_user(
                email="nurse@amani-bill.test",
                password="Password123!",  # pragma: allowlist secret
                organization=self.org,
                primary_branch=self.branch,
                is_active=True,
            )
            self.nurse.branch_access.add(self.branch)
            self.other_admin = User.objects.create_user(
                email="admin@other-bill.test",
                password="Password123!",  # pragma: allowlist secret
                organization=self.other_org,
                is_active=True,
            )
            self.other_admin.roles.add(
                Role.objects.get(name="Org Admin", organization__isnull=True)
            )
            self.super_admin = User.objects.create_superuser(
                email="root-bill@platform.test",
                password="Password123!",  # pragma: allowlist secret
            )

    def _auth(self, user):
        access, _ = issue_tokens(user)
        return {"HTTP_AUTHORIZATION": f"Bearer {access}"}

    def _statements(self, org=None):
        with platform_admin_context():
            return list(
                SubscriptionStatement.objects.filter(organization=org or self.org).order_by(
                    "created_at"
                )
            )

    # ── counting ──

    def test_usage_counts_by_each_rooms_own_class(self):
        with platform_admin_context():
            usage = billing.count_usage(self.org.id)
        self.assertEqual(usage["branches"], 1)
        self.assertEqual(usage["branch_names"], ["Chiromo"])
        # P1, P2 and the Annex's P3 (a ward with no branch); not the closed branch's P9.
        self.assertEqual(usage["private_rooms"], 3)
        self.assertEqual(usage["shared_rooms"], 1)
        self.assertEqual(usage["ward_bays"], 1)
        self.assertEqual(usage["beds_outside_rooms"], 1)
        self.assertEqual(usage["unclassified_rooms"], 2)
        reasons = {row["room"]: row["reason"] for row in usage["unclassified"]}
        self.assertEqual(reasons["Ward A / Untyped"], "It has no accommodation type")
        self.assertIn('"VIP" has no class', reasons["Ward A / Suite"])
        self.assertEqual([n["room"] for n in usage["notes"]], ["Ward A / P2"])

    def test_blank_rate_is_shown_not_charged(self):
        with platform_admin_context():
            usage = billing.count_usage(self.org.id)
        lines, total = billing.price_lines(self.plan, usage, 1)
        by_key = {line["key"]: line for line in lines}
        self.assertEqual(by_key["base"]["amount"], "1000.00")
        self.assertEqual(by_key["branches"]["amount"], "500.00")
        self.assertEqual(by_key["private_rooms"]["amount"], "900.00")
        shared = by_key["shared_rooms"]
        self.assertEqual(shared["count"], 1)
        self.assertIsNone(shared["rate"])
        self.assertIsNone(shared["amount"])
        self.assertEqual(shared["note"], "No rate set")
        self.assertFalse(shared["charged"])
        self.assertEqual(total, Decimal("2400.00"))

    def test_annual_cycle_is_twelve_times_monthly(self):
        with platform_admin_context():
            usage = billing.count_usage(self.org.id)
        _, total = billing.price_lines(self.plan, usage, 12)
        self.assertEqual(total, Decimal("2400.00") * 12)

    # ── statements ──

    def test_daily_job_issues_one_frozen_statement_per_period(self):
        from apps.ipd_ward.models import Room, Ward

        process_all_subscriptions(self.today)
        process_all_subscriptions(self.today)
        statements = self._statements()
        self.assertEqual(len(statements), 1)
        statement = statements[0]
        start, end = billing.current_period(self.subscription)
        self.assertEqual((statement.period_start, statement.period_end), (start, end))
        self.assertEqual(statement.method, SubscriptionStatement.METHOD_SCHEDULED)
        self.assertEqual(statement.currency, "KES")
        self.assertEqual(statement.total, Decimal("2400.00"))
        self.assertEqual(statement.usage["unclassified_rooms"], 2)
        # One per organisation: the other tenant got its own.
        self.assertEqual(len(self._statements(self.other_org)), 1)

        # Later changes never alter an issued statement.
        with platform_admin_context():
            ward = Ward.objects.get(organization=self.org, name="Ward A")
            Room.objects.create(
                organization=self.org,
                ward=ward,
                name="P4",
                accommodation_type=Room.objects.get(name="P1").accommodation_type,
            )
            self.plan.rate_per_private_room = Decimal("999.00")
            self.plan.save()
        process_all_subscriptions(self.today)
        self.assertEqual(len(self._statements()), 1)
        with platform_admin_context():
            statement.refresh_from_db()
        self.assertEqual(statement.total, Decimal("2400.00"))

    def test_no_statement_before_the_period_or_when_not_active(self):
        with platform_admin_context():
            self.subscription.status = Subscription.STATUS_CANCELED
            self.subscription.save()
        process_all_subscriptions(self.today)
        self.assertEqual(self._statements(), [])

    def test_statement_rows_cannot_be_changed_or_deleted(self):
        process_all_subscriptions(self.today)
        with platform_admin_context():
            with self.assertRaises(DatabaseError), transaction.atomic():
                SubscriptionStatement.objects.filter(organization=self.org).update(total=0)
            with self.assertRaises(DatabaseError), transaction.atomic():
                SubscriptionStatement.objects.filter(organization=self.org).delete()

    def test_issue_now_is_super_admin_only_and_once_per_period(self):
        url = reverse("platform-organization-subscription-billing", args=[self.org.id])
        refused = self.client.post(url, {}, format="json", **self._auth(self.org_admin))
        self.assertEqual(refused.status_code, 403)
        created = self.client.post(url, {}, format="json", **self._auth(self.super_admin))
        self.assertEqual(created.status_code, 201, created.data)
        self.assertTrue(created.data["current_period_has_statement"])
        self.assertEqual(len(created.data["statements"]), 1)
        self.assertEqual(created.data["statements"][0]["method"], "MANUAL")
        again = self.client.post(url, {}, format="json", **self._auth(self.super_admin))
        self.assertEqual(again.status_code, 400)
        # The daily job then adds nothing.
        process_all_subscriptions(self.today)
        self.assertEqual(len(self._statements()), 1)
        with platform_admin_context():
            self.assertTrue(
                AuditLogEntry.objects.filter(
                    model="tenancy.subscriptionstatement",
                    action=AuditLogEntry.ACTION_CREATE,
                    organization_id=self.org.id,
                ).exists()
            )

    def test_correction_needs_a_reason_and_supersedes_the_latest_only(self):
        process_all_subscriptions(self.today)
        original = self._statements()[0]
        with platform_admin_context():
            self.plan.rate_per_shared_room = Decimal("200.00")
            self.plan.save()
        url = reverse("subscription-statement-supersede", args=[original.id])
        missing = self.client.post(
            url, {"reason": " "}, format="json", **self._auth(self.super_admin)
        )
        self.assertEqual(missing.status_code, 400)
        refused = self.client.post(
            url, {"reason": "Rate"}, format="json", **self._auth(self.org_admin)
        )
        self.assertEqual(refused.status_code, 403)
        ok = self.client.post(
            url,
            {"reason": "Shared-room rate agreed before the period started"},
            format="json",
            **self._auth(self.super_admin),
        )
        self.assertEqual(ok.status_code, 201, ok.data)
        rows = {row["id"]: row for row in ok.data["statements"]}
        self.assertTrue(rows[str(original.id)]["superseded"])
        statements = self._statements()
        self.assertEqual(len(statements), 2)
        correction = statements[1]
        self.assertEqual(correction.supersedes_id, original.id)
        self.assertEqual(correction.method, SubscriptionStatement.METHOD_CORRECTION)
        self.assertEqual(correction.period_start, original.period_start)
        self.assertEqual(correction.total, Decimal("2600.00"))
        self.assertTrue(correction.reference.endswith("-C1"))
        self.assertFalse(rows[str(correction.id)]["superseded"])
        with platform_admin_context():
            original.refresh_from_db()
        self.assertEqual(original.total, Decimal("2400.00"))
        twice = self.client.post(
            url, {"reason": "Again"}, format="json", **self._auth(self.super_admin)
        )
        self.assertEqual(twice.status_code, 400)
        with platform_admin_context():
            entry = AuditLogEntry.objects.get(
                model="tenancy.subscriptionstatement", object_id=str(correction.id)
            )
        self.assertIn("Shared-room rate", entry.field_diff["reason"]["new"])

    # ── plan rates ──

    def test_only_super_admin_sets_rates_and_each_change_is_audited(self):
        url = reverse("subscription-plan-detail", args=[self.plan.id])
        refused = self.client.patch(
            url, {"rate_per_shared_room": "150.00"}, format="json", **self._auth(self.org_admin)
        )
        self.assertEqual(refused.status_code, 403)
        negative = self.client.patch(
            url, {"rate_per_branch": "-1"}, format="json", **self._auth(self.super_admin)
        )
        self.assertEqual(negative.status_code, 400)
        ok = self.client.patch(
            url,
            {"rate_per_shared_room": "150.00", "rate_per_branch": None},
            format="json",
            **self._auth(self.super_admin),
        )
        self.assertEqual(ok.status_code, 200, ok.data)
        self.assertEqual(ok.data["rate_per_shared_room"], "150.00")
        self.assertIsNone(ok.data["rate_per_branch"])
        with platform_admin_context():
            entry = (
                AuditLogEntry.objects.filter(
                    model="tenancy.subscriptionplan",
                    object_id=str(self.plan.id),
                    action=AuditLogEntry.ACTION_UPDATE,
                )
                .order_by("-timestamp")
                .first()
            )
        self.assertEqual(entry.field_diff["rate_per_shared_room"]["new"], "150.00")
        self.assertEqual(entry.field_diff["rate_per_branch"]["old"], "500.00")

    # ── visibility ──

    def test_org_admin_reads_own_billing_only(self):
        process_all_subscriptions(self.today)
        mine = self.client.get(reverse("my-subscription-billing"), **self._auth(self.org_admin))
        self.assertEqual(mine.status_code, 200, mine.data)
        self.assertEqual(mine.data["organization"], str(self.org.id))
        self.assertEqual(mine.data["usage"]["private_rooms"], 3)
        self.assertEqual(mine.data["rates"]["rate_per_shared_room"], None)
        self.assertEqual(len(mine.data["statements"]), 1)
        self.assertEqual(
            self.client.get(
                reverse("my-subscription-billing"), **self._auth(self.nurse)
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.get(
                reverse("platform-organization-subscription-billing", args=[self.org.id]),
                **self._auth(self.org_admin),
            ).status_code,
            403,
        )
        theirs = self._statements(self.other_org)[0]
        self.assertEqual(
            self.client.get(
                reverse("subscription-statement-print", args=[theirs.id]),
                **self._auth(self.org_admin),
            ).status_code,
            404,
        )

    def test_statement_preview_on_platform_letterhead_is_audited(self):
        process_all_subscriptions(self.today)
        statement = self._statements()[0]
        url = reverse("subscription-statement-print", args=[statement.id])
        response = self.client.get(url, **self._auth(self.org_admin))
        self.assertEqual(response.status_code, 200)
        html = response.content.decode()
        self.assertIn(statement.reference, html)
        self.assertIn("CITRAMAC", html)
        self.assertIn("No rate set", html)
        self.assertIn("Ward A / Untyped", html)
        self.assertEqual(
            self.client.get(url, **self._auth(self.nurse)).status_code,
            403,
        )
        self.assertEqual(self.client.get(url, **self._auth(self.super_admin)).status_code, 200)
        with platform_admin_context():
            self.assertEqual(
                AuditLogEntry.objects.filter(
                    model="tenancy.subscriptionstatement",
                    object_id=str(statement.id),
                    action=AuditLogEntry.ACTION_VIEW,
                ).count(),
                2,
            )

    def test_super_admin_sees_live_usage(self):
        response = self.client.get(
            reverse("platform-organization-subscription-billing", args=[self.org.id]),
            **self._auth(self.super_admin),
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["current_period_has_statement"])
        self.assertEqual(response.data["usage"]["unclassified_rooms"], 2)
        self.assertEqual(response.data["estimate"]["total"], "2400.00")

    # ── accommodation class ──

    def test_org_admin_classifies_an_accommodation_type(self):
        url = reverse("ipd-accommodation-type-detail", args=[self.vip.id])
        refused = self.client.patch(
            url, {"room_class": "PRIVATE_ROOM"}, format="json", **self._auth(self.nurse)
        )
        self.assertEqual(refused.status_code, 403)
        invalid = self.client.patch(
            url, {"room_class": "PENTHOUSE"}, format="json", **self._auth(self.org_admin)
        )
        self.assertEqual(invalid.status_code, 400)
        ok = self.client.patch(
            url, {"room_class": "PRIVATE_ROOM"}, format="json", **self._auth(self.org_admin)
        )
        self.assertEqual(ok.status_code, 200, ok.data)
        self.assertEqual(ok.data["room_class"], "PRIVATE_ROOM")
        with platform_admin_context():
            usage = billing.count_usage(self.org.id)
        self.assertEqual(usage["private_rooms"], 4)
        self.assertEqual(usage["unclassified_rooms"], 1)

    def test_seeded_types_start_unclassified(self):
        from apps.ipd_ward import accommodation

        with platform_admin_context():
            accommodation.seed_types(self.other_org.id)
            classes = set(
                accommodation.types()
                .filter(organization=self.other_org)
                .values_list("room_class", flat=True)
            )
        self.assertEqual(classes, {""})


class SubscriptionStatementIsolationTests(TransactionTestCase):
    """RLS on the statement table — same contract as TenantIsolationTests
    (TransactionTestCase for the reason given there)."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        today = timezone.localdate()
        with platform_admin_context():
            plan = SubscriptionPlan.objects.create(
                name="Iso", code="iso-bill", max_branches=1, price_monthly="10.00"
            )
            self.orgs = []
            for slug in ("iso-bill-a", "iso-bill-b"):
                org = Organization.objects.create(name=slug, slug=slug, facility_type="CLINIC")
                Subscription.objects.create(
                    organization=org, plan=plan, current_period_end=today + timedelta(days=5)
                )
                self.orgs.append(org)
            billing.issue_due_statements(today)

    def test_each_org_sees_only_its_own_statements_even_in_raw_sql(self):
        org_a, org_b = self.orgs
        set_tenant_context(organization_id=org_a.id)
        self.assertEqual(
            list(SubscriptionStatement.all_objects.values_list("organization_id", flat=True)),
            [org_a.id],
        )
        with connection.cursor() as cursor:
            cursor.execute("SELECT organization_id FROM tenancy_subscriptionstatement")
            self.assertEqual([row[0] for row in cursor.fetchall()], [org_a.id])
        self.assertIsNone(SubscriptionStatement.all_objects.filter(organization=org_b).first())
