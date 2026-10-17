from rest_framework import serializers

from .models import InsuranceClaim, PreAuthorization, Remittance, ServicePayerCode


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
            "claim_number",
            "payer",
        ]
        # The total is always derived from the claim's lines, never typed in.
        read_only_fields = [
            "status",
            "sha_reference",
            "submitted_at",
            "total_claimed_amount",
            "diagnoses_snapshot",
            "claim_number",
            "payer",
        ]


class RemittanceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Remittance
        fields = ["id", "claim", "amount_paid", "remittance_date", "reference"]


class ServicePayerCodeSerializer(serializers.ModelSerializer):
    service_name = serializers.CharField(source="service.name", read_only=True)

    class Meta:
        model = ServicePayerCode
        fields = [
            "id",
            "service",
            "service_name",
            "payer",
            "payer_code",
            "requires_preauth",
            "active",
        ]
