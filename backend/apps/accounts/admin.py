from django.contrib import admin

from .models import ActivationInvite, OneTimePassword, Permission, Role, User


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    """
    Plain ModelAdmin rather than django.contrib.auth.admin.UserAdmin — that
    base class assumes a `username` field and django.contrib.auth's
    UserCreationForm/PermissionsMixin, neither of which this model has (see
    its docstring). Staff are provisioned via the activation invite flow
    (docs/04-MULTI-TENANCY.md §4.5), not through the admin "add user" form,
    so the password field is left read-only here.
    """

    ordering = ["email"]
    list_display = ["email", "organization", "is_active", "is_staff", "is_superuser", "mfa_enabled"]
    list_filter = ["organization", "is_active", "is_staff", "mfa_enabled"]
    search_fields = ["email", "first_name", "last_name", "staff_id"]
    filter_horizontal = ["roles", "branch_access"]
    readonly_fields = ["password", "last_login", "email_verified_at", "created_at", "updated_at"]


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ["name", "organization"]
    list_filter = ["organization"]
    filter_horizontal = ["permissions"]


@admin.register(Permission)
class PermissionAdmin(admin.ModelAdmin):
    list_display = ["codename", "description"]
    search_fields = ["codename"]


@admin.register(ActivationInvite)
class ActivationInviteAdmin(admin.ModelAdmin):
    list_display = ["user", "organization", "expires_at", "used_at", "created_at"]
    list_filter = ["organization"]
    readonly_fields = ["token"]


@admin.register(OneTimePassword)
class OneTimePasswordAdmin(admin.ModelAdmin):
    """Read-only — never expose or let anyone edit a live OTP challenge from the admin."""

    list_display = ["user", "purpose", "is_used", "failed_attempts", "expires_at", "created_at"]
    list_filter = ["purpose", "is_used"]
    readonly_fields = [f.name for f in OneTimePassword._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
