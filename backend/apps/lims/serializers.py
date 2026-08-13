from rest_framework import serializers

from .models import LabOrder, LabResult, LabSpecimen


class LabOrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = LabOrder
        fields = ["id", "encounter", "loinc_code", "ordered_by", "ordered_at", "status"]
        read_only_fields = ["ordered_by", "ordered_at"]


class LabSpecimenSerializer(serializers.ModelSerializer):
    class Meta:
        model = LabSpecimen
        fields = ["id", "lab_order", "barcode", "specimen_type", "collected_by", "collected_at"]
        read_only_fields = ["barcode", "collected_by", "collected_at"]


class LabResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = LabResult
        fields = [
            "id",
            "lab_order",
            "specimen",
            "result_value",
            "unit",
            "reference_range",
            "is_abnormal",
            "recorded_by",
            "recorded_at",
            "is_validated",
            "validated_by",
            "validated_at",
        ]
        read_only_fields = [
            "recorded_by",
            "recorded_at",
            "is_validated",
            "validated_by",
            "validated_at",
        ]
