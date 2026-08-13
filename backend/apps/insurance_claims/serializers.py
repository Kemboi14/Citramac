from rest_framework import serializers

from .models import InsuranceClaim, PreAuthorization, Remittance


class PreAuthorizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = PreAuthorization
        fields = [
            "id",
            "patient",
            "encounter",
            "clinical_notes",
            "diagnostic_evidence",
            "status",
            "sha_reference",
            "submitted_at",
            "decided_at",
        ]
        read_only_fields = ["status", "sha_reference", "submitted_at", "decided_at"]


class InsuranceClaimSerializer(serializers.ModelSerializer):
    class Meta:
        model = InsuranceClaim
        fields = [
            "id",
            "patient",
            "encounter",
            "invoice",
            "diagnoses_snapshot",
            "total_claimed_amount",
            "status",
            "sha_reference",
            "submitted_at",
        ]
        read_only_fields = ["status", "sha_reference", "submitted_at"]


class RemittanceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Remittance
        fields = ["id", "claim", "amount_paid", "remittance_date", "reference"]
