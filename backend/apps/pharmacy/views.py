from rest_framework import status, viewsets
from rest_framework.response import Response

from apps.billing.gate import BillingNotCleared, check_billing_clearance

from .fefo import InsufficientStock, dispense_fefo
from .models import DispenseRecord, DrugStockItem, StockMovement, Store
from .serializers import (
    DispenseRecordSerializer,
    DrugStockItemSerializer,
    StockMovementSerializer,
    StoreSerializer,
)


class StoreViewSet(viewsets.ModelViewSet):
    serializer_class = StoreSerializer

    def get_queryset(self):
        # Not `queryset = Store.objects.all()` as a class attribute — that
        # would bind the tenant-scoped manager's filter at import time
        # (before any request context exists), returning nothing forever.
        return Store.objects.order_by("name")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)


class DrugStockItemViewSet(viewsets.ModelViewSet):
    """docs/10-API-SPECIFICATION.md §10.8 — Module 6 stock items."""

    serializer_class = DrugStockItemSerializer

    def get_queryset(self):
        return DrugStockItem.objects.select_related("store", "drug").order_by("expiry_date")

    def perform_create(self, serializer):
        stock_item = serializer.save(organization=self.request.user.organization)
        StockMovement.objects.create(
            organization=self.request.user.organization,
            stock_item=stock_item,
            movement_type="RECEIPT",
            quantity=stock_item.quantity_on_hand,
            moved_by=self.request.user,
        )


class StockMovementViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = StockMovementSerializer

    def get_queryset(self):
        return StockMovement.objects.select_related("stock_item").order_by("-moved_at")


class DispenseRecordViewSet(viewsets.ModelViewSet):
    """
    E-prescription fulfillment — docs/10-API-SPECIFICATION.md §10.8:
    POST /pharmacy/dispense/{prescription_item_id}/. The POS validation gate
    (docs/07-CLINICAL-MODULES-SPEC.md §7.10) applies here too: dispensing is
    explicitly named alongside ordering labs/procedures as gated on cleared
    billing for the underlying encounter.
    """

    serializer_class = DispenseRecordSerializer

    def get_queryset(self):
        return DispenseRecord.objects.select_related("prescription_item", "stock_item").order_by(
            "-dispensed_at"
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        prescription_item = serializer.validated_data["prescription_item"]
        quantity = serializer.validated_data["quantity_dispensed"]
        encounter = prescription_item.prescription.encounter

        try:
            store = Store.objects.get(pk=request.data.get("store"))
        except (Store.DoesNotExist, ValueError, TypeError, KeyError):
            return Response(
                {"error": {"code": "INVALID_STORE", "message": "A valid store id is required."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            check_billing_clearance(encounter)
        except BillingNotCleared as exc:
            return Response(
                {"error": {"code": "BILLING_NOT_CLEARED", "message": str(exc)}},
                status=status.HTTP_402_PAYMENT_REQUIRED,
            )

        try:
            consumed = dispense_fefo(
                store=store,
                drug=prescription_item.drug,
                quantity=quantity,
                user=request.user,
                organization=request.user.organization,
            )
        except InsufficientStock as exc:
            return Response(
                {"error": {"code": "INSUFFICIENT_STOCK", "message": str(exc)}},
                status=status.HTTP_409_CONFLICT,
            )

        records = [
            DispenseRecord.objects.create(
                organization=request.user.organization,
                prescription_item=prescription_item,
                stock_item=batch,
                quantity_dispensed=taken,
                dispensed_by=request.user,
            )
            for batch, taken in consumed
        ]
        return Response(
            DispenseRecordSerializer(records, many=True).data, status=status.HTTP_201_CREATED
        )
