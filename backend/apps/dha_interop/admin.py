from django.contrib import admin

from .models import (
    FhirResourceCache,
    IcdCodeIndex,
    LoincCodeIndex,
    NationalDrugIndex,
    ShaTransactionLog,
    TerminologySyncRun,
)


@admin.register(IcdCodeIndex)
class IcdCodeIndexAdmin(admin.ModelAdmin):
    list_display = ["code", "description"]
    search_fields = ["code", "description"]


@admin.register(LoincCodeIndex)
class LoincCodeIndexAdmin(admin.ModelAdmin):
    list_display = ["code", "description"]
    search_fields = ["code", "description"]


@admin.register(NationalDrugIndex)
class NationalDrugIndexAdmin(admin.ModelAdmin):
    list_display = ["code", "generic_name", "form", "strength"]
    search_fields = ["code", "generic_name"]


@admin.register(ShaTransactionLog)
class ShaTransactionLogAdmin(admin.ModelAdmin):
    list_display = ["transaction_type", "status", "organization_id", "created_at", "retry_count"]
    list_filter = ["transaction_type", "status"]
    readonly_fields = [f.name for f in ShaTransactionLog._meta.fields]

    def has_add_permission(self, request):
        return False


@admin.register(FhirResourceCache)
class FhirResourceCacheAdmin(admin.ModelAdmin):
    list_display = ["resource_type", "direction", "status", "organization_id", "created_at"]
    list_filter = ["resource_type", "direction", "status"]
    readonly_fields = [f.name for f in FhirResourceCache._meta.fields]

    def has_add_permission(self, request):
        return False


@admin.register(TerminologySyncRun)
class TerminologySyncRunAdmin(admin.ModelAdmin):
    list_display = ["source", "status", "records_synced", "started_at", "finished_at"]
    list_filter = ["source", "status"]
    readonly_fields = [f.name for f in TerminologySyncRun._meta.fields]

    def has_add_permission(self, request):
        return False
