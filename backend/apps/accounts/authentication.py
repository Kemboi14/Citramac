from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.sysadmin_audit.context import set_audit_actor
from apps.tenancy.context import platform_admin_context, set_tenant_context


class TenantAwareJWTAuthentication(JWTAuthentication):
    """
    Plain JWTAuthentication only resolves request.user — it never touches
    tenant context. DRF resolves authentication inside view dispatch, after
    classic middleware has already run, so TenantMiddleware alone can't see
    a JWT-authenticated user (see apps.tenancy.middleware.TenantMiddleware
    docstring). This subclass binds the resolved user's organization (and
    platform-admin status) as soon as the token is validated, so every query
    the view makes afterwards is correctly scoped.

    The base class's own get_user() has to look the user up by the token's
    user_id claim before we know their organization — the same
    chicken-and-egg problem the pre-auth views solve with
    platform_admin_context(), so authenticate() itself runs inside one too.
    Once the real user is resolved, we narrow the context back down to
    theirs (or keep it platform-wide only if they're actually a superuser).
    """

    def authenticate(self, request):
        with platform_admin_context():
            result = super().authenticate(request)
            if result is not None:
                user, _token = result
                # Rejects every API call on an already-issued token, not just
                # new logins — a suspended org's staff otherwise keep full
                # access until their access token happens to expire.
                # Specifically SUSPENDED, not just `not is_active` — a
                # brand-new org is also `is_active=False` while
                # PENDING_VERIFICATION, and that must NOT block its own
                # Org Admin from logging in and using the platform.
                from apps.tenancy.models import Organization

                if (
                    user.organization_id
                    and user.organization.status == Organization.STATUS_SUSPENDED
                ):
                    raise AuthenticationFailed(
                        "This account's organization is no longer active. Please contact "
                        "your administrator.",
                        code="organization_suspended",
                    )

                # Same "reject on every call, not just new logins" principle
                # as the suspended-org check above, mirrored for Branch and
                # Department (auth_views.py's LoginView applies the same
                # checks at login time; this is what closes the gap for a
                # token issued before the branch/department was deactivated).
                if user.primary_branch_id and not user.primary_branch.is_active:
                    raise AuthenticationFailed(
                        "Your branch is no longer active. Please contact your administrator.",
                        code="branch_inactive",
                    )

                if user.department_id and not user.department.is_active:
                    raise AuthenticationFailed(
                        "Your department is no longer active. Please contact your "
                        "administrator.",
                        code="department_inactive",
                    )

                # Same "reject on every call, not just new logins" principle
                # as the suspended-org check above — a time-bound (e.g.
                # locum/fixed-term) account whose window has closed loses
                # access immediately, not just at its next login.
                if not user.is_within_access_window():
                    raise AuthenticationFailed(
                        "This account's access is not currently active for this time period.",
                        code="access_window_closed",
                    )
        if result is not None:
            user, _token = result
            set_tenant_context(
                organization_id=user.organization_id,
                is_platform_admin=bool(user.is_superuser),
            )
            set_audit_actor(user)
        return result

    def get_user(self, validated_token):
        """
        Same lookup as the base class, only with a friendlier message for the
        `user_inactive` case (simplejwt's own default is a terse "User is
        inactive") — this is the path a staff member's *already-issued*
        access token hits the moment an admin deactivates their account
        mid-session, not just at their next login attempt. Matched on the
        library's own stable `code`, not the message text, so this doesn't
        depend on simplejwt's exact wording.

        simplejwt's own `AuthenticationFailed` (rest_framework_simplejwt.
        exceptions) is a different class from the one imported at the top of
        this file (rest_framework.exceptions) — it uses a DetailDictMixin
        that builds `exc.detail` as a *dict* (`{"detail": ..., "code": ...}`),
        not a plain string. `APIException.get_codes()` reflects that shape
        (returns a dict of sub-codes, not one string), so comparing it
        directly to `"user_inactive"` never matches — has to be read off the
        dict itself.
        """
        try:
            return super().get_user(validated_token)
        except AuthenticationFailed as exc:
            detail = getattr(exc, "detail", None)
            code = detail.get("code") if isinstance(detail, dict) else getattr(detail, "code", None)
            if code == "user_inactive":
                raise AuthenticationFailed(
                    "Your account has been deactivated. Please contact your administrator.",
                    code="user_inactive",
                ) from exc
            raise
