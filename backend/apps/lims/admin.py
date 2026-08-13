from django.contrib import admin

from .models import LabOrder, LabResult, LabSpecimen


@admin.register(LabOrder)
class LabOrderAdmin(admin.ModelAdmin):
    list_display = ["encounter", "loinc_code", "status", "ordered_at"]
    list_filter = ["status", "organization"]


@admin.register(LabSpecimen)
class LabSpecimenAdmin(admin.ModelAdmin):
    list_display = ["barcode", "lab_order", "specimen_type", "collected_at"]
    search_fields = ["barcode"]


@admin.register(LabResult)
class LabResultAdmin(admin.ModelAdmin):
    list_display = ["lab_order", "result_value", "is_abnormal", "is_validated"]
    list_filter = ["is_validated", "is_abnormal"]
