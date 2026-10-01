from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.accounts.tokens import issue_tokens
from apps.notifications.models import Notification, NotificationDelivery
from apps.tenancy.context import clear_tenant_context, platform_admin_context

from .models import Branch, Organization, Subscription, SubscriptionPlan, SubscriptionPolicy
from .subscription_lifecycle import process_all_subscriptions, reminder_stage


class ReminderStageTests(APITestCase):
    def test_stage_is_the_tightest_window_the_end_date_is_within(self):
        offsets = [30, 14, 7, 3, 1]
        self.assertIsNone(reminder_stage(45, offsets))
        self.assertEqual(reminder_stage(30, offsets), 30)
        self.assertEqual(reminder_stage(20, offsets), 30)
        self.assertEqual(reminder_stage(10, offsets), 14)
        self.assertEqual(reminder_stage(7, offsets), 7)
        self.assertEqual(reminder_stage(1, offsets), 1)
        self.assertEqual(reminder_stage(0, offsets), 0)


class SubscriptionLifecycleTests(APITestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        self.today = timezone.localdate()
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Amani Wellness",
                slug="amani-sub",
                facility_type="CLINIC",
                support_email="support@amani.test",
            )
            self.branch = Branch.objects.create(
                organization=self.org, name="Chiromo", facility_level="L4"
            )
            self.plan = SubscriptionPlan.objects.create(
                name="Growth", code="growth-life", max_branches=5, price_monthly="100.00"
            )
            self.subscription = Subscription.objects.create(
                organization=self.org,
                plan=self.plan,
                current_period_end=self.today + timedelta(days=7),
            )
            self.org_admin = User.objects.create_user(
                email="admin@amani-sub.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
                phone="0712345678",
            )
            self.org_admin.roles.add(Role.objects.get(name="Org Admin", organization__isnull=True))
            self.clinician = User.objects.create_user(
                email="nurse@amani-sub.test",
                password="Password123!",
                organization=self.org,
                primary_branch=self.branch,
                is_active=True,
            )
            self.clinician.branch_access.add(self.branch)
            self.super_admin = User.objects.create_superuser(
                email="root-sub@platform.test", password="Password123!"
            )

    def _auth(self, user):
        access, _ = issue_tokens(user)
        return {"HTTP_AUTHORIZATION": f"Bearer {access}"}

    def _refresh(self):
        with platform_admin_context():
            self.subscription.refresh_from_db()

    def _notices(self, user):
        with platform_admin_context():
            return list(
                Notification.objects.filter(
                    recipient=user, category=Notification.CATEGORY_SUBSCRIPTION
                ).order_by("created_at")
            )

    def test_reminder_goes_to_org_admins_by_every_channel_once(self):
        process_all_subscriptions(self.today)
        process_all_subscriptions(self.today)
        notices = self._notices(self.org_admin)
        self.assertEqual(len(notices), 1)
        self.assertIn("7 days", notices[0].title)
        self.assertEqual(self._notices(self.clinician), [])
        with platform_admin_context():
            deliveries = {
                (d.channel, d.address)
                for d in NotificationDelivery.objects.filter(organization=self.org)
            }
        self.assertEqual(
            deliveries,
            {
                ("EMAIL", "admin@amani-sub.test"),
                ("EMAIL", "support@amani.test"),
                ("SMS", "0712345678"),
            },
        )

    def test_period_end_moves_to_past_due_then_expired(self):
        grace = SubscriptionPolicy.get_solo().grace_period_days
        day_after = self.subscription.current_period_end + timedelta(days=1)
        process_all_subscriptions(day_after)
        self._refresh()
        self.assertEqual(self.subscription.status, Subscription.STATUS_PAST_DUE)
        self.assertIsNotNone(self.subscription.past_due_since)

        past_grace = self.subscription.past_due_since + timedelta(days=grace + 1)
        process_all_subscriptions(past_grace)
        self._refresh()
        self.assertEqual(self.subscription.status, Subscription.STATUS_EXPIRED)
        titles = [n.title for n in self._notices(self.org_admin)]
        self.assertTrue(any("read-only" in t for t in titles), titles)

    def test_expired_tenant_is_read_only_not_locked_out(self):
        with platform_admin_context():
            self.subscription.status = Subscription.STATUS_EXPIRED
            self.subscription.save()
        auth = self._auth(self.clinician)
        self.assertEqual(self.client.get(reverse("patient-list"), **auth).status_code, 200)
        write = self.client.post(
            reverse("patient-list"),
            {"first_name": "A", "last_name": "B", "gender": "MALE", "date_of_birth": "1990-01-01"},
            format="json",
            **auth,
        )
        self.assertEqual(write.status_code, 403)
        self.assertEqual(write.data["error"]["code"], "SUBSCRIPTION_EXPIRED")
        # Notifications can still be dismissed.
        self.assertEqual(
            self.client.post(reverse("notification-mark-all-read"), **auth).status_code, 204
        )

    def test_renewal_restores_active_and_tells_the_tenant(self):
        with platform_admin_context():
            self.subscription.status = Subscription.STATUS_EXPIRED
            self.subscription.save()
        response = self.client.patch(
            reverse("subscription-detail", args=[self.subscription.id]),
            {"current_period_end": str(self.today + timedelta(days=365))},
            format="json",
            **self._auth(self.super_admin),
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "ACTIVE")
        self.assertIsNone(response.data["past_due_since"])
        self.assertTrue(any("renewed" in n.title for n in self._notices(self.org_admin)))

    def test_active_status_with_a_past_period_end_is_refused(self):
        with platform_admin_context():
            self.subscription.status = Subscription.STATUS_EXPIRED
            self.subscription.current_period_end = self.today - timedelta(days=30)
            self.subscription.save()
        response = self.client.patch(
            reverse("subscription-detail", args=[self.subscription.id]),
            {"status": "ACTIVE"},
            format="json",
            **self._auth(self.super_admin),
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(any("renewed" in n.title for n in self._notices(self.org_admin)))

    def test_manual_expiry_still_records_when_it_lapsed(self):
        with platform_admin_context():
            self.subscription.status = Subscription.STATUS_EXPIRED
            self.subscription.save()
            self.subscription.refresh_from_db()
        self.assertEqual(self.subscription.past_due_since, self.today)

    def test_every_member_can_read_their_own_subscription_state(self):
        response = self.client.get(reverse("my-subscription"), **self._auth(self.clinician))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "ACTIVE")
        self.assertEqual(response.data["days_until_period_end"], 7)
        self.assertTrue(response.data["renewing_soon"])
        platform = self.client.get(reverse("my-subscription"), **self._auth(self.super_admin))
        self.assertEqual(platform.status_code, 200)
        # A literal JSON null, never an empty body — an empty body is read as
        # "{}" by the frontend and crashed every shell for platform staff.
        self.assertEqual(platform.content, b"null")
        self.assertEqual(platform["Content-Type"], "application/json")

    def test_member_of_org_without_subscription_gets_json_null(self):
        with platform_admin_context():
            Subscription.objects.filter(organization=self.org).delete()
        response = self.client.get(reverse("my-subscription"), **self._auth(self.clinician))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"null")

    def test_policy_is_super_admin_only(self):
        url = reverse("subscription-policy")
        self.assertEqual(
            self.client.patch(
                url, {"grace_period_days": 60}, format="json", **self._auth(self.org_admin)
            ).status_code,
            403,
        )
        ok = self.client.patch(
            url,
            {"reminder_days_before": [7, 60, 7], "renewal_contact": "billing@citramac.test"},
            format="json",
            **self._auth(self.super_admin),
        )
        self.assertEqual(ok.status_code, 200, ok.data)
        self.assertEqual(ok.data["reminder_days_before"], [60, 7])

    def test_super_admins_get_a_daily_digest(self):
        process_all_subscriptions(self.today)
        with platform_admin_context():
            digest = Notification.objects.filter(
                recipient=self.super_admin, dedupe_key=f"platform:subscription-digest:{self.today}"
            )
            self.assertEqual(digest.count(), 1)


class ArchivedOrganizationTests(APITestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Closed Org", slug="closed-org", facility_type="CLINIC"
            )
            self.user = User.objects.create_user(
                email="staff@closed-org.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
        self.access, _ = issue_tokens(self.user)

    def test_archived_organization_blocks_existing_tokens_but_keeps_its_data(self):
        with platform_admin_context():
            self.org.status = Organization.STATUS_ARCHIVED
            self.org.save()
        response = self.client.get(
            reverse("patient-list"), HTTP_AUTHORIZATION=f"Bearer {self.access}"
        )
        self.assertEqual(response.status_code, 401)
        with platform_admin_context():
            self.assertTrue(User.objects.filter(pk=self.user.pk).exists())

    def test_login_says_archived_not_suspended(self):
        with platform_admin_context():
            self.org.status = Organization.STATUS_ARCHIVED
            self.org.save()
        response = self.client.post(
            reverse("auth-login"),
            {"email": "staff@closed-org.test", "password": "Password123!"},
            format="json",
        )
        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual(response.data["error"]["code"], "ORGANIZATION_SUSPENDED")
        self.assertIn("archived", response.data["error"]["message"])


class ProfileContextTests(APITestCase):
    """The topbar organisation · branch pill reads this."""

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Amani Wellness", slug="amani-pill", facility_type="CLINIC"
            )
            self.chiromo = Branch.objects.create(
                organization=self.org, name="Chiromo", facility_level="L4"
            )
            self.karen = Branch.objects.create(
                organization=self.org, name="Karen", facility_level="L3"
            )
            self.closed = Branch.objects.create(
                organization=self.org, name="Closed", facility_level="L3", is_active=False
            )
            self.nurse = User.objects.create_user(
                email="nurse@amani-pill.test",
                password="Password123!",
                organization=self.org,
                primary_branch=self.chiromo,
                is_active=True,
            )
            self.nurse.branch_access.add(self.chiromo, self.karen, self.closed)

    def test_profile_carries_organization_and_active_branches(self):
        access, _ = issue_tokens(self.nurse)
        response = self.client.get(reverse("me-profile"), HTTP_AUTHORIZATION=f"Bearer {access}")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["organization_name"], "Amani Wellness")
        self.assertEqual(response.data["primary_branch"]["name"], "Chiromo")
        self.assertEqual(
            [(b["name"], b["is_primary"]) for b in response.data["branches"]],
            [("Chiromo", True), ("Karen", False)],
        )

    def test_token_refresh_picks_up_branch_access_changes(self):
        from rest_framework_simplejwt.tokens import AccessToken

        _, refresh = issue_tokens(self.nurse)
        with platform_admin_context():
            self.nurse.branch_access.remove(self.karen)
        response = self.client.post(reverse("auth-refresh"), {"refresh": refresh}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        claims = AccessToken(response.data["access"])
        self.assertEqual(set(claims["branch_ids"]), {str(self.chiromo.id), str(self.closed.id)})


class PlatformHealthTests(APITestCase):
    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.super_admin = User.objects.create_superuser(
                email="root-health@platform.test", password="Password123!"
            )

    def test_reports_real_checks_and_flags_undelivered_notices(self):
        access, _ = issue_tokens(self.super_admin)
        auth = {"HTTP_AUTHORIZATION": f"Bearer {access}"}
        healthy = self.client.get(reverse("platform-health"), **auth)
        self.assertEqual(healthy.status_code, 200)
        self.assertEqual(healthy.data["status"], "ok")
        NotificationDelivery.objects.create(
            dedupe_key="k",
            channel="EMAIL",
            address="x@example.test",
            body_text="b",
            status=NotificationDelivery.STATUS_NOT_CONFIGURED,
        )
        degraded = self.client.get(reverse("platform-health"), **auth)
        self.assertEqual(degraded.data["status"], "degraded")
        self.assertEqual(degraded.data["undelivered_notices_24h"], 1)
