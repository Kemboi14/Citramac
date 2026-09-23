from datetime import timedelta

from django.core import mail
from django.core.cache import cache
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.security.models import SecurityPolicy
from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import clear_tenant_context, platform_admin_context
from apps.tenancy.models import Organization

from .models import (
    ActivationInvite,
    OneTimePassword,
    PasswordSetupToken,
    Permission,
    Role,
    User,
)
from .tokens import issue_tokens


def _extract_code(email_body):
    # "Your verification code is 123456. It expires in ..."
    return email_body.split("code is ")[1].split(".")[0]


def _make_test_png():
    """A real, tiny, valid PNG — Pillow's ImageField validation rejects
    hand-rolled byte strings that aren't genuinely decodable images."""
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (2, 2), color="green").save(buffer, format="PNG")
    return buffer.getvalue()


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
                "facility_type": "MENTAL_HEALTH_MHP",
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

    def test_platform_staff_invite_full_activation_and_login_flow(self):
        """
        Same walkthrough as test_full_flow_org_creation_through_login, for a
        platform-staff invite (organization=None) — the one that would catch
        a real-RLS regression from migrations/0009_alter_activationinvite_organization.py
        making ActivationInvite.organization nullable, since it runs the
        whole identify -> confirm-email -> verify-otp -> set-password ->
        login sequence against the real Postgres RLS policy, not a mock.
        """
        access = self._login_super_admin()

        with platform_admin_context():
            role = Role.objects.filter(name="Support Agent", organization__isnull=True).first()

        create_response = self.client.post(
            reverse("platform-staff-list"),
            {
                "email": "platform.hire@softlink.test",
                "first_name": "Amina",
                "last_name": "Yusuf",
                "role": role.id,
            },
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )
        self.assertEqual(create_response.status_code, 201, create_response.data)

        with platform_admin_context():
            staff = User.objects.get(email="platform.hire@softlink.test")
            invite = ActivationInvite.objects.get(user=staff, organization__isnull=True)
        self.assertIsNone(staff.organization_id)
        self.assertFalse(staff.is_active)

        invite_email = mail.outbox[-1]
        self.assertEqual(invite_email.subject, "Welcome to CITRAMAC")
        self.assertIn(invite.token, invite_email.body)

        # Screen A — identify.
        identify_response = self.client.post(
            reverse("auth-identify"),
            {"activation_token": invite.token, "name": "Amina Yusuf"},
        )
        self.assertEqual(identify_response.status_code, 200, identify_response.data)

        # Screen B — confirm email, dispatches OTP.
        confirm_response = self.client.post(
            reverse("auth-confirm-email"),
            {"activation_token": invite.token, "email": "platform.hire@softlink.test"},
        )
        self.assertEqual(confirm_response.status_code, 200, confirm_response.data)
        otp_token = confirm_response.data["otp_token"]
        code = _extract_code(mail.outbox[-1].body)

        # Screen C — verify OTP.
        verify_response = self.client.post(
            reverse("auth-verify-otp"), {"otp_token": otp_token, "otp": code}
        )
        self.assertEqual(verify_response.status_code, 200, verify_response.data)
        password_setup_token = verify_response.data["password_setup_token"]

        # Screen D — set password.
        set_password_response = self.client.post(
            reverse("auth-set-password"),
            {"password_setup_token": password_setup_token, "password": "Amina!StrongPass77"},
        )
        self.assertEqual(set_password_response.status_code, 200, set_password_response.data)

        with platform_admin_context():
            staff.refresh_from_db()
            invite.refresh_from_db()
        self.assertTrue(staff.is_active)
        self.assertTrue(staff.check_password("Amina!StrongPass77"))
        self.assertIsNotNone(invite.used_at)

        # Returning-user login, with 2FA since mfa_enabled defaults True.
        login_response = self.client.post(
            reverse("auth-login"),
            {"email": "platform.hire@softlink.test", "password": "Amina!StrongPass77"},
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

    def test_lockout_threshold_and_duration_follow_security_policy(self):
        """
        LoginView must read SecurityPolicy.max_failed_login_attempts/
        lockout_duration_minutes rather than hardcoded values — the Security
        Policies screen previously had zero effect on actual login lockout.
        """
        with platform_admin_context():
            policy = SecurityPolicy.get_solo()
            policy.max_failed_login_attempts = 2
            policy.lockout_duration_minutes = 1
            policy.save()

        for _ in range(2):
            self.client.post(
                reverse("auth-login"), {"email": "jane@org-x.test", "password": "wrong-password"}
            )
        locked_response = self.client.post(
            reverse("auth-login"), {"email": "jane@org-x.test", "password": "Correct!Horse99"}
        )
        self.assertEqual(locked_response.status_code, 423)
        self.assertLessEqual(cache.ttl("login-lockout:jane@org-x.test"), 60)


class TimeBoundAccessTests(APITestCase):
    """
    User.access_starts_at/access_ends_at (a locum/fixed-term account) — both
    the reactive checks (LoginView, TenantAwareJWTAuthentication) and the
    proactive Celery Beat task (apps.accounts.tasks.enforce_access_windows).
    """

    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org-timebound", facility_type="CLINIC"
            )

    def _make_user(self, **kwargs):
        with platform_admin_context():
            return User.objects.create_user(
                email=kwargs.pop("email", "locum@org-timebound.test"),
                password="Correct!Horse99",
                organization=self.org,
                is_active=True,
                mfa_enabled=False,
                **kwargs,
            )

    def test_login_blocked_before_access_window_starts(self):
        self._make_user(access_starts_at=timezone.now() + timedelta(days=1))
        response = self.client.post(
            reverse("auth-login"),
            {"email": "locum@org-timebound.test", "password": "Correct!Horse99"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "ACCESS_WINDOW_CLOSED")

    def test_login_blocked_after_access_window_ends(self):
        self._make_user(access_ends_at=timezone.now() - timedelta(minutes=1))
        response = self.client.post(
            reverse("auth-login"),
            {"email": "locum@org-timebound.test", "password": "Correct!Horse99"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "ACCESS_WINDOW_CLOSED")

    def test_login_allowed_within_access_window(self):
        self._make_user(
            access_starts_at=timezone.now() - timedelta(days=1),
            access_ends_at=timezone.now() + timedelta(days=1),
        )
        response = self.client.post(
            reverse("auth-login"),
            {"email": "locum@org-timebound.test", "password": "Correct!Horse99"},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("access", response.data)

    def test_already_issued_token_is_rejected_once_window_closes(self):
        """
        The reactive check must run on every authenticated request, not just
        at /login — an access token issued while the window was still open
        must stop working the moment it closes, without waiting for the
        token to expire on its own.
        """
        user = self._make_user(access_ends_at=timezone.now() + timedelta(hours=1))
        access, _ = issue_tokens(user)

        ok_response = self.client.get(
            reverse("me-enabled-modules"), HTTP_AUTHORIZATION=f"Bearer {access}"
        )
        self.assertEqual(ok_response.status_code, 200)

        with platform_admin_context():
            user.access_ends_at = timezone.now() - timedelta(minutes=1)
            user.save(update_fields=["access_ends_at"])

        blocked_response = self.client.get(
            reverse("me-enabled-modules"), HTTP_AUTHORIZATION=f"Bearer {access}"
        )
        self.assertEqual(blocked_response.status_code, 401)

    def test_enforce_access_windows_task_deactivates_expired_users(self):
        from .tasks import enforce_access_windows

        expired = self._make_user(
            email="expired@org-timebound.test", access_ends_at=timezone.now() - timedelta(minutes=1)
        )
        still_valid = self._make_user(
            email="still-valid@org-timebound.test",
            access_ends_at=timezone.now() + timedelta(days=1),
        )
        unrestricted = self._make_user(email="unrestricted@org-timebound.test")

        deactivated_count = enforce_access_windows()

        self.assertEqual(deactivated_count, 1)
        with platform_admin_context():
            expired.refresh_from_db()
            still_valid.refresh_from_db()
            unrestricted.refresh_from_db()
        self.assertFalse(expired.is_active)
        self.assertTrue(still_valid.is_active)
        self.assertTrue(unrestricted.is_active)


class DeactivatedUserLoginTests(APITestCase):
    """
    A deactivated (is_active=False) user gets a distinct, explicit
    ACCOUNT_DEACTIVATED/"Access denied" message — but only once they've
    proven they hold the real password; a wrong guess against the same
    account stays exactly as generic as a wrong guess against any other
    email (INVALID_CREDENTIALS), so an attacker without the real password
    still learns nothing about whether the account exists.
    """

    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            org = Organization.objects.create(
                name="Org", slug="org-deactivated-user", facility_type="CLINIC"
            )
            self.user = User.objects.create_user(
                email="deactivated@org-deactivated-user.test",
                password="Correct!Horse99",
                organization=org,
                is_active=False,
                mfa_enabled=False,
            )

    def test_correct_password_for_deactivated_user_shows_access_denied(self):
        response = self.client.post(
            reverse("auth-login"),
            {"email": "deactivated@org-deactivated-user.test", "password": "Correct!Horse99"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "ACCOUNT_DEACTIVATED")
        self.assertIn("Access denied", response.data["error"]["message"])

    def test_wrong_password_for_deactivated_user_stays_generic(self):
        response = self.client.post(
            reverse("auth-login"),
            {"email": "deactivated@org-deactivated-user.test", "password": "wrong-password"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["error"]["code"], "INVALID_CREDENTIALS")

    def test_never_activated_invite_stays_generic_regardless_of_password(self):
        """A never-activated user has an unusable password hash (set_password(None)
        in UserManager._create_user) — check_password() can never succeed for it, so
        this can never reach the ACCOUNT_DEACTIVATED branch and leak "this is a
        pending invite" to a guesser."""
        with platform_admin_context():
            User.objects.create_user(
                email="never-activated@org-deactivated-user.test",
                organization=self.user.organization,
                is_active=False,
            )
        response = self.client.post(
            reverse("auth-login"),
            {"email": "never-activated@org-deactivated-user.test", "password": "anything-at-all"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["error"]["code"], "INVALID_CREDENTIALS")


class DeactivationLoginTests(APITestCase):
    """
    LoginView must refuse a *correct* password the moment the account's
    Organization/Branch/Department is deactivated — mirroring
    TimeBoundAccessTests' access-window checks, for the three entities
    LoginView.post checks in sequence right after password verification.
    """

    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org-deactivation", facility_type="CLINIC", status=Organization.STATUS_ACTIVE
            )

    def _make_user(self, **kwargs):
        with platform_admin_context():
            return User.objects.create_user(
                email=kwargs.pop("email", "staff@org-deactivation.test"),
                password="Correct!Horse99",
                organization=self.org,
                is_active=True,
                mfa_enabled=kwargs.pop("mfa_enabled", False),
                **kwargs,
            )

    def test_login_blocked_when_organization_suspended(self):
        self._make_user()
        with platform_admin_context():
            self.org.status = Organization.STATUS_SUSPENDED
            self.org.save(update_fields=["status"])

        response = self.client.post(
            reverse("auth-login"),
            {"email": "staff@org-deactivation.test", "password": "Correct!Horse99"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "ORGANIZATION_SUSPENDED")

    def test_login_allowed_when_organization_only_pending_verification(self):
        """PENDING_VERIFICATION also sets is_active=False on Organization —
        must not be treated the same as SUSPENDED (a brand-new org's own Org
        Admin needs to be able to log in)."""
        self._make_user()
        with platform_admin_context():
            self.org.status = Organization.STATUS_PENDING
            self.org.save(update_fields=["status"])

        response = self.client.post(
            reverse("auth-login"),
            {"email": "staff@org-deactivation.test", "password": "Correct!Horse99"},
        )
        self.assertEqual(response.status_code, 200, response.data)

    def test_login_blocked_when_branch_inactive(self):
        from apps.tenancy.models import Branch

        with platform_admin_context():
            branch = Branch.objects.create(
                organization=self.org, name="Main Branch", facility_level="L4", is_active=False
            )
        self._make_user(primary_branch=branch)

        response = self.client.post(
            reverse("auth-login"),
            {"email": "staff@org-deactivation.test", "password": "Correct!Horse99"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "BRANCH_INACTIVE")

    def test_login_blocked_when_department_inactive(self):
        from apps.tenancy.models import Department

        with platform_admin_context():
            department = Department.objects.create(
                organization=self.org, name="Pharmacy", is_active=False
            )
        self._make_user(department=department)

        response = self.client.post(
            reverse("auth-login"),
            {"email": "staff@org-deactivation.test", "password": "Correct!Horse99"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "DEPARTMENT_INACTIVE")

    def test_login_unaffected_by_active_branch_and_department(self):
        from apps.tenancy.models import Branch, Department

        with platform_admin_context():
            branch = Branch.objects.create(
                organization=self.org, name="Main Branch", facility_level="L4"
            )
            department = Department.objects.create(organization=self.org, name="Pharmacy")
        self._make_user(primary_branch=branch, department=department)

        response = self.client.post(
            reverse("auth-login"),
            {"email": "staff@org-deactivation.test", "password": "Correct!Horse99"},
        )
        self.assertEqual(response.status_code, 200, response.data)

    def test_otp_verify_blocked_when_branch_deactivated_between_password_and_otp(self):
        """Closes the same race window the organization-suspended check
        already closes: the OTP's own 10-minute TTL outlives the branch
        deactivation."""
        from apps.tenancy.models import Branch

        with platform_admin_context():
            branch = Branch.objects.create(
                organization=self.org, name="Main Branch", facility_level="L4"
            )
        user = self._make_user(primary_branch=branch, mfa_enabled=True)

        login_response = self.client.post(
            reverse("auth-login"),
            {"email": "staff@org-deactivation.test", "password": "Correct!Horse99"},
        )
        self.assertEqual(login_response.status_code, 200, login_response.data)
        self.assertTrue(login_response.data["requires_otp"])
        code = _extract_code(mail.outbox[-1].body)

        with platform_admin_context():
            branch.is_active = False
            branch.save(update_fields=["is_active"])

        otp_response = self.client.post(
            reverse("auth-login-verify-otp"),
            {"otp_token": login_response.data["otp_token"], "otp": code},
        )
        self.assertEqual(otp_response.status_code, 400)
        self.assertNotIn("access", otp_response.data)


class MidSessionDeactivationTests(APITestCase):
    """
    TenantAwareJWTAuthentication must reject an *already-issued* access
    token the moment the account/org/branch/department it belongs to is
    deactivated — not just refuse a fresh login attempt — closing the same
    "keeps working until the token happens to expire" gap
    TimeBoundAccessTests.test_already_issued_token_is_rejected_once_window_closes
    covers for access windows. `me-enabled-modules` is used purely as a
    lightweight already-authenticated endpoint.
    """

    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org-midsession", facility_type="CLINIC", status=Organization.STATUS_ACTIVE
            )
            self.user = User.objects.create_user(
                email="staff@org-midsession.test",
                password="Correct!Horse99",
                organization=self.org,
                is_active=True,
                mfa_enabled=False,
            )
        self.access, _ = issue_tokens(self.user)

    def _get(self):
        return self.client.get(
            reverse("me-enabled-modules"), HTTP_AUTHORIZATION=f"Bearer {self.access}"
        )

    def test_token_rejected_once_organization_suspended(self):
        self.assertEqual(self._get().status_code, 200)
        with platform_admin_context():
            self.org.status = Organization.STATUS_SUSPENDED
            self.org.save(update_fields=["status"])
        response = self._get()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["error"]["code"], "ORGANIZATION_SUSPENDED")

    def test_token_rejected_once_branch_deactivated(self):
        from apps.tenancy.models import Branch

        with platform_admin_context():
            branch = Branch.objects.create(
                organization=self.org, name="Main Branch", facility_level="L4"
            )
            self.user.primary_branch = branch
            self.user.save(update_fields=["primary_branch"])

        self.assertEqual(self._get().status_code, 200)
        with platform_admin_context():
            branch.is_active = False
            branch.save(update_fields=["is_active"])
        response = self._get()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["error"]["code"], "BRANCH_INACTIVE")

    def test_token_rejected_once_department_deactivated(self):
        from apps.tenancy.models import Department

        with platform_admin_context():
            department = Department.objects.create(organization=self.org, name="Pharmacy")
            self.user.department = department
            self.user.save(update_fields=["department"])

        self.assertEqual(self._get().status_code, 200)
        with platform_admin_context():
            department.is_active = False
            department.save(update_fields=["is_active"])
        response = self._get()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["error"]["code"], "DEPARTMENT_INACTIVE")

    def test_token_rejected_once_user_deactivated(self):
        self.assertEqual(self._get().status_code, 200)
        with platform_admin_context():
            self.user.is_active = False
            self.user.save(update_fields=["is_active"])
        response = self._get()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["error"]["code"], "USER_INACTIVE")
        self.assertIn("deactivated", response.data["error"]["message"])


class NoOrganizationLoginTests(APITestCase):
    """
    TenantDiscoveryStep sends `no_organization: true` whenever discovery
    resolved a platform-staff email (`{"tenant": null}`) — LoginView must
    only honor that for a genuine organization=None account, not let it
    bypass the normal tenant-scoped login for anyone
    (docs/14-TENANT-BRANDED-LOGIN-UX.md).
    """

    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            org = Organization.objects.create(name="Org", slug="org-z", facility_type="CLINIC")
            self.org_user = User.objects.create_user(
                email="org-person@org-z.test",
                password="Correct!Horse99",
                organization=org,
                is_active=True,
                mfa_enabled=False,
            )
            self.platform_user = User.objects.create_user(
                email="staff@platform.test",
                password="Correct!Horse99",
                organization=None,
                is_active=True,
                mfa_enabled=False,
            )

    def test_no_organization_flag_rejected_for_org_scoped_account(self):
        response = self.client.post(
            reverse("auth-login"),
            {
                "email": "org-person@org-z.test",
                "password": "Correct!Horse99",
                "no_organization": True,
            },
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "ORGANIZATION_REQUIRED")

    def test_no_organization_flag_succeeds_for_platform_staff_account(self):
        response = self.client.post(
            reverse("auth-login"),
            {
                "email": "staff@platform.test",
                "password": "Correct!Horse99",
                "no_organization": True,
            },
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("access", response.data)

    def test_normal_login_without_flag_is_unaffected_for_org_scoped_account(self):
        response = self.client.post(
            reverse("auth-login"),
            {"email": "org-person@org-z.test", "password": "Correct!Horse99"},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("access", response.data)

    def test_wrong_password_with_no_organization_flag_still_generic(self):
        """No enumeration: a bad password + the flag looks identical to a normal bad password."""
        response = self.client.post(
            reverse("auth-login"),
            {"email": "org-person@org-z.test", "password": "wrong", "no_organization": True},
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["error"]["code"], "INVALID_CREDENTIALS")


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
                facility_type="MENTAL_HEALTH_MHP",
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

    def test_discovery_rate_limit_follows_security_policy(self):
        """
        Previously a hardcoded 20/10min literal — must read
        SecurityPolicy.tenant_discovery_max_attempts, the same pattern
        LoginView already uses for max_failed_login_attempts.
        """
        with platform_admin_context():
            policy = SecurityPolicy.get_solo()
            policy.tenant_discovery_max_attempts = 2
            policy.save()

        for _ in range(2):
            self.client.post(
                reverse("auth-tenant-discovery"), {"email": "someone@unknown-domain.test"}
            )
        limited_response = self.client.post(
            reverse("auth-tenant-discovery"), {"email": "someone@unknown-domain.test"}
        )
        self.assertEqual(limited_response.status_code, 429)
        self.assertEqual(limited_response.data["error"]["code"], "RATE_LIMITED")

    def test_domain_match_is_case_insensitive(self):
        response = self.client.post(
            reverse("auth-tenant-discovery"), {"email": "someone@CAFRIC.ORG"}
        )
        self.assertEqual(response.status_code, 200, response.data)

    def test_platform_staff_email_is_not_matched_to_an_org_by_domain_coincidence(self):
        """
        A Platform Super Admin's email is organization_id=None by
        definition, but nothing stops their domain from also appearing in
        some org's email_domains (e.g. that domain was used to invite a
        pilot org's staff at some point). Discovery must not show that
        org's branding to the platform-staff account itself — it gets a
        real (200, tenant: null) match instead, which TenantLoginStep.tsx
        renders as generic platform branding, not TENANT_NOT_FOUND.
        """
        with platform_admin_context():
            Organization.objects.create(
                name="Shared Domain Org",
                slug="shared-domain-org",
                facility_type="CLINIC",
                email_domains=["platform-staff-domain.test"],
            )
            User.objects.create_superuser(
                email="root@platform-staff-domain.test", password="Password123!"
            )
        response = self.client.post(
            reverse("auth-tenant-discovery"), {"email": "root@platform-staff-domain.test"}
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.data["tenant"])

    def test_org_staff_email_resolves_to_their_own_org_not_a_domain_coincidence(self):
        """
        Two organizations can end up with overlapping email_domains entries
        (e.g. a stale/incorrect claim) — a real staff member's exact email
        must resolve to their actual employer, not whichever org happens to
        sort first among the domain matches.
        """
        with platform_admin_context():
            wrong_org = Organization.objects.create(
                name="Wrong Org",
                slug="wrong-org-domain",
                facility_type="CLINIC",
                email_domains=["multi-tenant-domain.test"],
            )
            right_org = Organization.objects.create(
                name="Right Org",
                slug="right-org-domain",
                facility_type="CLINIC",
                email_domains=["multi-tenant-domain.test"],
            )
            User.objects.create_user(
                email="staff@multi-tenant-domain.test",
                password="Password123!",
                organization=right_org,
                is_active=True,
            )
        response = self.client.post(
            reverse("auth-tenant-discovery"), {"email": "staff@multi-tenant-domain.test"}
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["tenant"]["name"], "Right Org")
        self.assertNotEqual(response.data["tenant"]["name"], wrong_org.name)


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
    citramac_ORG-admin.html "Roles & Permissions" + "Staff / MHP Team",
    citramac_SUPER-ADMIN.html "Global Roles & Permissions" + "Platform
    Staff". Covers the permission-ceiling rule from
    docs/09-SECURITY-COMPLIANCE.md §9.3.
    """

    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Amani Wellness", slug="amani-wellness", facility_type="MENTAL_HEALTH_MHP"
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

    def test_super_admin_sees_all_roles(self):
        response = self.client.get(
            reverse("role-list"), HTTP_AUTHORIZATION=f"Bearer {self.super_access}"
        )
        names = {row["name"] for row in response.data["results"]}
        self.assertIn("Support Agent", names)
        self.assertIn("Psychiatrist", names)

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
            self.org.refresh_from_db()
        self.assertIn("amani.test", self.org.email_domains)

    def test_super_admin_can_create_staff_in_a_chosen_organization(self):
        response = self.client.post(
            reverse("staff-list"),
            {
                "email": "doctor@amani.test",
                "first_name": "Kevin",
                "last_name": "Otieno",
                "role": self.psychiatrist_template.id,
                "organization": self.org.id,
            },
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.super_access}",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["organization"], self.org.id)
        with platform_admin_context():
            staff = User.objects.get(email="doctor@amani.test")
            self.assertEqual(staff.organization_id, self.org.id)
            self.assertFalse(staff.is_active)
            self.assertTrue(ActivationInvite.all_objects.filter(user=staff).exists())
            self.org.refresh_from_db()
        self.assertIn("amani.test", self.org.email_domains)

    def test_super_admin_staff_create_requires_an_organization(self):
        response = self.client.post(
            reverse("staff-list"),
            {
                "email": "orphan@amani.test",
                "first_name": "No",
                "last_name": "Org",
                "role": self.psychiatrist_template.id,
            },
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.super_access}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("organization", response.data)

    def test_org_admin_cannot_plant_staff_in_a_different_organization(self):
        with platform_admin_context():
            other_org = Organization.objects.create(
                name="Other Org", slug="other-org-plant", facility_type="CLINIC"
            )
        response = self.client.post(
            reverse("staff-list"),
            {
                "email": "sneaky@amani.test",
                "first_name": "Sneaky",
                "last_name": "Staff",
                "role": self.org_admin_role.id,
                "organization": other_org.id,
            },
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            staff = User.objects.get(email="sneaky@amani.test")
            self.assertEqual(staff.organization_id, self.org.id)

    def test_super_admin_sees_all_org_staff_and_org_admin_sees_only_their_own(self):
        with platform_admin_context():
            User.objects.create_user(
                email="roster-check@amani.test", organization=self.org, is_active=True
            )
        response = self.client.get(
            reverse("staff-list"), HTTP_AUTHORIZATION=f"Bearer {self.super_access}"
        )
        self.assertEqual(response.status_code, 200, response.data)
        emails = {row["email"] for row in response.data["results"]}
        self.assertIn("roster-check@amani.test", emails)

    def test_super_admin_can_resend_invite_for_org_staff(self):
        create_response = self.client.post(
            reverse("staff-list"),
            {
                "email": "resend-target@amani.test",
                "first_name": "Resend",
                "last_name": "Target",
                "role": self.psychiatrist_template.id,
                "organization": self.org.id,
            },
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.super_access}",
        )
        staff_id = create_response.data["id"]
        response = self.client.post(
            reverse("staff-resend-invite", args=[staff_id]),
            HTTP_AUTHORIZATION=f"Bearer {self.super_access}",
        )
        self.assertEqual(response.status_code, 200, response.data)

    def test_super_admin_can_scope_roles_to_a_chosen_organization(self):
        response = self.client.get(
            f"{reverse('role-list')}?organization={self.org.id}",
            HTTP_AUTHORIZATION=f"Bearer {self.super_access}",
        )
        names = {row["name"] for row in response.data["results"]}
        self.assertIn("Psychiatrist", names)

    def test_resend_invite_self_heals_a_staff_row_with_no_activation_invite(self):
        with platform_admin_context():
            staff = User.objects.create_user(
                email="noinvite@amani.test",
                organization=self.org,
                is_active=False,
            )
        self.assertEqual(ActivationInvite.all_objects.filter(user=staff).count(), 0)
        response = self.client.post(
            reverse("staff-resend-invite", args=[staff.id]),
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 200, response.data)
        with platform_admin_context():
            self.assertEqual(ActivationInvite.all_objects.filter(user=staff).count(), 1)
        invite_email = mail.outbox[-1]
        self.assertEqual(invite_email.to, ["noinvite@amani.test"])

    def test_resend_invite_reuses_a_still_valid_invite(self):
        response = self.client.post(
            reverse("staff-list"),
            {
                "email": "pending@amani.test",
                "first_name": "Grace",
                "last_name": "Njeri",
                "role": self.org_admin_role.id,
            },
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 201, response.data)
        staff_id = response.data["id"]
        with platform_admin_context():
            original_token = ActivationInvite.all_objects.get(user_id=staff_id).token

        resend_response = self.client.post(
            reverse("staff-resend-invite", args=[staff_id]),
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(resend_response.status_code, 200, resend_response.data)
        with platform_admin_context():
            self.assertEqual(ActivationInvite.all_objects.filter(user_id=staff_id).count(), 1)
            self.assertEqual(
                ActivationInvite.all_objects.get(user_id=staff_id).token, original_token
            )
        self.assertIn(original_token, mail.outbox[-1].body)

    def test_resend_invite_rejects_an_already_active_staff_member(self):
        with platform_admin_context():
            staff = User.objects.create_user(
                email="active@amani.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
        response = self.client.post(
            reverse("staff-resend-invite", args=[staff.id]),
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 400)

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

    def test_staff_invite_can_set_branch_department_and_access_window(self):
        from apps.tenancy.models import Branch, Department

        with platform_admin_context():
            branch = Branch.objects.create(
                organization=self.org, name="Main Branch", facility_level="L4"
            )
            department = Department.objects.create(organization=self.org, name="Pharmacy")
        starts = timezone.now() + timedelta(days=1)
        ends = timezone.now() + timedelta(days=30)
        response = self.client.post(
            reverse("staff-list"),
            {
                "email": "locum@amani.test",
                "first_name": "Locum",
                "last_name": "Doc",
                "role": self.psychiatrist_template.id,
                "primary_branch": branch.id,
                "department": department.id,
                "access_starts_at": starts.isoformat(),
                "access_ends_at": ends.isoformat(),
            },
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 201, response.data)
        with platform_admin_context():
            staff = User.objects.get(email="locum@amani.test")
            self.assertEqual(staff.primary_branch_id, branch.id)
            self.assertEqual(staff.department_id, department.id)
            self.assertIsNotNone(staff.access_starts_at)
            self.assertIsNotNone(staff.access_ends_at)

    def test_staff_invite_rejects_a_department_from_another_org(self):
        from apps.tenancy.models import Department

        with platform_admin_context():
            other_org = Organization.objects.create(
                name="Other Org", slug="other-org-dept", facility_type="CLINIC"
            )
            other_department = Department.objects.create(organization=other_org, name="Records")
        response = self.client.post(
            reverse("staff-list"),
            {
                "email": "crossorg@amani.test",
                "first_name": "Cross",
                "last_name": "Org",
                "role": self.psychiatrist_template.id,
                "department": other_department.id,
            },
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("department", response.data)

    def test_cannot_patch_staff_into_a_department_from_another_org(self):
        from apps.tenancy.models import Department

        with platform_admin_context():
            other_org = Organization.objects.create(
                name="Other Org 2", slug="other-org-dept-2", facility_type="CLINIC"
            )
            other_department = Department.objects.create(organization=other_org, name="Records")
            staff = User.objects.create_user(
                email="editme@amani.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
        response = self.client.patch(
            reverse("staff-detail", args=[staff.id]),
            {"department": other_department.id},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("department", response.data)

    def test_staff_invite_rejects_an_inactive_branch(self):
        from apps.tenancy.models import Branch

        with platform_admin_context():
            branch = Branch.objects.create(
                organization=self.org, name="Closed Branch", facility_level="L4", is_active=False
            )
        response = self.client.post(
            reverse("staff-list"),
            {
                "email": "toinactivebranch@amani.test",
                "first_name": "Ina",
                "last_name": "Ctive",
                "role": self.psychiatrist_template.id,
                "primary_branch": branch.id,
            },
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("primary_branch", response.data)

    def test_staff_invite_rejects_an_inactive_department(self):
        from apps.tenancy.models import Department

        with platform_admin_context():
            department = Department.objects.create(
                organization=self.org, name="Closed Dept", is_active=False
            )
        response = self.client.post(
            reverse("staff-list"),
            {
                "email": "toinactivedept@amani.test",
                "first_name": "Ina",
                "last_name": "Ctive",
                "role": self.psychiatrist_template.id,
                "department": department.id,
            },
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("department", response.data)

    def test_staff_invite_rejects_a_suspended_organization(self):
        """
        Uses the Super Admin token, not the org's own admin: once `self.org`
        is SUSPENDED, `self.org_access` itself is rejected at the
        authentication layer (TenantAwareJWTAuthentication — see
        MidSessionDeactivationTests), a stronger, earlier block than this
        view-level check. A Super Admin acting on behalf of a suspended org
        from the platform console is the actual scenario this check guards.
        """
        with platform_admin_context():
            self.org.status = Organization.STATUS_SUSPENDED
            self.org.save(update_fields=["status"])
        response = self.client.post(
            reverse("staff-list"),
            {
                "organization": str(self.org.id),
                "email": "intosuspended@amani.test",
                "first_name": "Sus",
                "last_name": "Pended",
                "role": self.psychiatrist_template.id,
            },
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.super_access}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("organization", response.data)

    def test_cannot_patch_staff_into_an_inactive_branch(self):
        from apps.tenancy.models import Branch

        with platform_admin_context():
            branch = Branch.objects.create(
                organization=self.org, name="Closed Branch 2", facility_level="L4", is_active=False
            )
            staff = User.objects.create_user(
                email="patchtoinactive@amani.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
        response = self.client.patch(
            reverse("staff-detail", args=[staff.id]),
            {"primary_branch": branch.id},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("primary_branch", response.data)

    def test_cannot_patch_staff_branch_access_to_include_an_inactive_branch(self):
        from apps.tenancy.models import Branch

        with platform_admin_context():
            branch = Branch.objects.create(
                organization=self.org, name="Closed Branch 3", facility_level="L4", is_active=False
            )
            staff = User.objects.create_user(
                email="patchbranchaccess@amani.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
        response = self.client.patch(
            reverse("staff-detail", args=[staff.id]),
            {"branch_access": [branch.id]},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("branch_access", response.data)

    def test_reset_credentials_emails_otp_to_active_staff(self):
        with platform_admin_context():
            staff = User.objects.create_user(
                email="resetme@amani.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
        response = self.client.post(
            reverse("staff-reset-credentials", args=[staff.id]),
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 200, response.data)
        with platform_admin_context():
            self.assertTrue(
                OneTimePassword.objects.filter(
                    user=staff, purpose=OneTimePassword.PURPOSE_RESET
                ).exists()
            )
        reset_email = mail.outbox[-1]
        self.assertIn(staff.email, reset_email.to)

    def test_reset_credentials_rejects_a_never_activated_staff_member(self):
        with platform_admin_context():
            staff = User.objects.create_user(
                email="notyetactive@amani.test", organization=self.org, is_active=False
            )
        response = self.client.post(
            reverse("staff-reset-credentials", args=[staff.id]),
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 400)

    def test_cannot_reactivate_staff_whose_access_window_has_expired(self):
        with platform_admin_context():
            staff = User.objects.create_user(
                email="expired@amani.test",
                password="Password123!",
                organization=self.org,
                is_active=False,
                access_ends_at=timezone.now() - timedelta(days=1),
            )
        response = self.client.patch(
            reverse("staff-detail", args=[staff.id]),
            {"is_active": True},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("is_active", response.data)

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

    def test_platform_staff_invite_creates_inactive_user_with_activation_invite_and_welcome_email(
        self,
    ):
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
            invite = ActivationInvite.objects.get(user=staff, organization__isnull=True)
        self.assertFalse(staff.is_active)

        invite_email = mail.outbox[-1]
        self.assertEqual(invite_email.subject, "Welcome to CITRAMAC")
        self.assertIn(invite.token, invite_email.body)

    def test_super_admin_can_resend_invite_for_platform_staff(self):
        role = Role.objects.filter(name="Support Agent", organization__isnull=True).first()
        create_response = self.client.post(
            reverse("platform-staff-list"),
            {
                "email": "resend-target@softlink.test",
                "first_name": "Resend",
                "last_name": "Target",
                "role": role.id,
            },
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.super_access}",
        )
        staff_id = create_response.data["id"]
        response = self.client.post(
            reverse("platform-staff-resend-invite", args=[staff_id]),
            HTTP_AUTHORIZATION=f"Bearer {self.super_access}",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(mail.outbox[-1].subject, "Welcome to CITRAMAC")

    def test_super_admin_can_retrieve_and_update_a_platform_staff_member(self):
        """
        Regression: get_queryset() returned a plain list, so DRF's default
        get_object() (get_object_or_404 on something with no .get()) 404'd
        on every retrieve/update/destroy regardless of whether the row
        existed — only the list action ever worked.
        """
        with platform_admin_context():
            staff = User.objects.create_user(
                email="retrieve-me@softlink.test",
                password="Password123!",
                organization=None,
                is_staff=True,
                is_active=True,
            )
        get_response = self.client.get(
            reverse("platform-staff-detail", args=[staff.id]),
            HTTP_AUTHORIZATION=f"Bearer {self.super_access}",
        )
        self.assertEqual(get_response.status_code, 200, get_response.data)

        patch_response = self.client.patch(
            reverse("platform-staff-detail", args=[staff.id]),
            {"first_name": "Updated"},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {self.super_access}",
        )
        self.assertEqual(patch_response.status_code, 200, patch_response.data)
        self.assertEqual(patch_response.data["first_name"], "Updated")

    def test_org_admin_can_unlock_their_own_staff(self):
        with platform_admin_context():
            staff = User.objects.create_user(
                email="locked@amani.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
        cache.set("login-lockout:locked@amani.test", 5, timeout=900)
        response = self.client.post(
            reverse("staff-unlock", args=[staff.id]),
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(cache.get("login-lockout:locked@amani.test"))

    def test_org_admin_cannot_unlock_another_orgs_staff(self):
        with platform_admin_context():
            other_org = Organization.objects.create(
                name="Other Org", slug="other-org-unlock", facility_type="CLINIC"
            )
            other_staff = User.objects.create_user(
                email="ghost-locked@other-org.test",
                password="Password123!",
                organization=other_org,
                is_active=True,
            )
        cache.set("login-lockout:ghost-locked@other-org.test", 5, timeout=900)
        response = self.client.post(
            reverse("staff-unlock", args=[other_staff.id]),
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(cache.get("login-lockout:ghost-locked@other-org.test"), 5)

    def test_super_admin_can_unlock_platform_staff(self):
        role = Role.objects.filter(name="Support Agent", organization__isnull=True).first()
        with platform_admin_context():
            platform_staff = User.objects.create_user(
                email="platform-locked@softlink.test",
                is_staff=True,
                is_active=True,
            )
            platform_staff.roles.add(role)
        cache.set("login-lockout:platform-locked@softlink.test", 5, timeout=900)
        response = self.client.post(
            reverse("platform-staff-unlock", args=[platform_staff.id]),
            HTTP_AUTHORIZATION=f"Bearer {self.super_access}",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(cache.get("login-lockout:platform-locked@softlink.test"))

    def test_staff_list_reports_is_locked(self):
        with platform_admin_context():
            staff = User.objects.create_user(
                email="badge-check@amani.test",
                password="Password123!",
                organization=self.org,
                is_active=True,
            )
        response = self.client.get(
            reverse("staff-detail", args=[staff.id]),
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["is_locked"])

        cache.set("login-lockout:badge-check@amani.test", 5, timeout=900)
        response = self.client.get(
            reverse("staff-detail", args=[staff.id]),
            HTTP_AUTHORIZATION=f"Bearer {self.org_access}",
        )
        self.assertTrue(response.data["is_locked"])


class MyProfileTests(APITestCase):
    """
    `/me/profile/` — self-service profile + avatar upload for every
    authenticated user, any role, any portal. Part of
    /home/nick/.claude/plans/drifting-baking-falcon.md's "every user must be
    able to add their profile picture" follow-up.
    """

    def setUp(self):
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Org", slug="org", facility_type="MENTAL_HEALTH_MHP"
            )
            self.user = User.objects.create_user(
                email="clinician@org.test",
                password="Password123!",
                organization=self.org,
                first_name="Faith",
                last_name="Mwangi",
                is_active=True,
            )
        self.access, _ = issue_tokens(self.user)

    def _auth(self):
        return {"HTTP_AUTHORIZATION": f"Bearer {self.access}"}

    def test_get_my_profile_returns_own_data_only(self):
        response = self.client.get(reverse("me-profile"), **self._auth())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["email"], "clinician@org.test")
        self.assertEqual(response.data["first_name"], "Faith")
        self.assertIsNone(response.data["avatar"])

    def test_patch_my_profile_updates_name_and_phone_but_not_email(self):
        response = self.client.patch(
            reverse("me-profile"),
            {"first_name": "Faith N.", "phone": "0712345678", "email": "hijacked@evil.test"},
            format="json",
            **self._auth(),
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["first_name"], "Faith N.")
        self.assertEqual(response.data["phone"], "0712345678")
        self.assertEqual(response.data["email"], "clinician@org.test")

    def test_upload_avatar_returns_absolute_url(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        tiny_png = _make_test_png()
        response = self.client.patch(
            reverse("me-profile"),
            {"avatar": SimpleUploadedFile("me.png", tiny_png, content_type="image/png")},
            format="multipart",
            **self._auth(),
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["avatar"].startswith("http"))
        self.assertIn("avatars/users/", response.data["avatar"])

    def test_avatar_over_size_limit_is_rejected(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings

        tiny_png = _make_test_png()
        with override_settings(AVATAR_MAX_SIZE_BYTES=10):
            response = self.client.patch(
                reverse("me-profile"),
                {"avatar": SimpleUploadedFile("big.png", tiny_png, content_type="image/png")},
                format="multipart",
                **self._auth(),
            )
        self.assertEqual(response.status_code, 400)
        self.assertIn("avatar", response.data)

    def test_cannot_set_roles_or_organization_via_my_profile(self):
        """MyProfileSerializer deliberately excludes governance fields."""
        response = self.client.patch(
            reverse("me-profile"),
            {"is_active": False, "roles": []},
            format="json",
            **self._auth(),
        )
        self.assertEqual(response.status_code, 200)
        with platform_admin_context():
            self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)


class SecurityPolicyEnforcementTests(APITestCase):
    """
    apps.security.SecurityPolicy audit (2026-09-22): rate limiting, password
    policy, and token-lifetime fields were previously stored but never read
    anywhere. These lock in that each is now actually enforced.
    """

    def setUp(self):
        cache.clear()
        self.addCleanup(clear_tenant_context)
        with platform_admin_context():
            self.org = Organization.objects.create(
                name="Enforcement Org", slug="enforcement-org", facility_type="CLINIC"
            )
            self.user = User.objects.create_user(
                email="staff@enforcement-org.test",
                password="Correct!Horse99",
                organization=self.org,
                is_active=True,
                mfa_enabled=False,
            )
        policy = SecurityPolicy.get_solo()
        policy.rate_limit_per_minute = 120
        policy.save()

    def _issue_setup_token(self):
        return PasswordSetupToken.issue(self.user, PasswordSetupToken.PURPOSE_RESET).token

    def test_previously_unprotected_endpoint_now_rate_limited(self):
        policy = SecurityPolicy.get_solo()
        policy.rate_limit_per_minute = 2
        policy.save()
        for _ in range(2):
            self.client.post(reverse("auth-verify-otp"), {"otp_token": "x" * 20, "otp": "000000"})
        response = self.client.post(
            reverse("auth-verify-otp"), {"otp_token": "x" * 20, "otp": "000000"}
        )
        self.assertEqual(response.status_code, 429, response.data)
        self.assertEqual(response.data["error"]["code"], "RATE_LIMITED")

    def test_set_password_rejects_password_below_policy_minimum_length(self):
        with platform_admin_context():
            setup_token = self._issue_setup_token()
        response = self.client.post(
            reverse("auth-set-password"),
            {"password_setup_token": setup_token, "password": "Ab1!"},
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(response.data["error"]["code"], "INVALID_PASSWORD")

    def test_set_password_rejects_reused_password_from_history(self):
        with platform_admin_context():
            setup_token = self._issue_setup_token()
        first = self.client.post(
            reverse("auth-set-password"),
            {"password_setup_token": setup_token, "password": "First!ChoicePass99"},
        )
        self.assertEqual(first.status_code, 200, first.data)

        with platform_admin_context():
            setup_token_2 = self._issue_setup_token()
        reused = self.client.post(
            reverse("auth-set-password"),
            {"password_setup_token": setup_token_2, "password": "First!ChoicePass99"},
        )
        self.assertEqual(reused.status_code, 400, reused.data)
        self.assertEqual(reused.data["error"]["code"], "INVALID_PASSWORD")

    def test_login_rejected_once_password_has_expired(self):
        policy = SecurityPolicy.get_solo()
        policy.password_expiry_days = 90
        policy.save()
        with platform_admin_context():
            self.user.password_changed_at = timezone.now() - timedelta(days=91)
            self.user.save(update_fields=["password_changed_at"])
        response = self.client.post(
            reverse("auth-login"),
            {"email": "staff@enforcement-org.test", "password": "Correct!Horse99"},
        )
        self.assertEqual(response.status_code, 403, response.data)
        self.assertEqual(response.data["error"]["code"], "PASSWORD_EXPIRED")

    def test_issued_access_token_lifetime_matches_policy(self):
        policy = SecurityPolicy.get_solo()
        policy.token_expiry_minutes = 5
        policy.save()
        access, _ = issue_tokens(self.user)
        from rest_framework_simplejwt.tokens import AccessToken

        token = AccessToken(access)
        self.assertEqual(token["exp"] - token["iat"], 5 * 60)

    def test_nth_plus_one_login_evicts_oldest_session(self):
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
        from rest_framework_simplejwt.tokens import RefreshToken

        policy = SecurityPolicy.get_solo()
        policy.max_concurrent_sessions = 2
        policy.save()

        _, first_refresh = issue_tokens(self.user)
        # Read before the 2nd/3rd logins evict it — reconstructing a
        # RefreshToken re-verifies it, including the blacklist check, which
        # would raise TokenError once it's (correctly) blacklisted below.
        first_jti = RefreshToken(first_refresh)["jti"]
        issue_tokens(self.user)
        issue_tokens(self.user)

        blacklisted_jtis = set(
            OutstandingToken.objects.filter(
                id__in=BlacklistedToken.objects.values_list("token_id", flat=True),
                user=self.user,
            ).values_list("jti", flat=True)
        )
        self.assertIn(first_jti, blacklisted_jtis)
