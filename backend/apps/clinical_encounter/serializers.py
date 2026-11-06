from rest_framework import serializers

from .models import DiagnosisCode, Encounter


class EncounterSerializer(serializers.ModelSerializer):
    class Meta:
        model = Encounter
        fields = [
            "id",
            "patient",
            "branch",
            "opened_by",
            "encounter_type",
            "status",
            "opened_at",
            "closed_at",
        ]
        read_only_fields = ["opened_by", "opened_at", "status", "closed_at", "branch"]


class DiagnosisCodeSerializer(serializers.ModelSerializer):
    icd11_description = serializers.CharField(source="icd11_code.description", read_only=True)
    patient = serializers.UUIDField(source="encounter.patient_id", read_only=True)

    class Meta:
        model = DiagnosisCode
        fields = [
            "id",
            "encounter",
            "patient",
            "icd11_code",
            "icd11_description",
            "is_primary",
            "noted_at",
            "status",
            "verification_status",
            "clinical_notes",
            "diagnostic_criteria_met",
            "recorded_by",
        ]
        read_only_fields = ["noted_at", "recorded_by"]

    def update(self, instance, validated_data):
        # Condition.subject/encounter and Condition.code are fixed once recorded:
        # a wrong code is ruled out and a new diagnosis recorded, never rewritten.
        for field in ("encounter", "icd11_code"):
            if field in validated_data and validated_data[field] != getattr(instance, field):
                raise serializers.ValidationError(
                    {
                        field: "Can't be changed once recorded — rule this one out and record a new diagnosis."
                    }
                )
        return super().update(instance, validated_data)
