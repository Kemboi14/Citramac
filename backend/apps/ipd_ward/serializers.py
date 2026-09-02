from rest_framework import serializers

from .models import Admission, Bed, MedicationAdministration, NursingNote, Ward


class WardSerializer(serializers.ModelSerializer):
    bed_count = serializers.SerializerMethodField()

    class Meta:
        model = Ward
        fields = ["id", "name", "branch", "ward_type", "bed_count"]

    def get_bed_count(self, obj):
        return getattr(obj, "bed_count", None) or obj.beds.count()


class BedSerializer(serializers.ModelSerializer):
    occupant_name = serializers.SerializerMethodField()

    class Meta:
        model = Bed
        fields = ["id", "ward", "bed_number", "status", "occupant_name"]

    def get_occupant_name(self, obj):
        if obj.status != "OCCUPIED":
            return None
        admission = obj.admissions.filter(status="ADMITTED").order_by("-admitted_at").first()
        return admission.patient.get_full_name() if admission else None


class AdmissionSerializer(serializers.ModelSerializer):
    patient_name = serializers.SerializerMethodField()
    bed_label = serializers.SerializerMethodField()

    class Meta:
        model = Admission
        fields = [
            "id",
            "patient",
            "patient_name",
            "encounter",
            "bed",
            "bed_label",
            "admitted_by",
            "admitted_at",
            "status",
            "discharged_at",
            "discharge_summary",
            "follow_up_date",
            "admission_type",
            "admission_source",
            "priority",
            "reason_for_admission",
            "clinical_summary",
            "primary_diagnosis",
            "associated_conditions",
            "risk_self_harm",
            "risk_to_others",
            "risk_absconding",
            "risk_medical",
            "observation_level",
            "safety_actions",
            "risk_summary",
            "primary_care_team",
            "consultant",
            "initial_care_priorities",
            "consent_status",
            "consent_at",
            "consent_obtained_by",
            "capacity_assessed",
            "consent_notes",
            "legal_status",
            "legal_order_reference",
            "legal_order_date",
            "legal_review_due_date",
            "authorizing_professional",
            "legal_rationale",
            "oversight_notes",
            "next_of_kin_notification",
            "next_of_kin_notes",
            "handover_note",
        ]
        read_only_fields = ["admitted_by", "admitted_at", "status", "discharged_at"]

    def get_patient_name(self, obj):
        return obj.patient.get_full_name() if obj.patient_id else ""

    def get_bed_label(self, obj):
        return f"{obj.bed.ward.name} / Bed {obj.bed.bed_number}" if obj.bed_id else ""


class MedicationAdministrationSerializer(serializers.ModelSerializer):
    class Meta:
        model = MedicationAdministration
        fields = [
            "id",
            "admission",
            "prescription_item",
            "scheduled_time",
            "status",
            "administered_by",
            "administered_at",
            "notes",
        ]
        read_only_fields = ["status", "administered_by", "administered_at"]


class NursingNoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = NursingNote
        fields = ["id", "admission", "author", "shift", "note", "recorded_at"]
        read_only_fields = ["author", "recorded_at"]
