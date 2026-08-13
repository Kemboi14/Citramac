from rest_framework import serializers

from .models import CostCenter, Invoice, InvoiceLine, Payment


class InvoiceLineSerializer(serializers.ModelSerializer):
    line_total = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = InvoiceLine
        fields = [
            "id",
            "invoice",
            "cost_center",
            "description",
            "fund_source",
            "quantity",
            "unit_price",
            "line_total",
        ]
        read_only_fields = ["invoice"]


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ["id", "invoice", "amount", "method", "reference", "received_by", "paid_at"]
        read_only_fields = ["invoice", "received_by", "paid_at"]


class InvoiceSerializer(serializers.ModelSerializer):
    lines = InvoiceLineSerializer(many=True, required=False)
    payments = PaymentSerializer(many=True, read_only=True)
    total_amount = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    amount_paid = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = Invoice
        fields = [
            "id",
            "patient",
            "encounter",
            "status",
            "currency",
            "created_by",
            "created_at",
            "lines",
            "payments",
            "total_amount",
            "amount_paid",
        ]
        read_only_fields = ["status", "created_by", "created_at"]

    def create(self, validated_data):
        lines_data = validated_data.pop("lines", [])
        invoice = Invoice.objects.create(**validated_data)
        for line_data in lines_data:
            InvoiceLine.objects.create(
                invoice=invoice, organization=invoice.organization, **line_data
            )
        return invoice


class CostCenterSerializer(serializers.ModelSerializer):
    class Meta:
        model = CostCenter
        fields = ["id", "name", "branch"]
