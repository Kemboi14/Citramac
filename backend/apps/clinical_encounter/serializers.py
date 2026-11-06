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
            "error_reason",
        ]
        read_only_fields = [
            "opened_by",
            "opened_at",
            "status",
            "closed_at",
            "branch",
            "error_reason",
        ]


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
            "error_reason",
        ]
        read_only_fields = ["noted_at", "recorded_by", "error_reason"]

    def validate_verification_status(self, value):
        if value == "ENTERED_IN_ERROR":
            raise serializers.ValidationError(
                "Use “entered in error” on the diagnosis, which asks for the reason."
            )
        return value

    def update(self, instance, validated_data):
        if instance.verification_status == "ENTERED_IN_ERROR":
            raise serializers.ValidationError(
                {"detail": "This diagnosis was entered in error and is not changed."}
            )
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
