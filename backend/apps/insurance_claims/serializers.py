from rest_framework import serializers

from .models import InsuranceClaim, Insurer, PreAuthorization, Remittance, ServicePayerCode


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


class InsurerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Insurer
        fields = ["id", "name", "active"]

    def validate_name(self, value):
        name = " ".join(str(value or "").split())
        if not name:
            raise serializers.ValidationError("Enter the insurer's name.")
        request = self.context.get("request")
        organization_id = (
            self.instance.organization_id
            if self.instance is not None
            else getattr(getattr(request, "user", None), "organization_id", None)
        )
        clash = Insurer.objects.filter(organization_id=organization_id, name__iexact=name)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("This insurer is already on the list.")
        return name


class ServicePayerCodeSerializer(serializers.ModelSerializer):
    service_name = serializers.CharField(source="service.name", read_only=True)

    class Meta:
        model = ServicePayerCode
        fields = [
            "id",
            "service",
            "service_name",
            "payer",
            "insurer",
            "payer_code",
            "rate",
            "requires_preauth",
            "active",
        ]

    def validate(self, attrs):
        payer = attrs.get("payer", getattr(self.instance, "payer", ""))
        insurer = attrs.get("insurer", getattr(self.instance, "insurer", None))
        if (payer == "INSURER") != (insurer is not None):
            raise serializers.ValidationError(
                {"insurer": "Name the insurer exactly when the payer is a named insurer."}
            )
        request = self.context.get("request")
        org_id = getattr(getattr(request, "user", None), "organization_id", None)
        if insurer is not None and org_id and insurer.organization_id != org_id:
            raise serializers.ValidationError({"insurer": "Unknown insurer."})
        return attrs
