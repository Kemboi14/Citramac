from django.core import mail
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .models import ActivationInvite, OneTimePassword, Permission, Role, User
from .tokens import issue_tokens


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


class TenantDiscoveryTests(APITestCase):
    """docs/14-TENANT-BRANDED-LOGIN-UX.md — email-domain-based tenant discovery."""

    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            Organization.objects.create(
                name="CAfRIC Centre",
                slug="cafric",
                facility_type="MENTAL_HEALTH_CCP",
                email_domains=["cafric.org"],
                logo_url="https://example.org/cafric-logo.png",
                tagline="Training, Treatment & Transition Centre",
                primary_color="#006e51",
                support_email="support@cafric.org",
            )

    def test_known_domain_returns_tenant_branding(self):
        response = self.client.post(
            reverse("auth-tenant-discovery"), {"email": "someone@cafric.org"}
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["tenant"]["name"], "CAfRIC Centre")
        self.assertEqual(response.data["tenant"]["primary_color"], "#006e51")
        # Never echoes anything about whether "someone" is a real user.
        self.assertNotIn("email", response.data["tenant"])
        self.assertNotIn("user", response.data)

    def test_unknown_domain_returns_generic_not_found(self):
        response = self.client.post(
            reverse("auth-tenant-discovery"), {"email": "someone@unknown-domain.test"}
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["error"]["code"], "TENANT_NOT_FOUND")

    def test_domain_match_is_case_insensitive(self):
        response = self.client.post(
            reverse("auth-tenant-discovery"), {"email": "someone@CAFRIC.ORG"}
        )
        self.assertEqual(response.status_code, 200, response.data)


class LoginMfaChannelTests(APITestCase):
    """docs/14-TENANT-BRANDED-LOGIN-UX.md — SMS/email 2FA channel selection."""

    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            org = Organization.objects.create(name="Org", slug="org-z", facility_type="CLINIC")
            self.user_email_only = User.objects.create_user(
                email="email-only@org-z.test",
                password="Correct!Horse99",
                organization=org,
                is_active=True,
                mfa_enabled=True,
            )
            self.user_with_phone = User.objects.create_user(
                email="has-phone@org-z.test",
                password="Correct!Horse99",
                organization=org,
                is_active=True,
                mfa_enabled=True,
                phone="+254712345678",
                preferred_mfa_channel=User.MFA_CHANNEL_SMS,
            )

    def test_login_response_lists_only_available_channels(self):
        response = self.client.post(
            reverse("auth-login"),
            {"email": "email-only@org-z.test", "password": "Correct!Horse99"},
        )
        self.assertEqual(response.status_code, 200, response.data)
        channels = {c["channel"] for c in response.data["delivery_methods"]}
        self.assertEqual(channels, {"EMAIL"})
        self.assertEqual(response.data["channel"], "EMAIL")

    def test_user_with_phone_gets_sms_and_email_options_and_masked_contact(self):
        response = self.client.post(
            reverse("auth-login"),
            {"email": "has-phone@org-z.test", "password": "Correct!Horse99"},
        )
        self.assertEqual(response.status_code, 200, response.data)
        by_channel = {c["channel"]: c["masked_contact"] for c in response.data["delivery_methods"]}
        self.assertEqual(set(by_channel), {"EMAIL", "SMS"})
        self.assertTrue(by_channel["SMS"].endswith("5678"))
        self.assertNotIn("712345", by_channel["SMS"])
        self.assertEqual(response.data["channel"], "SMS")

    def test_resend_can_switch_channel(self):
        login = self.client.post(
            reverse("auth-login"),
            {"email": "has-phone@org-z.test", "password": "Correct!Horse99"},
        )
        response = self.client.post(
            reverse("auth-resend-otp"),
            {"otp_token": login.data["otp_token"], "channel": "EMAIL"},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["channel"], "EMAIL")


class RememberMeCookieTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            org = Organization.objects.create(name="Org", slug="org-r", facility_type="CLINIC")
            User.objects.create_user(
                email="jane@org-r.test",
                password="Correct!Horse99",
                organization=org,
                is_active=True,
                mfa_enabled=False,
            )

    def test_remember_true_persists_refresh_cookie(self):
        response = self.client.post(
            reverse("auth-login"),
            {"email": "jane@org-r.test", "password": "Correct!Horse99", "remember": True},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertGreater(response.cookies["refresh_token"]["max-age"], 0)

    def test_remember_false_is_a_session_cookie(self):
        response = self.client.post(
            reverse("auth-login"),
            {"email": "jane@org-r.test", "password": "Correct!Horse99", "remember": False},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.cookies["refresh_token"]["max-age"], "")


class RolesAndStaffConsoleApiTests(APITestCase):
    """
    citramac_ORG-admin.html "Roles & Permissions" + "Staff / CCP Team",
    citramac_SUPER-ADMIN.html "Global Roles & Permissions" + "Platform
    Staff". Covers the permission-ceiling rule from
    docs/09-SECURITY-COMPLIANCE.md §9.3.
    """

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Amani Wellness", slug="amani-wellness", facility_type="MENTAL_HEALTH_CCP"
            )
            self.super_admin = User.objects.create_superuser(
                email="root@platform.test", password="Password123!"
            )
            self.org_admin_role = Role.objects.filter(
                name="Org Admin", organization__isnull=True
            ).first()
            self.org_admin = User.objects.create_user(
                email="admin@amani.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
            self.org_admin.roles.add(self.org_admin_role)
            self.psychiatrist_template = Role.objects.get(
                name="Psychiatrist", organization__isnull=True
            )
        self.super_access, _ = issue_tokens(self.super_admin)
        self.org_access, _ = issue_tokens(self.org_admin)

    def test_org_admin_sees_org_template_roles_but_not_platform_ones(self):
        response = self.client.get(
            reverse("role-list"), HTTP_AUTHORIZATION=f"Bearer {self.org_access}"
        )
        names = {row["name"] for row in response.data["results"]}
        self.assertIn("Psychiatrist", names)
        self.assertNotIn("Support Agent", names)

    def test_super_admin_sees_only_platform_roles(self):
        response = self.client.get(
            reverse("role-list"), HTTP_AUTHORIZATION=f"Bearer {self.super_access}"
        )
        names = {row["name"] for row in response.data["results"]}
        self.assertIn("Support Agent", names)
        self.assertNotIn("Psychiatrist", names)

    def test_org_admin_can_create_custom_role_within_template_ceiling(self):
        allowed_permission = self.psychiatrist_template.permissions.first()
        response = self.client.post(
            reverse("role-list"),
            {"name": "Senior Psychiatrist", "permissions": [allowed_permission.id]},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            role = Role.objects.get(name="Senior Psychiatrist")
        self.assertEqual(role.organization_id, self.org.id)
        self.assertEqual(role.scope, Role.SCOPE_ORG_TEMPLATE)

    def test_org_admin_cannot_grant_permission_outside_any_template(self):
        rogue_permission = Permission.objects.create(
            codename="platform.totally_rogue.permission", description="Platform-only"
        )
        response = self.client.post(
            reverse("role-list"),
            {"name": "Rogue Role", "permissions": [rogue_permission.id]},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("permissions", response.data)

    def test_staff_invite_creates_inactive_user_with_role_and_activation_invite(self):
        response = self.client.post(
            reverse("staff-list"),
            {
                "email": "nurse@amani.test",
                "first_name": "Ann",
                "last_name": "Mutua",
                "role": self.org_admin_role.id,
            },
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            staff = User.objects.get(email="nurse@amani.test")
            self.assertFalse(staff.is_active)
            self.assertTrue(ActivationInvite.all_objects.filter(user=staff).exists())

    def test_staff_toggle_duty(self):
        with platform_admin_context():
            staff = User.objects.create_user(
                email="onduty@amani.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
        response = self.client.post(
            reverse("staff-toggle-duty", args=[staff.id]),
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["is_on_duty"])

    def test_org_admin_cannot_see_other_orgs_staff(self):
        with platform_admin_context():
            other_org = Organization.objects.create(
                name="Other Org", slug="other-org-staff", facility_type="CLINIC"
            )
            User.objects.create_user(
                email="ghost@other-org.test",
                password="Password123!",
                organization=other_org,
                is_active=True,
            )
        response = self.client.get(
            reverse("staff-list"), HTTP_AUTHORIZATION=f"Bearer {self.org_access}"
        )
        emails = {row["email"] for row in response.data["results"]}
        self.assertNotIn("ghost@other-org.test", emails)

    def test_platform_staff_invite_is_immediately_active_with_unusable_password(self):
        role = Role.objects.filter(name="Support Agent", organization__isnull=True).first()
        response = self.client.post(
            reverse("platform-staff-list"),
            {
                "email": "support@softlink.test",
                "first_name": "Joy",
                "last_name": "Mwangi",
                "role": role.id,
            },
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.super_access}",
        )
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            staff = User.objects.get(email="support@softlink.test")
        self.assertTrue(staff.is_active)
        self.assertFalse(staff.has_usable_password())
        self.assertTrue(OneTimePassword.objects.filter(user=staff).exists())
