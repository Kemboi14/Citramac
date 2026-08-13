from rest_framework import serializers

from .models import (
    ClinicalOrder,
    DiagnosisCode,
    Encounter,
    Prescription,
    PrescriptionItem,
    ReferralPacket,
    SoapNote,
)


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
        read_only_fields = ["opened_by", "opened_at"]


class SoapNoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = SoapNote
        fields = [
            "id",
            "encounter",
            "subjective",
            "objective",
            "assessment",
            "plan",
            "author",
            "signed_at",
            "is_locked",
        ]
        read_only_fields = ["encounter", "author", "signed_at", "is_locked"]


class DiagnosisCodeSerializer(serializers.ModelSerializer):
    icd11_description = serializers.CharField(source="icd11_code.description", read_only=True)

    class Meta:
        model = DiagnosisCode
        fields = ["id", "encounter", "icd11_code", "icd11_description", "is_primary", "noted_at"]
        read_only_fields = ["encounter", "noted_at"]


class ClinicalOrderSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClinicalOrder
        fields = [
            "id",
            "encounter",
            "order_type",
            "details",
            "ordered_by",
            "ordered_at",
            "status",
        ]
        read_only_fields = ["encounter", "ordered_by", "ordered_at"]


class PrescriptionItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = PrescriptionItem
        fields = [
            "id",
            "prescription",
            "drug",
            "dose",
            "route",
            "frequency",
            "duration",
            "allergy_check_passed",
            "interaction_check_passed",
            "pediatric_dose_flag",
        ]
        read_only_fields = ["prescription"]


class PrescriptionSerializer(serializers.ModelSerializer):
    items = PrescriptionItemSerializer(many=True, required=False)

    class Meta:
        model = Prescription
        fields = ["id", "encounter", "prescribed_by", "prescribed_at", "items"]
        read_only_fields = ["encounter", "prescribed_by", "prescribed_at"]

    def create(self, validated_data):
        items_data = validated_data.pop("items", [])
        prescription = Prescription.objects.create(**validated_data)
        for item_data in items_data:
            PrescriptionItem.objects.create(
                prescription=prescription, organization=prescription.organization, **item_data
            )
        return prescription


class ReferralPacketSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReferralPacket
        fields = [
            "id",
            "encounter",
            "destination_facility",
            "fhir_bundle_json",
            "status",
            "sent_at",
        ]
        read_only_fields = ["encounter", "fhir_bundle_json", "status", "sent_at"]
