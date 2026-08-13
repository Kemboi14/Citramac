from rest_framework import serializers

from .models import MentalStatusExam, VitalSigns


class VitalSignsSerializer(serializers.ModelSerializer):
    class Meta:
        model = VitalSigns
        fields = [
            "id",
            "encounter",
            "systolic_bp",
            "diastolic_bp",
            "heart_rate",
            "respiratory_rate",
            "temperature_c",
            "spo2",
            "height_cm",
            "weight_kg",
            "bmi",
            "bsa",
            "esi_acuity_level",
            "recorded_by",
            "recorded_at",
        ]
        read_only_fields = ["encounter", "bmi", "bsa", "recorded_by", "recorded_at"]


class MentalStatusExamSerializer(serializers.ModelSerializer):
    class Meta:
        model = MentalStatusExam
        fields = [
            "id",
            "encounter",
            "appearance",
            "behavior",
            "speech",
            "mood",
            "affect",
            "thought_process",
            "thought_content",
            "perception",
            "cognition",
            "insight",
            "judgment",
            "plan",
            "risk_assessment",
            "risk_escalated_to_supervisor",
            "recorded_by",
            "recorded_at",
        ]
        read_only_fields = [
            "encounter",
            "risk_escalated_to_supervisor",
            "recorded_by",
            "recorded_at",
        ]
