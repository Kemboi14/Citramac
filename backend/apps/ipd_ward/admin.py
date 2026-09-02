from django.contrib import admin

from .models import Admission, Bed, MedicationAdministration, NursingNote, Ward


@admin.register(Ward)
class WardAdmin(admin.ModelAdmin):
    list_display = ["name", "ward_type", "branch"]


@admin.register(Bed)
class BedAdmin(admin.ModelAdmin):
    list_display = ["ward", "bed_number", "status"]
    list_filter = ["status", "ward"]


@admin.register(Admission)
class AdmissionAdmin(admin.ModelAdmin):
    list_display = [
        "patient",
        "bed",
        "admission_type",
        "status",
        "observation_level",
        "admitted_at",
        "discharged_at",
    ]
    list_filter = ["status", "admission_type", "priority"]


@admin.register(MedicationAdministration)
class MedicationAdministrationAdmin(admin.ModelAdmin):
    list_display = ["admission", "scheduled_time", "status", "administered_at"]
    list_filter = ["status"]


@admin.register(NursingNote)
class NursingNoteAdmin(admin.ModelAdmin):
    list_display = ["admission", "shift", "author", "recorded_at"]
    list_filter = ["shift"]
