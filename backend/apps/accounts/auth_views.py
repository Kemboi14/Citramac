"""
The exact five-step auth flow from docs/05-AUTHENTICATION-FLOW.md — identify
→ confirm-email → OTP → set-password → redirect-to-login (activation), plus
returning-user login (with optional 2FA), refresh, logout, and forgot-password
(reusing the identify+OTP+set-password building blocks per §5.3).

A few endpoint-shape decisions that pragmatically diverge from the doc's
illustrative JSON bodies, noted where they happen:
- Every step after email-confirm is addressed by an opaque `otp_token`
  (the OneTimePassword's own token) rather than re-passing `activation_token`
  — one consistent handle for both the activation and password-reset flows,
  which don't otherwise share a natural common token.
- forgot-password never reveals whether the email matched (returns a
  same-shaped, DB-backed-or-not otp_token either way) to avoid user
  enumeration, per the "generic error, no field-level disclosure" principle
  in §5.5.
"""

from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from apps.sysadmin_audit.models import AuditLogEntry
from apps.tenancy.context import platform_admin_context

from .models import ActivationInvite, OneTimePassword, PasswordSetupToken, User
from .serializers import (
    ConfirmEmailSerializer,
    ForgotPasswordSerializer,
    IdentifySerializer,
    LoginSerializer,
    LoginVerifyOtpSerializer,
    LogoutSerializer,
    RefreshSerializer,
    ResendOtpSerializer,
    SetPasswordSerializer,
    TenantDiscoverySerializer,
    VerifyOtpSerializer,
)
from .throttling import RateLimitExceeded, enforce_cooldown, enforce_rate_limit
from .tokens import issue_tokens

REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60
GENERIC_ERROR = {
    "error": {
        "code": "IDENTITY_NOT_CONFIRMED",
        "message": "We couldn't confirm those details.",
    }
}


def _error(code, message, http_status=status.HTTP_400_BAD_REQUEST, fields=None):
    body = {"error": {"code": code, "message": message}}
    if fields:
        body["error"]["fields"] = fields
    return Response(body, status=http_status)


def _generic_error(http_status=status.HTTP_400_BAD_REQUEST):
    return Response(GENERIC_ERROR, status=http_status)


def _mask_email(email):
    local, _, domain = email.partition("@")
    if len(local) <= 1:
        masked_local = "*" * len(local)
    else:
        masked_local = local[0] + "*" * (len(local) - 1)
    return f"{masked_local}@{domain}"


def _mask_phone(phone):
    """`+254712345678` -> `+254•••••5678` — keeps only the prefix and last 4 digits."""
    digits = phone.strip()
    if len(digits) <= 4:
        return "•" * len(digits)
    prefix_len = min(4, len(digits) - 4)
    prefix, suffix = digits[:prefix_len], digits[-4:]
    return f"{prefix}{'•' * (len(digits) - prefix_len - 4)}{suffix}"


def _email_domain(email):
    return email.strip().rsplit("@", 1)[-1].casefold()


def _set_refresh_cookie(response, refresh_str, request, remember=False):
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        refresh_str,
        # remember=False -> no max_age at all, i.e. a session cookie the
        # browser drops on close. The refresh token's own validity window
        # (SIMPLE_JWT.REFRESH_TOKEN_LIFETIME) is unaffected either way —
        # this only controls whether the *browser* keeps offering it back.
        max_age=REFRESH_COOKIE_MAX_AGE if remember else None,
        httponly=True,
        secure=not request.META.get("wsgi.url_scheme") == "http",
        samesite="Lax",
    )


def _log_auth_event(user, action, request, extra_object_id=None):
    AuditLogEntry.objects.create(
        organization_id=getattr(user, "organization_id", None) if user else None,
        branch_id=getattr(user, "primary_branch_id", None) if user else None,
        actor_user_id=user.pk if user else None,
        actor_role="Super Admin" if (user and user.is_superuser) else "",
        action=action,
        model="accounts.user",
        object_id=str(user.pk) if user else (extra_object_id or ""),
        source_ip=request.META.get("REMOTE_ADDR"),
        request_id=getattr(request, "request_id", ""),
    )


TENANT_NOT_FOUND_ERROR = {
    "error": {
        "code": "TENANT_NOT_FOUND",
        "message": (
            "We couldn't continue with the information provided. "
            "Please contact your organisation administrator."
        ),
    }
}


class TenantDiscoveryView(APIView):
    """
    docs/14-TENANT-BRANDED-LOGIN-UX.md — the pre-login step that shows a
    staff member their own organization's branding before they ever type a
    password. Resolves by **email domain**, not by looking up a specific
    user, so this can never be used to confirm "does this exact person have
    an account" (the anti-enumeration principle in
    docs/05-AUTHENTICATION-FLOW.md §5.5 still holds) — the worst it discloses
    is "does any CITRAMAC tenant use this email domain", which is no more
    sensitive than knowing a company's own public domain name.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = TenantDiscoverySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        domain = _email_domain(serializer.validated_data["email"])

        try:
            enforce_rate_limit(
                f"tenant-discovery:{request.META.get('REMOTE_ADDR', 'unknown')}",
                max_attempts=20,
                window_seconds=600,
            )
        except RateLimitExceeded as exc:
            return _error(
                "RATE_LIMITED",
                "Too many attempts. Try again later.",
                status.HTTP_429_TOO_MANY_REQUESTS,
                fields={"retry_after_seconds": exc.retry_after_seconds},
            )

        from apps.tenancy.models import Organization

        with platform_admin_context():
            org = (
                Organization.objects.filter(is_active=True)
                .filter(email_domains__contains=[domain])
                .first()
            )

        if org is None:
            return Response(TENANT_NOT_FOUND_ERROR, status=status.HTTP_404_NOT_FOUND)

        return Response(
            {
                "tenant": {
                    "id": str(org.id),
                    "name": org.name,
                    "logo_url": org.logo_url,
                    "login_image_url": org.login_image_url,
                    "tagline": org.tagline,
                    "primary_color": org.primary_color,
                    "support_email": org.support_email,
                    "support_phone": org.support_phone,
                    "website": org.website,
                }
            }
        )


class IdentifyView(APIView):
    """Screen A — docs/05-AUTHENTICATION-FLOW.md §5.2."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = IdentifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with platform_admin_context():
            try:
                invite = ActivationInvite.objects.select_related("user").get(
                    token=data["activation_token"]
                )
            except ActivationInvite.DoesNotExist:
                return _generic_error()

            if not invite.is_valid():
                return _generic_error()

            submitted_name = " ".join(data["name"].split()).casefold()
            candidates = {
                " ".join(invite.user.get_full_name().split()).casefold(),
                invite.user.staff_id.casefold() if invite.user.staff_id else "",
            }
            if submitted_name not in candidates or submitted_name == "":
                return _generic_error()

            return Response({"masked_email": _mask_email(invite.user.email)})


class ConfirmEmailView(APIView):
    """Screen B — docs/05-AUTHENTICATION-FLOW.md §5.2."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ConfirmEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with platform_admin_context():
            try:
                invite = ActivationInvite.objects.select_related("user").get(
                    token=data["activation_token"]
                )
            except ActivationInvite.DoesNotExist:
                return _generic_error()

            if not invite.is_valid():
                return _generic_error()

            if data["email"].strip().casefold() != invite.user.email.casefold():
                return _generic_error()

            try:
                enforce_rate_limit(
                    f"otp-dispatch:{invite.token}", max_attempts=5, window_seconds=1800
                )
            except RateLimitExceeded as exc:
                return _error(
                    "RATE_LIMITED",
                    "Too many attempts. Try again later.",
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    fields={"retry_after_seconds": exc.retry_after_seconds},
                )

            otp, code = OneTimePassword.issue(
                invite.user, OneTimePassword.PURPOSE_ACTIVATION, activation_invite=invite
            )
            _dispatch_otp_email(invite.user, code, otp.purpose)
            return Response({"otp_token": otp.token})


class ResendOtpView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ResendOtpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        with platform_admin_context():
            try:
                old_otp = OneTimePassword.objects.select_related("user", "activation_invite").get(
                    token=serializer.validated_data["otp_token"]
                )
            except OneTimePassword.DoesNotExist:
                return _generic_error()

            try:
                enforce_cooldown(f"otp-resend-cooldown:{old_otp.token}", cooldown_seconds=60)
            except RateLimitExceeded as exc:
                return _error(
                    "RATE_LIMITED",
                    "Please wait before requesting another code.",
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    fields={"retry_after_seconds": exc.retry_after_seconds},
                )

            dispatch_key = (
                f"otp-dispatch:{old_otp.activation_invite.token}"
                if old_otp.activation_invite_id
                else f"otp-dispatch:{old_otp.purpose}:{old_otp.user_id}"
            )
            try:
                enforce_rate_limit(dispatch_key, max_attempts=5, window_seconds=1800)
            except RateLimitExceeded as exc:
                return _error(
                    "RATE_LIMITED",
                    "Too many attempts. Try again later.",
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    fields={"retry_after_seconds": exc.retry_after_seconds},
                )

            old_otp.is_used = True
            old_otp.save(update_fields=["is_used"])

            new_otp, code = OneTimePassword.issue(
                old_otp.user, old_otp.purpose, activation_invite=old_otp.activation_invite
            )
            if new_otp.purpose == OneTimePassword.PURPOSE_LOGIN_2FA:
                channel = _dispatch_login_otp(
                    old_otp.user,
                    code,
                    new_otp.purpose,
                    channel=serializer.validated_data.get("channel"),
                )
                return Response({"otp_token": new_otp.token, "channel": channel})

            _dispatch_otp_email(old_otp.user, code, new_otp.purpose)
            return Response({"otp_token": new_otp.token})


class VerifyOtpView(APIView):
    """Screen C — activation (§5.2) and password-reset (§5.3) OTP verification."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = VerifyOtpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with platform_admin_context():
            try:
                otp = OneTimePassword.objects.select_related("user", "activation_invite").get(
                    token=data["otp_token"],
                    purpose__in=[OneTimePassword.PURPOSE_ACTIVATION, OneTimePassword.PURPOSE_RESET],
                )
            except OneTimePassword.DoesNotExist:
                return _generic_error()

            if not otp.is_valid():
                return _error(
                    "OTP_EXPIRED",
                    "This code has expired or is no longer valid. Request a new one.",
                )

            if not otp.check_code(data["otp"]):
                otp.failed_attempts += 1
                otp.save(update_fields=["failed_attempts"])
                return _error("OTP_INCORRECT", "Incorrect code.")

            otp.is_used = True
            otp.save(update_fields=["is_used"])

            if otp.purpose == OneTimePassword.PURPOSE_ACTIVATION:
                otp.user.email_verified_at = timezone.now()
                otp.user.save(update_fields=["email_verified_at"])

            setup_token = PasswordSetupToken.issue(
                otp.user,
                (
                    PasswordSetupToken.PURPOSE_ACTIVATION
                    if otp.purpose == OneTimePassword.PURPOSE_ACTIVATION
                    else PasswordSetupToken.PURPOSE_RESET
                ),
            )
            return Response({"password_setup_token": setup_token.token})


class SetPasswordView(APIView):
    """Screen D — docs/05-AUTHENTICATION-FLOW.md §5.2. Never auto-logs in (§5.2 Screen E)."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = SetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with platform_admin_context():
            try:
                setup_token = PasswordSetupToken.objects.select_related("user").get(
                    token=data["password_setup_token"]
                )
            except PasswordSetupToken.DoesNotExist:
                return _generic_error()

            if not setup_token.is_valid():
                return _generic_error()

            user = setup_token.user
            user.set_password(data["password"])
            if setup_token.purpose == PasswordSetupToken.PURPOSE_ACTIVATION:
                user.is_active = True
            user.save()

            setup_token.used_at = timezone.now()
            setup_token.save(update_fields=["used_at"])

            if setup_token.purpose == PasswordSetupToken.PURPOSE_ACTIVATION:
                ActivationInvite.objects.filter(user=user, used_at__isnull=True).update(
                    used_at=timezone.now()
                )

            return Response({}, status=status.HTTP_200_OK)


class LoginView(APIView):
    """Returning-user login — docs/05-AUTHENTICATION-FLOW.md §5.3."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        email = data["email"].strip().casefold()

        lockout_key = f"login-lockout:{email}"
        from django.core.cache import cache

        if cache.get(lockout_key, 0) >= 5:
            return _error(
                "ACCOUNT_LOCKED",
                "Too many failed attempts. Try again later or contact an admin.",
                status.HTTP_423_LOCKED,
            )

        with platform_admin_context():
            user = User.all_objects.filter(email__iexact=email).first()

        password_ok = bool(user) and user.is_active and user.check_password(data["password"])
        if not password_ok:
            cache.set(lockout_key, cache.get(lockout_key, 0) + 1, timeout=900)
            _log_auth_event(user, AuditLogEntry.ACTION_LOGIN_FAILED, request, extra_object_id=email)
            return _error(
                "INVALID_CREDENTIALS", "Incorrect email or password.", status.HTTP_401_UNAUTHORIZED
            )

        cache.delete(lockout_key)

        if user.mfa_enabled:
            with platform_admin_context():
                otp, code = OneTimePassword.issue(user, OneTimePassword.PURPOSE_LOGIN_2FA)
            channel = _dispatch_login_otp(user, code, otp.purpose)
            return Response(
                {
                    "requires_otp": True,
                    "otp_token": otp.token,
                    "channel": channel,
                    "delivery_methods": _available_channels(user),
                }
            )

        access, refresh = issue_tokens(user)
        _log_auth_event(user, AuditLogEntry.ACTION_LOGIN, request)
        response = Response({"access": access})
        _set_refresh_cookie(response, refresh, request, remember=data.get("remember", False))
        return response


class LoginVerifyOtpView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginVerifyOtpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with platform_admin_context():
            try:
                otp = OneTimePassword.objects.select_related("user").get(
                    token=data["otp_token"], purpose=OneTimePassword.PURPOSE_LOGIN_2FA
                )
            except OneTimePassword.DoesNotExist:
                return _generic_error()

            if not otp.is_valid():
                return _error(
                    "OTP_EXPIRED", "This code has expired. Log in again to get a new one."
                )

            if not otp.check_code(data["otp"]):
                otp.failed_attempts += 1
                otp.save(update_fields=["failed_attempts"])
                return _error("OTP_INCORRECT", "Incorrect code.")

            otp.is_used = True
            otp.save(update_fields=["is_used"])

        access, refresh = issue_tokens(otp.user)
        _log_auth_event(otp.user, AuditLogEntry.ACTION_LOGIN, request)
        response = Response({"access": access})
        _set_refresh_cookie(response, refresh, request)
        return response


class RefreshView(APIView):
    """
    Thin wrapper around SimpleJWT's own TokenRefreshSerializer (which already
    implements rotate-and-blacklist correctly per SIMPLE_JWT settings) that
    reads the refresh token from the httpOnly cookie and writes the rotated
    one back to it, per docs/05-AUTHENTICATION-FLOW.md §5.3.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RefreshSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        refresh_str = serializer.validated_data.get("refresh") or request.COOKIES.get(
            REFRESH_COOKIE_NAME
        )
        if not refresh_str:
            return _error(
                "MISSING_REFRESH_TOKEN", "No refresh token provided.", status.HTTP_401_UNAUTHORIZED
            )

        token_serializer = TokenRefreshSerializer(data={"refresh": refresh_str})
        try:
            # TokenRefreshSerializer looks the user up by the token's user_id
            # claim internally (to check they still exist/aren't blacklisted)
            # — the same pre-auth lookup problem as everywhere else here.
            with platform_admin_context():
                token_serializer.is_valid(raise_exception=True)
        except TokenError:
            return _error(
                "INVALID_REFRESH_TOKEN",
                "Refresh token is invalid or expired.",
                status.HTTP_401_UNAUTHORIZED,
            )

        validated = token_serializer.validated_data
        response = Response({"access": validated["access"]})
        if "refresh" in validated:
            _set_refresh_cookie(response, validated["refresh"], request)
        return response


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        refresh_str = serializer.validated_data.get("refresh") or request.COOKIES.get(
            REFRESH_COOKIE_NAME
        )
        if refresh_str:
            try:
                RefreshToken(refresh_str).blacklist()
            except TokenError:
                pass

        _log_auth_event(request.user, AuditLogEntry.ACTION_LOGOUT, request)
        response = Response(status=status.HTTP_205_RESET_CONTENT)
        response.delete_cookie(REFRESH_COOKIE_NAME)
        return response


class ForgotPasswordView(APIView):
    """
    docs/05-AUTHENTICATION-FLOW.md §5.3 — reuses the OTP + set-password
    building blocks. Always responds identically whether or not the email
    matched, to avoid confirming account existence (§5.5 anti-enumeration
    principle applied to this flow specifically).
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ForgotPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().casefold()

        with platform_admin_context():
            user = User.all_objects.filter(email__iexact=email, is_active=True).first()

        if user:
            otp, code = OneTimePassword.issue(user, OneTimePassword.PURPOSE_RESET)
            _dispatch_otp_email(user, code, otp.purpose)
            otp_token = otp.token
        else:
            # Same-shaped, non-functional token — never resolves at verify-otp time.
            import secrets

            otp_token = secrets.token_urlsafe(32)

        return Response({"otp_token": otp_token})


def _dispatch_otp_email(user, code, purpose):
    from apps.notifications.tasks import send_otp_email

    send_otp_email.delay(user.email, code, purpose, organization_id=user.organization_id)


def _dispatch_otp_sms(phone, code, purpose):
    from apps.notifications.tasks import send_otp_sms

    send_otp_sms.delay(phone, code, purpose)


def _available_channels(user):
    """
    Delivery options the tenant-branded MFA screen (docs/14-TENANT-BRANDED-
    LOGIN-UX.md) can offer this user — SMS only appears if a phone number is
    actually on file.
    """
    channels = [{"channel": "EMAIL", "masked_contact": _mask_email(user.email)}]
    if user.phone:
        channels.append({"channel": "SMS", "masked_contact": _mask_phone(user.phone)})
    return channels


def _dispatch_login_otp(user, code, purpose, channel=None):
    """
    Sends a login-2FA OTP via `channel` (falls back to the user's
    preferred_mfa_channel, then EMAIL if SMS was requested/preferred but no
    phone is on file) and returns which channel actually got used.
    """
    resolved = channel or user.preferred_mfa_channel
    if resolved == User.MFA_CHANNEL_SMS and user.phone:
        _dispatch_otp_sms(user.phone, code, purpose)
        return User.MFA_CHANNEL_SMS
    _dispatch_otp_email(user, code, purpose)
    return User.MFA_CHANNEL_EMAIL
