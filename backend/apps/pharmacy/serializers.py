from rest_framework import serializers

from .models import DispenseRecord, DrugStockItem, StockMovement, Store


class StoreSerializer(serializers.ModelSerializer):
    class Meta:
        model = Store
        fields = ["id", "name", "store_type", "branch"]


class DrugStockItemSerializer(serializers.ModelSerializer):
    drug_name = serializers.CharField(source="drug.generic_name", read_only=True)

    class Meta:
        model = DrugStockItem
        fields = [
            "id",
            "store",
            "drug",
            "drug_name",
            "batch_number",
            "expiry_date",
            "quantity_on_hand",
        ]


class StockMovementSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockMovement
        fields = ["id", "stock_item", "movement_type", "quantity", "moved_by", "moved_at"]
        read_only_fields = ["moved_by", "moved_at"]


class DispenseRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = DispenseRecord
        fields = [
            "id",
            "prescription_item",
            "stock_item",
            "quantity_dispensed",
            "dispensed_by",
            "dispensed_at",
        ]
        read_only_fields = ["stock_item", "dispensed_by", "dispensed_at"]
