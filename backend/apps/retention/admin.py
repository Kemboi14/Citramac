from django.contrib import admin

from .models import (
    ArchiveBatch,
    ArchiveBatchItem,
    OrganizationRetentionPolicy,
    RetentionPlatformSettings,
    RetentionScanRun,
)


class _ReadOnlyAdmin(admin.ModelAdmin):
    """Lifecycle state is changed only through apps.retention.services, which audits it."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(RetentionPlatformSettings)
class RetentionPlatformSettingsAdmin(_ReadOnlyAdmin):
    list_display = [
        "clinical_floor_years",
        "mental_health_floor_years",
        "financial_floor_years",
        "floor_verified",
        "verified_at",
    ]


@admin.register(OrganizationRetentionPolicy)
class OrganizationRetentionPolicyAdmin(_ReadOnlyAdmin):
    list_display = [
        "organization",
        "clinical_years",
        "mental_health_years",
        "financial_years",
        "scan_enabled",
    ]


@admin.register(ArchiveBatch)
class ArchiveBatchAdmin(_ReadOnlyAdmin):
    list_display = [
        "reference",
        "organization",
        "status",
        "item_count",
        "archived_count",
        "created_at",
    ]
    list_filter = ["status", "organization"]


@admin.register(ArchiveBatchItem)
class ArchiveBatchItemAdmin(_ReadOnlyAdmin):
    list_display = ["batch", "patient", "retention_ends_on", "outcome"]
    list_filter = ["outcome"]


@admin.register(RetentionScanRun)
class RetentionScanRunAdmin(_ReadOnlyAdmin):
    list_display = ["organization", "created_at", "outcome", "due_count", "floor_verified"]
    list_filter = ["outcome"]
