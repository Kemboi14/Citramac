from .context import clear_tenant_context, set_tenant_context


class TenantMiddleware:
    """
    Resolves the current Organization from the authenticated request and
    binds it to thread-local + Postgres session context for the duration
    of the request. Must run after AuthenticationMiddleware.
    See docs/04-MULTI-TENANCY.md §4.2.

    This correctly sets context for session-authenticated requests (Django
    Admin) since AuthenticationMiddleware populates request.user before this
    runs. For DRF/JWT API requests, request.user isn't resolved until deeper
    inside view dispatch (see apps.accounts.authentication.TenantAwareJWTAuthentication,
    which sets the real context for those) — but this middleware still owns
    clearing the context once the whole request (including the nested view
    call) has finished, since it wraps get_response().
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, "user", None)
        organization_id = None
        is_platform_admin = False

        if user is not None and user.is_authenticated:
            is_platform_admin = bool(user.is_superuser)
            organization_id = user.organization_id

        set_tenant_context(organization_id=organization_id, is_platform_admin=is_platform_admin)
        try:
            return self.get_response(request)
        finally:
            clear_tenant_context()
