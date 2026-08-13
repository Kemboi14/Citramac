from django.contrib import admin

from .models import AuditLogEntry


@admin.register(AuditLogEntry)
class AuditLogEntryAdmin(admin.ModelAdmin):
    """Read-only — docs/09-SECURITY-COMPLIANCE.md §9.4, the audit trail is append-only."""

    list_display = ["timestamp", "action", "model", "object_id", "actor_role", "organization_id"]
    list_filter = ["action", "model"]
    search_fields = ["object_id", "actor_user_id", "organization_id"]
    date_hierarchy = "timestamp"
    readonly_fields = [f.name for f in AuditLogEntry._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
