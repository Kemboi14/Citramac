from django.contrib import admin

from .models import SyncableRecord, SyncConflictLog


@admin.register(SyncableRecord)
class SyncableRecordAdmin(admin.ModelAdmin):
    list_display = ["entity_type", "client_id", "server_entity_id", "version", "organization"]
    list_filter = ["entity_type"]
    search_fields = ["client_id"]


@admin.register(SyncConflictLog)
class SyncConflictLogAdmin(admin.ModelAdmin):
    """Records officer/Org Admin manual-resolution queue — docs/08-DHA-SHA-INTEGRATION.md §8.5."""

    list_display = ["entity_type", "client_id", "server_version", "resolved", "created_at"]
    list_filter = ["entity_type", "resolved"]
