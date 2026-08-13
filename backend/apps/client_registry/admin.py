from django.contrib import admin

from .models import (
    AllergyRecord,
    Appointment,
    Attachment,
    ConsentRecord,
    EmergencyContact,
    ErasureRequest,
    InsuranceCoverage,
    Patient,
)


class EmergencyContactInline(admin.TabularInline):
    model = EmergencyContact
    extra = 0
    fk_name = "patient"


class AllergyRecordInline(admin.TabularInline):
    model = AllergyRecord
    extra = 0


class InsuranceCoverageInline(admin.TabularInline):
    model = InsuranceCoverage
    extra = 0


@admin.register(Patient)
class PatientAdmin(admin.ModelAdmin):
    list_display = [
        "get_full_name",
        "uhid_number",
        "citramac_number",
        "gender",
        "date_of_birth",
        "allergy_status",
        "patient_category",
        "organization",
    ]
    search_fields = ["first_name", "last_name", "uhid_number", "citramac_number", "national_id"]
    list_filter = ["organization", "gender", "allergy_status", "patient_category"]
    inlines = [EmergencyContactInline, AllergyRecordInline, InsuranceCoverageInline]
    readonly_fields = ["citramac_number", "registered_at", "registered_by"]


@admin.register(Appointment)
class AppointmentAdmin(admin.ModelAdmin):
    list_display = ["patient", "scheduled_for", "appointment_type", "status", "provider"]
    list_filter = ["status", "organization"]


@admin.register(Attachment)
class AttachmentAdmin(admin.ModelAdmin):
    list_display = ["patient", "classification", "uploaded_by", "uploaded_at"]
    list_filter = ["classification", "organization"]


@admin.register(ConsentRecord)
class ConsentRecordAdmin(admin.ModelAdmin):
    list_display = ["patient", "consent_type", "granted", "consent_text_version", "captured_at"]
    list_filter = ["consent_type", "granted"]
    readonly_fields = [f.name for f in ConsentRecord._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(ErasureRequest)
class ErasureRequestAdmin(admin.ModelAdmin):
    list_display = [
        "patient",
        "status",
        "requested_by",
        "org_admin_approved_at",
        "compliance_officer_approved_at",
        "completed_at",
    ]
    list_filter = ["status"]
