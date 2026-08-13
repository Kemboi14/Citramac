from django.contrib import admin

from .models import MentalStatusExam, VitalSigns


@admin.register(VitalSigns)
class VitalSignsAdmin(admin.ModelAdmin):
    list_display = ["encounter", "bmi", "esi_acuity_level", "recorded_at"]
    readonly_fields = ["bmi", "bsa"]


@admin.register(MentalStatusExam)
class MentalStatusExamAdmin(admin.ModelAdmin):
    list_display = ["encounter", "risk_escalated_to_supervisor", "recorded_at"]
    list_filter = ["risk_escalated_to_supervisor"]
