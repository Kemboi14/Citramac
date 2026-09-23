from datetime import timedelta

from rest_framework_simplejwt.tokens import RefreshToken

from apps.tenancy.context import platform_admin_context


def _primary_role_name(user):
    if user.is_superuser:
        return "SUPER_ADMIN"
    role = user.roles.values_list("name", flat=True).first()
    return role or ""


def issue_tokens(user):
    """
    Embeds organization_id, branch_ids[], and role in the JWT claims so
    TenantMiddleware-equivalent scoping can happen without an extra DB hop —
    docs/05-AUTHENTICATION-FLOW.md §5.5. Setting claims on the refresh token
    before accessing .access_token means SimpleJWT copies them onto the
    access token too (its default no_copy_claims only excludes a handful of
    reserved claims like jti/exp).

    Also carries the user's own name/email — non-sensitive (it's their own
    data), and lets the shell chrome (Phase 2, docs/03-DESIGN-SYSTEM.md §3.3
    sidebar-foot) render a name/avatar without a separate /me round-trip.

    Token lifetimes are overridden per SecurityPolicy (session_timeout_minutes/
    token_expiry_minutes) rather than the static SIMPLE_JWT settings — read
    live at issuance, same pattern as throttling.enforce_general_rate_limit
    and LoginView's lockout checks. This is a new login (called from
    LoginView's direct path and LoginVerifyOtpView only, never from
    RefreshView's rotation, which continues an existing session rather than
    starting one), so it's also the point where SecurityPolicy.max_concurrent_
    sessions gets enforced — see _enforce_concurrent_session_cap below.
    """
    from apps.security.models import SecurityPolicy

    policy = SecurityPolicy.get_solo()

    refresh = RefreshToken.for_user(user)
    refresh.set_exp(lifetime=timedelta(minutes=policy.session_timeout_minutes))
    refresh["organization_id"] = str(user.organization_id) if user.organization_id else None
    # branch_access (tenancy_branch) and roles (accounts_role) are both
    # RLS-protected. issue_tokens() is called from LoginView/
    # LoginVerifyOtpView *after* their own platform_admin_context() block
    # has already closed — this is a pre-authentication moment with no
    # tenant context of its own, so without this wrapper these queries
    # silently return nothing (empty branch_ids every time; role only
    # "works" by coincidence when the assigned Role happens to be a
    # NULL-organization platform template, per accounts_role's RLS policy —
    # see apps/accounts/migrations/0002_rls.py's own comment on why that
    # table's policy has an extra clause Branch's doesn't).
    with platform_admin_context():
        refresh["branch_ids"] = [str(bid) for bid in user.branch_access.values_list("id", flat=True)]
        refresh["role"] = _primary_role_name(user)
    refresh["email"] = user.email
    refresh["first_name"] = user.first_name
    refresh["last_name"] = user.last_name

    access = refresh.access_token
    access.set_exp(lifetime=timedelta(minutes=policy.token_expiry_minutes))

    _enforce_concurrent_session_cap(user, policy.max_concurrent_sessions)

    return str(access), str(refresh)


def _enforce_concurrent_session_cap(user, max_concurrent_sessions):
    """
    Blacklists the oldest outstanding refresh tokens beyond the cap, reusing
    simplejwt's own token_blacklist app (rest_framework_simplejwt.
    token_blacklist, already installed) instead of a new table.
    RefreshToken.for_user() above already recorded an OutstandingToken row
    for the session just issued (and for every prior login) — the same
    mechanism that already makes LogoutView's RefreshToken(...).blacklist()
    call work. A blacklisted refresh token can't be used to get a new access
    token once the current one expires; this doesn't revoke an already-issued
    access token instantly, the same tolerance LogoutView already has today.
    """
    if max_concurrent_sessions <= 0:
        return

    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    outstanding = (
        OutstandingToken.objects.filter(user=user)
        .exclude(id__in=BlacklistedToken.objects.values_list("token_id", flat=True))
        .order_by("-created_at")
    )
    for token in outstanding[max_concurrent_sessions:]:
        BlacklistedToken.objects.get_or_create(token=token)
