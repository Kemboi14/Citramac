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
            set_tenant_context(
                organization_id=user.organization_id,
                is_platform_admin=bool(user.is_superuser),
            )
            set_audit_actor(user)
        return result
