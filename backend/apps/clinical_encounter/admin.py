from django.contrib import admin

from .models import (
    ClinicalOrder,
    DiagnosisCode,
    Encounter,
    Prescription,
    PrescriptionItem,
    ReferralPacket,
    SoapNote,
)


@admin.register(Encounter)
class EncounterAdmin(admin.ModelAdmin):
    list_display = ["patient", "encounter_type", "status", "opened_at", "closed_at"]
    list_filter = ["status", "organization"]


@admin.register(SoapNote)
class SoapNoteAdmin(admin.ModelAdmin):
    list_display = ["encounter", "author", "is_locked", "signed_at"]
    list_filter = ["is_locked"]


@admin.register(DiagnosisCode)
class DiagnosisCodeAdmin(admin.ModelAdmin):
    list_display = ["encounter", "icd11_code", "is_primary", "status", "noted_at"]
    list_filter = ["status", "is_primary"]


@admin.register(ClinicalOrder)
class ClinicalOrderAdmin(admin.ModelAdmin):
    list_display = ["encounter", "order_type", "status", "ordered_at"]
    list_filter = ["order_type", "status"]


class PrescriptionItemInline(admin.TabularInline):
    model = PrescriptionItem
    extra = 0


@admin.register(Prescription)
class PrescriptionAdmin(admin.ModelAdmin):
    list_display = ["encounter", "prescribed_by", "prescribed_at"]
    inlines = [PrescriptionItemInline]


@admin.register(ReferralPacket)
class ReferralPacketAdmin(admin.ModelAdmin):
    list_display = ["encounter", "destination_facility", "status", "sent_at"]
