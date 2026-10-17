"""Per-branch registered-health-provider identifiers: KMPDC registration
number, facility licence (renewed yearly, with reminders) and SHA FR code."""

from datetime import timedelta

from django.db import connection, transaction
from django.db.utils import DatabaseError
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.notifications.models import Notification, NotificationDelivery
from apps.tenancy.context import clear_tenant_context, platform_admin_context

from .facility_licence import remind_all
from .models import Branch, BranchIdentifierChange, Organization

# Test fixture values only — not real KMPDC, licence or FR numbers.
KMPDC = "TEST-KMPDC-1"
FR = "TEST-FR-1"


class BranchIdentifierTestBase(APITestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        self.today = timezone.localdate()
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Amani Hospital", slug="amani-ids", org_type="HOSPITAL", facility_type="CLINIC"
            )
            self.school = Organization.objects.create(
                name="Amani School", slug="amani-school", org_type="SCHOOL", facility_type="CLINIC"
            )
            self.branch = Branch.objects.create(
                organization=self.org, name="Chiromo", facility_level="L4"
            )
            self.org_admin = User.objects.create_user(
                email="admin@amani-ids.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
                phone="0712345678",
            )
            self.org_admin.roles.add(Role.objects.get(name="Org Admin", organization__isnull=True))
            self.super_admin = User.objects.create_superuser(
                email="root-ids@platform.test", password="Password123!"
            )

    def _auth(self, user):
        access, _ = issue_tokens(user)
        return {"HTTP_AUTHORIZATION": f"Bearer {access}"}

    def _create(self, data, user=None):
        return self.client.post(
            reverse("branch-list"),
            {"name": "New", "facility_level": "L3", **data},
            format="json",
            **self._auth(user or self.org_admin),
        )

    def _patch(self, data, branch=None):
        return self.client.patch(
            reverse("branch-detail", args=[(branch or self.branch).id]),
            data,
            format="json",
            **self._auth(self.org_admin),
        )


class BranchIdentifierValidationTests(BranchIdentifierTestBase):
    def test_kmpdc_number_required_for_a_health_providers_branch(self):
        refused = self._create({})
        self.assertEqual(refused.status_code, 400)
        self.assertIn("kmpdc_registration_number", refused.data)
        blank = self._create({"kmpdc_registration_number": "   "})
        self.assertIn("kmpdc_registration_number", blank.data)
        created = self._create({"kmpdc_registration_number": f" {KMPDC} "})
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["kmpdc_registration_number"], KMPDC)
        self.assertEqual(created.data["missing_identifiers"], [])

    def test_kmpdc_number_not_required_outside_health_providers(self):
        response = self._create({"organization": str(self.school.id)}, user=self.super_admin)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(response.data["is_registered_health_provider"])

    def test_legacy_branch_is_flagged_not_blocked_on_unrelated_edits(self):
        listed = self.client.get(reverse("branch-list"), **self._auth(self.org_admin))
        self.assertEqual(
            listed.data["results"][0]["missing_identifiers"], ["kmpdc_registration_number"]
        )
        ok = self._patch({"phone": "+254700000000"})
        self.assertEqual(ok.status_code, 200, ok.data)
        cleared = self._patch({"kmpdc_registration_number": ""})
        self.assertEqual(cleared.status_code, 400)
        missing = self.client.get(
            reverse("branch-list"), {"missing_identifiers": "true"}, **self._auth(self.org_admin)
        )
        self.assertEqual(missing.data["count"], 1)

    def test_fr_code_required_when_sha_claims_are_enabled(self):
        refused = self._create({"kmpdc_registration_number": KMPDC, "sha_claims_enabled": True})
        self.assertEqual(refused.status_code, 400)
        self.assertIn("sha_fr_code", refused.data)
        turned_on = self._patch({"kmpdc_registration_number": KMPDC, "sha_claims_enabled": True})
        self.assertIn("sha_fr_code", turned_on.data)
        ok = self._patch(
            {"kmpdc_registration_number": KMPDC, "sha_claims_enabled": True, "sha_fr_code": FR}
        )
        self.assertEqual(ok.status_code, 200, ok.data)

    def test_licence_number_and_expiry_go_together(self):
        no_date = self._patch(
            {"kmpdc_registration_number": KMPDC, "facility_license_number": "L-1"}
        )
        self.assertIn("facility_license_valid_until", no_date.data)
        no_number = self._patch(
            {"kmpdc_registration_number": KMPDC, "facility_license_valid_until": "2027-01-31"}
        )
        self.assertIn("facility_license_number", no_number.data)

    def test_licence_status(self):
        cases = {
            None: Branch.LICENSE_MISSING,
            -1: Branch.LICENSE_EXPIRED,
            0: Branch.LICENSE_EXPIRING,
            60: Branch.LICENSE_EXPIRING,
            61: Branch.LICENSE_VALID,
        }
        for offset, expected in cases.items():
            self.branch.facility_license_valid_until = (
                None if offset is None else self.today + timedelta(days=offset)
            )
            self.assertEqual(self.branch.license_status, expected, offset)

    def test_licence_status_filter(self):
        with platform_admin_context():
            Branch.objects.filter(pk=self.branch.pk).update(
                facility_license_valid_until=self.today - timedelta(days=1)
            )
        expired = self.client.get(
            reverse("branch-list"), {"license_status": "EXPIRED"}, **self._auth(self.super_admin)
        )
        self.assertEqual([b["id"] for b in expired.data["results"]], [str(self.branch.id)])
        self.assertEqual(expired.data["results"][0]["license_days_remaining"], -1)
        bad = self.client.get(
            reverse("branch-list"), {"license_status": "SOON"}, **self._auth(self.super_admin)
        )
        self.assertEqual(bad.status_code, 400)


class BranchIdentifierHistoryTests(BranchIdentifierTestBase):
    def test_renewal_appends_previous_values(self):
        first = self.today + timedelta(days=10)
        renewed = first + timedelta(days=365)
        self._patch(
            {
                "kmpdc_registration_number": KMPDC,
                "facility_license_number": "L-2026",
                "facility_license_valid_until": first.isoformat(),
            }
        )
        response = self._patch(
            {
                "facility_license_number": "L-2027",
                "facility_license_valid_until": renewed.isoformat(),
            }
        )
        self.assertEqual(response.status_code, 200, response.data)
        with platform_admin_context():
            changes = list(
                BranchIdentifierChange.objects.filter(branch=self.branch).order_by("created_at")
            )
        self.assertEqual(
            [(c.field, c.previous_value, c.new_value) for c in changes],
            [
                ("kmpdc_registration_number", "", KMPDC),
                ("facility_license_number", "", "L-2026"),
                ("facility_license_valid_until", "", first.isoformat()),
                ("facility_license_number", "L-2026", "L-2027"),
                ("facility_license_valid_until", first.isoformat(), renewed.isoformat()),
            ],
        )
        self.assertTrue(all(c.changed_by_id == self.org_admin.id for c in changes))
        self.assertEqual(len(response.data["identifier_history"]), 5)
        # An unchanged resubmission appends nothing.
        self._patch({"facility_license_number": "L-2027"})
        with platform_admin_context():
            self.assertEqual(BranchIdentifierChange.objects.filter(branch=self.branch).count(), 5)

    def test_history_is_append_only(self):
        self._patch({"kmpdc_registration_number": KMPDC})
        with platform_admin_context():
            change = BranchIdentifierChange.objects.get(branch=self.branch)
            with self.assertRaises(PermissionError):
                change.save()
            with self.assertRaises(PermissionError):
                change.delete()
            # The database refuses it too, whatever path issues the write.
            with self.assertRaises(DatabaseError), transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute(
                        "UPDATE tenancy_branchidentifierchange SET new_value = 'X' WHERE id = %s",
                        [change.id],
                    )


@override_settings(FACILITY_LICENSE_REMINDER_DAYS=[60, 30, 7, 0])
class FacilityLicenceReminderTests(BranchIdentifierTestBase):
    def _expire_in(self, days):
        with platform_admin_context():
            Branch.objects.filter(pk=self.branch.pk).update(
                facility_license_number="L-1",
                facility_license_valid_until=self.today + timedelta(days=days),
            )

    def _notices(self):
        with platform_admin_context():
            return list(
                Notification.objects.filter(
                    recipient=self.org_admin, category=Notification.CATEGORY_FACILITY_LICENCE
                ).order_by("created_at")
            )

    def test_reminders_at_each_lead_time_once(self):
        self._expire_in(90)
        self.assertEqual(remind_all(self.today), {})
        self.assertEqual(
            remind_all(self.today + timedelta(days=30)), {str(self.branch.id): "REMINDED:T-60"}
        )
        # Re-runs, and later days inside the same stage, send nothing new.
        remind_all(self.today + timedelta(days=30))
        remind_all(self.today + timedelta(days=45))
        self.assertEqual(len(self._notices()), 1)
        with platform_admin_context():
            self.assertEqual(
                sorted(
                    NotificationDelivery.objects.filter(
                        dedupe_key__startswith=f"branch-licence:{self.branch.id}"
                    ).values_list("channel", flat=True)
                ),
                ["EMAIL", "SMS"],
            )
        for day in (60, 61, 83, 85, 90):
            remind_all(self.today + timedelta(days=day))
        notices = self._notices()
        self.assertEqual(len(notices), 4)
        self.assertEqual(
            [n.dedupe_key.rsplit(":", 1)[-1] for n in notices], ["T-60", "T-30", "T-7", "T-0"]
        )
        self.assertIn("expires today", notices[-1].title)
        self.assertEqual(notices[-1].severity, Notification.SEVERITY_CRITICAL)

    def test_expired_notice_once_and_renewal_restarts_the_cycle(self):
        self._expire_in(-3)
        self.assertEqual(remind_all(self.today), {str(self.branch.id): "EXPIRED"})
        remind_all(self.today + timedelta(days=1))
        notices = self._notices()
        self.assertEqual(len(notices), 1)
        self.assertIn("has expired", notices[0].title)
        self._expire_in(7)  # a new expiry date is a new reminder cycle
        remind_all(self.today)
        self.assertEqual(len(self._notices()), 2)

    def test_inactive_branch_and_missing_expiry_are_skipped(self):
        self.assertEqual(remind_all(self.today), {})
        self._expire_in(5)
        with platform_admin_context():
            Branch.objects.filter(pk=self.branch.pk).update(is_active=False)
        self.assertEqual(remind_all(self.today), {})
