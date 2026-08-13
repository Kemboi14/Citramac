from django.contrib import admin

from .models import InsuranceClaim, PreAuthorization, Remittance


@admin.register(PreAuthorization)
class PreAuthorizationAdmin(admin.ModelAdmin):
    list_display = ["patient", "status", "submitted_at", "decided_at"]
    list_filter = ["status", "organization"]


@admin.register(InsuranceClaim)
class InsuranceClaimAdmin(admin.ModelAdmin):
    list_display = ["patient", "status", "total_claimed_amount", "submitted_at"]
    list_filter = ["status", "organization"]


@admin.register(Remittance)
class RemittanceAdmin(admin.ModelAdmin):
    list_display = ["claim", "amount_paid", "remittance_date"]
