from rest_framework import serializers

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


class ConsentRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConsentRecord
        fields = [
            "id",
            "patient",
            "consent_type",
            "granted",
            "consent_text_version",
            "consent_text_snapshot",
            "captured_by",
            "captured_at",
        ]
        read_only_fields = ["patient", "captured_by", "captured_at"]


class ErasureRequestSerializer(serializers.ModelSerializer):
    is_fully_approved = serializers.BooleanField(read_only=True)

    class Meta:
        model = ErasureRequest
        fields = [
            "id",
            "patient",
            "requested_by",
            "reason",
            "status",
            "org_admin_approved_by",
            "org_admin_approved_at",
            "compliance_officer_approved_by",
            "compliance_officer_approved_at",
            "rejection_reason",
            "retention_conflict_detail",
            "completed_at",
            "is_fully_approved",
            "created_at",
        ]
        read_only_fields = [
            "requested_by",
            "status",
            "org_admin_approved_by",
            "org_admin_approved_at",
            "compliance_officer_approved_by",
            "compliance_officer_approved_at",
            "rejection_reason",
            "retention_conflict_detail",
            "completed_at",
            "created_at",
        ]


class EmergencyContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmergencyContact
        fields = ["id", "patient", "name", "relationship", "phone", "email", "address"]
        read_only_fields = ["patient"]


class AllergyRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = AllergyRecord
        fields = ["id", "patient", "substance", "reaction", "severity", "noted_at"]
        read_only_fields = ["patient"]


class InsuranceCoverageSerializer(serializers.ModelSerializer):
    class Meta:
        model = InsuranceCoverage
        fields = [
            "id",
            "patient",
            "scheme_type",
            "policy_number",
            "corporate_account",
            "sha_verified",
            "sha_member_status",
            "sha_premium_compliant",
            "sha_last_checked_at",
        ]
        read_only_fields = [
            "patient",
            "sha_verified",
            "sha_member_status",
            "sha_premium_compliant",
            "sha_last_checked_at",
        ]


class AttachmentSerializer(serializers.ModelSerializer):
    patient_name = serializers.SerializerMethodField()
    uploaded_by_name = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()

    class Meta:
        model = Attachment
        fields = [
            "id",
            "patient",
            "patient_name",
            "file",
            "file_size",
            "classification",
            "category",
            "document_type",
            "document_date",
            "tags",
            "is_favorite",
            "doc_status",
            "description",
            "uploaded_by",
            "uploaded_by_name",
            "uploaded_at",
        ]
        read_only_fields = ["uploaded_by", "uploaded_at"]

    def get_patient_name(self, obj):
        return obj.patient.get_full_name() if obj.patient_id else ""

    def get_uploaded_by_name(self, obj):
        return obj.uploaded_by.get_full_name() if obj.uploaded_by_id else ""

    def get_file_size(self, obj):
        try:
            return obj.file.size
        except (ValueError, OSError):
            return None


class PatientListSerializer(serializers.ModelSerializer):
    """Matches the AppSheet reference table columns — docs/03-DESIGN-SYSTEM.md §3.5."""

    age = serializers.IntegerField(source="age_years", read_only=True)
    doctors_name = serializers.SerializerMethodField()

    class Meta:
        model = Patient
        fields = [
            "id",
            "first_name",
            "last_name",
            "middle_other_names",
            "uhid_number",
            "citramac_number",
            "gender",
            "date_of_birth",
            "age",
            "registered_at",
            "doctors_name",
            "allergy_status",
            "nationality",
            "marital_status",
            "patient_category",
        ]

    def get_doctors_name(self, obj):
        return obj.doctor.get_full_name() if obj.doctor_id else ""


class PatientDetailSerializer(serializers.ModelSerializer):
    age = serializers.IntegerField(source="age_years", read_only=True)
    emergency_contacts = EmergencyContactSerializer(many=True, read_only=True)
    allergy_records = AllergyRecordSerializer(many=True, read_only=True)
    insurance_coverages = InsuranceCoverageSerializer(many=True, read_only=True)

    class Meta:
        model = Patient
        fields = [
            "id",
            "upi",
            "uhid_number",
            "citramac_number",
            "first_name",
            "last_name",
            "middle_other_names",
            "gender",
            "date_of_birth",
            "age",
            "marital_status",
            "nationality",
            "occupation",
            "employment_status",
            "living_with_disability",
            "national_id",
            "passport_number",
            "contact_phone",
            "contact_email",
            "address",
            "county",
            "next_of_kin",
            "allergy_status",
            "doctor",
            "registered_at",
            "registered_by",
            "referral_source",
            "referral_mode",
            "referral_date",
            "patient_category",
            "insurer_details",
            "consent_data_sharing",
            "consent_captured_at",
            "emergency_contacts",
            "allergy_records",
            "insurance_coverages",
        ]
        read_only_fields = ["citramac_number", "registered_at", "registered_by"]


class AppointmentSerializer(serializers.ModelSerializer):
    patient_name = serializers.SerializerMethodField()
    provider_name = serializers.SerializerMethodField()

    class Meta:
        model = Appointment
        fields = [
            "id",
            "patient",
            "patient_name",
            "branch",
            "provider",
            "provider_name",
            "scheduled_for",
            "duration_minutes",
            "location",
            "mode",
            "appointment_type",
            "status",
            "notes",
        ]

    def get_patient_name(self, obj):
        return obj.patient.get_full_name() if obj.patient_id else ""

    def get_provider_name(self, obj):
        return obj.provider.get_full_name() if obj.provider_id else ""
