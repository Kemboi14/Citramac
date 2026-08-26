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
    class Meta:
        model = Admission
        fields = [
            "id",
            "patient",
            "encounter",
            "bed",
            "admitted_by",
            "admitted_at",
            "status",
            "discharged_at",
            "discharge_summary",
            "follow_up_date",
        ]
        read_only_fields = ["admitted_by", "admitted_at", "status", "discharged_at"]


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
