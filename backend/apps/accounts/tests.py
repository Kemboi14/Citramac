from django.core import mail
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .models import ActivationInvite, OneTimePassword, User


def _extract_code(email_body):
    # "Your verification code is 123456. It expires in ..."
    return email_body.split("code is ")[1].split(".")[0]


class FullActivationAndLoginFlowTests(APITestCase):
    """
    docs/11-ROADMAP-AND-PHASES.md Phase 1 exit criteria: "a Super Admin can
    create an Organization, invite an Org Admin, the Org Admin can complete
    the full activation flow and log in ... every action appears in the
    audit log." This test walks that entire path end to end.
    """

    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        # No ambient tenant context here on purpose — this is what
        # `manage.py createsuperuser` does too, and create_superuser() must
        # establish its own RLS bypass rather than relying on a caller to
        # have set one up (see its docstring/apps.accounts.models).
        self.super_admin = User.objects.create_superuser(
            email="root@citramac.local",
            password="Sup3r!SecurePass99",
            first_name="Root",
            last_name="Admin",
        )

    def _login_super_admin(self):
        response = self.client.post(
            reverse("auth-login"),
            {"email": "root@citramac.local", "password": "Sup3r!SecurePass99"},
        )
        self.assertEqual(response.status_code, 200, response.data)
        # Super Admin has mfa_enabled=True by default too — walk its 2FA.
        self.assertTrue(response.data.get("requires_otp"))
        code = _extract_code(mail.outbox[-1].body)
        otp_response = self.client.post(
            reverse("auth-login-verify-otp"),
            {"otp_token": response.data["otp_token"], "otp": code},
        )
        self.assertEqual(otp_response.status_code, 200, otp_response.data)
        return otp_response.data["access"]

    def test_full_flow_org_creation_through_login(self):
        access = self._login_super_admin()

        # 1. Super Admin creates an Organization + invites its Org Admin.
        create_response = self.client.post(
            reverse("platform-organizations"),
            {
                "name": "Amani Wellness Centre",
                "slug": "amani-wellness",
                "facility_type": "MENTAL_HEALTH_CCP",
                "org_admin": {
                    "email": "admin@amaniwellness.co.ke",
                    "first_name": "Judy",
                    "last_name": "Mwikali",
                },
            },
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )
        self.assertEqual(create_response.status_code, 201, create_response.data)

        with platform_admin_context():
            org = Organization.objects.get(slug="amani-wellness")
            org_admin = User.objects.get(email="admin@amaniwellness.co.ke")
            invite = ActivationInvite.objects.get(user=org_admin)
        self.assertEqual(org_admin.organization_id, org.id)
        self.assertFalse(org_admin.is_active)

        invite_email = mail.outbox[-1]
        self.assertIn(invite.token, invite_email.body)

        # 2. Screen A — identify.
        identify_response = self.client.post(
            reverse("auth-identify"),
            {"activation_token": invite.token, "name": "Judy Mwikali"},
        )
        self.assertEqual(identify_response.status_code, 200, identify_response.data)
        self.assertEqual(identify_response.data["masked_email"], "a****@amaniwellness.co.ke")

        # Wrong name -> generic error, no field-level disclosure.
        wrong_name_response = self.client.post(
            reverse("auth-identify"),
            {"activation_token": invite.token, "name": "Someone Else"},
        )
        self.assertEqual(wrong_name_response.status_code, 400)
        self.assertEqual(wrong_name_response.data["error"]["code"], "IDENTITY_NOT_CONFIRMED")

        # 3. Screen B — confirm email, dispatches OTP.
        confirm_response = self.client.post(
            reverse("auth-confirm-email"),
            {"activation_token": invite.token, "email": "admin@amaniwellness.co.ke"},
        )
        self.assertEqual(confirm_response.status_code, 200, confirm_response.data)
        otp_token = confirm_response.data["otp_token"]
        code = _extract_code(mail.outbox[-1].body)

        # 4. Screen C — verify OTP (wrong code first, to prove attempts are tracked).
        bad_otp_response = self.client.post(
            reverse("auth-verify-otp"), {"otp_token": otp_token, "otp": "000000"}
        )
        self.assertEqual(bad_otp_response.status_code, 400)
        otp_row = OneTimePassword.objects.get(token=otp_token)
        self.assertEqual(otp_row.failed_attempts, 1)

        verify_response = self.client.post(
            reverse("auth-verify-otp"), {"otp_token": otp_token, "otp": code}
        )
        self.assertEqual(verify_response.status_code, 200, verify_response.data)
        password_setup_token = verify_response.data["password_setup_token"]

        with platform_admin_context():
            org_admin.refresh_from_db()
        self.assertIsNotNone(org_admin.email_verified_at)

        # 5. Screen D — set password. Deliberately does NOT auto-login (§5.2 Screen E).
        set_password_response = self.client.post(
            reverse("auth-set-password"),
            {"password_setup_token": password_setup_token, "password": "Judy!StrongPass77"},
        )
        self.assertEqual(set_password_response.status_code, 200, set_password_response.data)

        with platform_admin_context():
            org_admin.refresh_from_db()
        self.assertTrue(org_admin.is_active)
        self.assertTrue(org_admin.check_password("Judy!StrongPass77"))

        with platform_admin_context():
            invite.refresh_from_db()
        self.assertIsNotNone(invite.used_at)

        # A used activation token can't be replayed.
        replay_response = self.client.post(
            reverse("auth-confirm-email"),
            {"activation_token": invite.token, "email": "admin@amaniwellness.co.ke"},
        )
        self.assertEqual(replay_response.status_code, 400)

        # 6. Returning-user login (§5.3), with 2FA since mfa_enabled defaults True.
        login_response = self.client.post(
            reverse("auth-login"),
            {"email": "admin@amaniwellness.co.ke", "password": "Judy!StrongPass77"},
        )
        self.assertEqual(login_response.status_code, 200, login_response.data)
        self.assertTrue(login_response.data["requires_otp"])
        login_code = _extract_code(mail.outbox[-1].body)

        login_otp_response = self.client.post(
            reverse("auth-login-verify-otp"),
            {"otp_token": login_response.data["otp_token"], "otp": login_code},
        )
        self.assertEqual(login_otp_response.status_code, 200, login_otp_response.data)
        self.assertIn("access", login_otp_response.data)
        self.assertIn("refresh_token", login_otp_response.cookies)

        # 7. The org admin's JWT correctly scopes them to their own org — they
        # cannot reach the Super-Admin-only organizations endpoint.
        org_admin_access = login_otp_response.data["access"]
        forbidden_response = self.client.get(
            reverse("platform-organizations"), HTTP_AUTHORIZATION=f"Bearer {org_admin_access}"
        )
        self.assertEqual(forbidden_response.status_code, 403)

        # 8. Refresh + logout.
        refresh_cookie = login_otp_response.cookies["refresh_token"].value
        self.client.cookies["refresh_token"] = refresh_cookie
        refresh_response = self.client.post(reverse("auth-refresh"))
        self.assertEqual(refresh_response.status_code, 200, refresh_response.data)

        logout_response = self.client.post(
            reverse("auth-logout"), HTTP_AUTHORIZATION=f"Bearer {org_admin_access}"
        )
        self.assertEqual(logout_response.status_code, 205)

        # 9. Every step of this shows up in the immutable audit log. Organization's
        # own entry has organization_id=None (it's the tenant, not tenant-scoped —
        # see apps.sysadmin_audit.models.AuditLogEntry docstring), so it's found by
        # object_id instead; the org-scoped objects created for it (its Org Admin
        # User, the ActivationInvite) do carry organization_id=org.id.
        with platform_admin_context():
            self.assertTrue(
                AuditLogEntry.objects.filter(
                    action=AuditLogEntry.ACTION_CREATE,
                    model="tenancy.organization",
                    object_id=str(org.id),
                ).exists()
            )
            actions = list(
                AuditLogEntry.objects.filter(organization_id=org.id).values_list("action", "model")
            )
        self.assertIn((AuditLogEntry.ACTION_CREATE, "accounts.user"), actions)
        self.assertIn((AuditLogEntry.ACTION_CREATE, "accounts.activationinvite"), actions)
        with platform_admin_context():
            login_actions = list(
                AuditLogEntry.objects.filter(actor_user_id=org_admin.id).values_list(
                    "action", flat=True
                )
            )
        self.assertIn(AuditLogEntry.ACTION_LOGIN, login_actions)
        self.assertIn(AuditLogEntry.ACTION_LOGOUT, login_actions)


class LoginSecurityTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            org = Organization.objects.create(name="Org", slug="org-x", facility_type="CLINIC")
            self.user = User.objects.create_user(
                email="jane@org-x.test",
                password="Correct!Horse99",
                organization=org,
                is_active=True,
                mfa_enabled=False,
            )

    def test_wrong_password_is_generic_and_audited(self):
        response = self.client.post(
            reverse("auth-login"), {"email": "jane@org-x.test", "password": "wrong-password"}
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["error"]["code"], "INVALID_CREDENTIALS")
        with platform_admin_context():
            self.assertTrue(
                AuditLogEntry.objects.filter(
                    actor_user_id=self.user.id, action=AuditLogEntry.ACTION_LOGIN_FAILED
                ).exists()
            )

    def test_account_locks_after_five_failed_attempts(self):
        for _ in range(5):
            self.client.post(
                reverse("auth-login"), {"email": "jane@org-x.test", "password": "wrong-password"}
            )
        response = self.client.post(
            reverse("auth-login"), {"email": "jane@org-x.test", "password": "Correct!Horse99"}
        )
        self.assertEqual(response.status_code, 423)
        self.assertEqual(response.data["error"]["code"], "ACCOUNT_LOCKED")

    def test_no_mfa_login_issues_tokens_directly(self):
        response = self.client.post(
            reverse("auth-login"), {"email": "jane@org-x.test", "password": "Correct!Horse99"}
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("access", response.data)
        self.assertNotIn("requires_otp", response.data)


class ForgotPasswordEnumerationTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            org = Organization.objects.create(name="Org", slug="org-y", facility_type="CLINIC")
            User.objects.create_user(
                email="known@org-y.test", password="Whatever123!", organization=org, is_active=True
            )

    def test_known_and_unknown_email_get_same_shaped_response(self):
        known = self.client.post(reverse("auth-forgot-password"), {"email": "known@org-y.test"})
        unknown = self.client.post(reverse("auth-forgot-password"), {"email": "nobody@org-y.test"})
        self.assertEqual(known.status_code, 200)
        self.assertEqual(unknown.status_code, 200)
        self.assertEqual(set(known.data.keys()), set(unknown.data.keys()))

        # The unknown one never resolves to anything real.
        bad_verify = self.client.post(
            reverse("auth-verify-otp"), {"otp_token": unknown.data["otp_token"], "otp": "123456"}
        )
        self.assertEqual(bad_verify.status_code, 400)
