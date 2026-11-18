"""
Org Admin edits a staff member's details. Changing the email signs the person
out and sends an invitation to the new address; the account stays inactive
until they accept it.
"""

from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from apps.accounts.models import ActivationInvite, Role, User
from apps.accounts.tokens import issue_tokens
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization


class StaffEmailChangeTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Amani Wellness", slug="amani-email", facility_type="MENTAL_HEALTH_MHP"
            )
            admin_role = Role.objects.filter(name="Org Admin", organization__isnull=True).first()
            self.org_admin = User.objects.create_user(
                email="admin@amani.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.org_admin.roles.add(admin_role)
            self.nurse = User.objects.create_user(
                email="nurse@amani.test",
                password="Password123!",
                organization=self.org,
                first_name="Cecilia",
                last_name="Langat",
                is_active=True,
            )
        self.admin_access, _ = issue_tokens(self.org_admin)
        self.nurse_access, _ = issue_tokens(self.nurse)

    def _patch(self, user, payload):
        return self.client.patch(
            reverse("staff-detail", args=[user.id]),
            payload,
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.admin_access}",
        )

    def test_changing_email_signs_out_and_sends_a_new_invitation(self):
        response = self._patch(self.nurse, {"email": "cecilia@amani.test"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["is_active"])
        self.assertTrue(response.data["awaiting_activation"])

        with platform_admin_context():
            self.nurse.refresh_from_db()
            self.assertEqual(self.nurse.email, "cecilia@amani.test")
            self.assertFalse(self.nurse.is_active)
            outstanding = OutstandingToken.objects.filter(user=self.nurse)
            self.assertTrue(outstanding.exists())
            self.assertEqual(
                BlacklistedToken.objects.filter(token__in=outstanding).count(),
                outstanding.count(),
            )
            self.assertEqual(
                ActivationInvite.objects.filter(user=self.nurse, used_at__isnull=True).count(), 1
            )

        # The session they had is refused straight away.
        response = self.client.get(
            reverse("staff-list"), HTTP_AUTHORIZATION=f"Bearer {self.nurse_access}"
        )
        self.assertEqual(response.status_code, 401)

    def test_account_cannot_be_switched_back_on_before_the_invitation_is_accepted(self):
        self._patch(self.nurse, {"email": "cecilia@amani.test"})
        response = self._patch(self.nurse, {"is_active": True})
        self.assertEqual(response.status_code, 400)
        self.assertIn("is_active", response.data)
        with platform_admin_context():
            self.nurse.refresh_from_db()
        self.assertFalse(self.nurse.is_active)

    def test_admin_cannot_change_their_own_email_here(self):
        response = self._patch(self.org_admin, {"email": "new-admin@amani.test"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.data)

    def test_email_already_in_use_is_refused_whatever_its_case(self):
        response = self._patch(self.nurse, {"email": "ADMIN@amani.test"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.data)

    def test_same_email_in_another_case_and_name_changes_keep_the_account_active(self):
        response = self._patch(
            self.nurse,
            {"email": "Nurse@Amani.test", "first_name": "Cecilia J.", "phone": "+254700000001"},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["is_active"])
        self.assertFalse(response.data["awaiting_activation"])
        with platform_admin_context():
            self.assertFalse(ActivationInvite.objects.filter(user=self.nurse).exists())
