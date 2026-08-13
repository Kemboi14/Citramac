from rest_framework_simplejwt.tokens import RefreshToken


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
    """
    refresh = RefreshToken.for_user(user)
    refresh["organization_id"] = str(user.organization_id) if user.organization_id else None
    refresh["branch_ids"] = [str(bid) for bid in user.branch_access.values_list("id", flat=True)]
    refresh["role"] = _primary_role_name(user)
    refresh["email"] = user.email
    refresh["first_name"] = user.first_name
    refresh["last_name"] = user.last_name
    return str(refresh.access_token), str(refresh)
