from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend

from apps.tenancy.context import platform_admin_context, set_tenant_context

UserModel = get_user_model()


class TenantAwareModelBackend(ModelBackend):
    """
    Plain ModelBackend resolves the user via `UserModel._default_manager`,
    which is `objects` — the RLS/tenant-scoped TenantScopedManager (see
    apps.tenancy.managers) — for both authenticate() (the login POST) and
    get_user() (rehydrating request.user from the session on every
    subsequent request). Neither call has a tenant context yet: nothing
    has resolved *which* user this is, so apps.tenancy.middleware.
    TenantMiddleware (which derives context from request.user) hasn't run
    yet either. The scoped manager then sees no org context and returns
    `.none()`, so admin login always fails.

    Finding the user isn't the whole problem, either: Django's session
    login() immediately does `user.save(update_fields=["last_login"])`
    (via the user_logged_in signal) in the *same* request, before
    TenantMiddleware gets another chance to run. Postgres's FORCE ROW
    LEVEL SECURITY on accounts_user rejects that UPDATE once
    platform_admin_context()'s `with` block has already reverted the
    session GUCs, silently affecting 0 rows — which Django's
    update_fields save path treats as a hard DatabaseError. So
    authenticate() has to leave real tenant context set behind it once
    the user is known, not just bypass scoping for its own lookup.

    Same chicken-and-egg problem apps.accounts.authentication.
    TenantAwareJWTAuthentication already solves for the API (down to the
    same "narrow lookup, then set lasting context" shape) — this is the
    session-auth equivalent, used by Django admin.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        if username is None:
            username = kwargs.get(UserModel.USERNAME_FIELD)
        if username is None or password is None:
            return None
        with platform_admin_context():
            try:
                user = UserModel.all_objects.get(email__iexact=username)
            except UserModel.DoesNotExist:
                UserModel().set_password(password)
                return None
        if user.check_password(password) and self.user_can_authenticate(user):
            set_tenant_context(
                organization_id=user.organization_id,
                is_platform_admin=bool(user.is_superuser),
            )
            return user
        return None

    def get_user(self, user_id):
        with platform_admin_context():
            try:
                user = UserModel.all_objects.get(pk=user_id)
            except UserModel.DoesNotExist:
                return None
        return user if self.user_can_authenticate(user) else None
