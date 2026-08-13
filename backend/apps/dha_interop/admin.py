from django.contrib import admin

from .models import IcdCodeIndex, LoincCodeIndex, NationalDrugIndex, ShaTransactionLog


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
