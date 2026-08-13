from django.db.models import DecimalField, ExpressionWrapper, F, Sum
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import CostCenter, Invoice, InvoiceLine
from .serializers import CostCenterSerializer, InvoiceSerializer, PaymentSerializer


class InvoiceViewSet(viewsets.ModelViewSet):
    """docs/10-API-SPECIFICATION.md §10.11 — Module 10."""

    serializer_class = InvoiceSerializer

    def get_queryset(self):
        return Invoice.objects.select_related("patient").order_by("-created_at")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, created_by=self.request.user)

    @action(detail=True, methods=["get", "post"])
    def payments(self, request, pk=None):
        invoice = self.get_object()
        if request.method == "POST":
            serializer = PaymentSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(
                invoice=invoice, organization=invoice.organization, received_by=request.user
            )
            invoice.refresh_from_db()
            return Response(InvoiceSerializer(invoice).data, status=status.HTTP_201_CREATED)
        return Response(PaymentSerializer(invoice.payments.all(), many=True).data)


class CostCenterViewSet(viewsets.ModelViewSet):
    serializer_class = CostCenterSerializer

    def get_queryset(self):
        return CostCenter.objects.all()

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)


class CostCenterReportView(APIView):
    """GET /api/v1/billing/cost-centers/report/ — docs/10-API-SPECIFICATION.md §10.11."""

    def get(self, request):
        line_total = ExpressionWrapper(
            F("quantity") * F("unit_price"),
            output_field=DecimalField(max_digits=14, decimal_places=2),
        )
        rows = (
            InvoiceLine.objects.annotate(computed_line_total=line_total)
            .values("cost_center__id", "cost_center__name")
            .annotate(total_revenue=Sum("computed_line_total"))
            .order_by("cost_center__name")
        )
        return Response(
            [
                {
                    "cost_center_id": row["cost_center__id"],
                    "cost_center_name": row["cost_center__name"] or "Unassigned",
                    "total_revenue": row["total_revenue"] or 0,
                }
                for row in rows
            ]
        )
