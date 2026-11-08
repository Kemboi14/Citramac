from django.contrib import admin

from .models import SyncableRecord, SyncConflictLog


class ReadOnlyArchiveAdmin(admin.ModelAdmin):
    """offline_sync is an archive since the v3 screens were retired (2026-11-06)."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(SyncableRecord)
class SyncableRecordAdmin(ReadOnlyArchiveAdmin):
    list_display = ["entity_type", "client_id", "server_entity_id", "version", "organization"]
    list_filter = ["entity_type"]
    search_fields = ["client_id"]


@admin.register(SyncConflictLog)
class SyncConflictLogAdmin(ReadOnlyArchiveAdmin):
    """Records officer/Org Admin manual-resolution queue — docs/08-DHA-SHA-INTEGRATION.md §8.5."""

    list_display = ["entity_type", "client_id", "server_version", "resolved", "created_at"]
    list_filter = ["entity_type", "resolved"]
