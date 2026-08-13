from rest_framework.generics import ListAPIView

from .models import IcdCodeIndex, LoincCodeIndex, NationalDrugIndex
from .serializers import (
    IcdCodeIndexSerializer,
    LoincCodeIndexSerializer,
    NationalDrugIndexSerializer,
)


class Icd11SearchView(ListAPIView):
    """GET /api/v1/terminology/icd11/search/?q= — docs/10-API-SPECIFICATION.md §10.5."""

    serializer_class = IcdCodeIndexSerializer
    # Autocomplete endpoint, not a browsable list — already capped to 25
    # results below; the global paginated-envelope default would otherwise
    # wrap this in {count, next, previous, results} for no benefit.
    pagination_class = None

    def get_queryset(self):
        q = self.request.query_params.get("q", "").strip()
        queryset = IcdCodeIndex.objects.all()
        if q:
            queryset = queryset.filter(description__icontains=q) | queryset.filter(
                code__istartswith=q
            )
        return queryset[:25]


class LoincSearchView(ListAPIView):
    """GET /api/v1/terminology/loinc/search/?q= — docs/10-API-SPECIFICATION.md §10.6."""

    serializer_class = LoincCodeIndexSerializer
    pagination_class = None

    def get_queryset(self):
        q = self.request.query_params.get("q", "").strip()
        queryset = LoincCodeIndex.objects.all()
        if q:
            queryset = queryset.filter(description__icontains=q) | queryset.filter(
                code__istartswith=q
            )
        return queryset[:25]


class DrugIndexSearchView(ListAPIView):
    """GET /api/v1/terminology/drug-index/search/?q= — docs/10-API-SPECIFICATION.md §10.8."""

    serializer_class = NationalDrugIndexSerializer
    pagination_class = None

    def get_queryset(self):
        q = self.request.query_params.get("q", "").strip()
        queryset = NationalDrugIndex.objects.all()
        if q:
            queryset = queryset.filter(generic_name__icontains=q)
        return queryset[:25]
