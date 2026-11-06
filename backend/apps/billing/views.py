from django.db.models import DecimalField, ExpressionWrapper, F, Sum
from rest_framework import viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import CostCenter, InvoiceLine
from .serializers import CostCenterSerializer


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
