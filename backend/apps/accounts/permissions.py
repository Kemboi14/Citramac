from rest_framework.permissions import BasePermission


class IsPlatformSuperAdmin(BasePermission):
    """Super Admin operates above all tenants — docs/04-MULTI-TENANCY.md §4.1."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_superuser)
