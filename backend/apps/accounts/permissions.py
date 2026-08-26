from rest_framework.permissions import SAFE_METHODS, BasePermission


class IsPlatformSuperAdmin(BasePermission):
    """Super Admin operates above all tenants — docs/04-MULTI-TENANCY.md §4.1."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_superuser)


def _has_org_admin_role(user):
    return (
        user.is_authenticated
        and not user.is_superuser
        and user.roles.filter(name__iexact="Org Admin").exists()
    )


class IsOrgAdmin(BasePermission):
    """Org Admin operates within exactly one Organization — docs/04-MULTI-TENANCY.md §4.1."""

    def has_permission(self, request, view):
        return bool(request.user and _has_org_admin_role(request.user))


class IsPlatformSuperAdminOrOrgAdmin(BasePermission):
    """
    Read/write access shared by both admin tiers, scoped by tenant: Super
    Admin sees/edits every organization's rows (enforced by TenantScopedManager
    auto-widening for superusers, see apps.accounts.authentication); Org Admin
    is confined to their own organization's rows, checked per-object here
    since `get_queryset()` scoping alone doesn't protect PATCH/DELETE-by-id.
    """

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_superuser:
            return True
        if not _has_org_admin_role(user):
            return False
        # Org Admin may read/update within their org, but not create/delete
        # rows that belong to platform-level administration (e.g. new
        # Branches — that's a Super-Admin-only action per docs/04 §4.1).
        if request.method == "POST" and getattr(view, "org_admin_can_create", False) is False:
            return False
        return True

    def has_object_permission(self, request, view, obj):
        user = request.user
        if user.is_superuser:
            return True
        organization_id = getattr(obj, "organization_id", None) or getattr(obj, "id", None)
        if request.method in SAFE_METHODS:
            return organization_id == user.organization_id
        return organization_id == user.organization_id
