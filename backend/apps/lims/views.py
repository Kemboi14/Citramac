from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.billing.gate import BillingNotCleared, check_billing_clearance

from .models import LabOrder, LabResult, LabSpecimen
from .permissions import can_see_unvalidated_results
from .serializers import LabOrderSerializer, LabResultSerializer, LabSpecimenSerializer


class LabOrderViewSet(viewsets.ModelViewSet):
    """
    docs/10-API-SPECIFICATION.md §10.6 — Module 4. Gated by the same POS
    validation check as generic clinical orders — docs/07-CLINICAL-MODULES-SPEC.md
    §7.10 names "order a lab test" explicitly.
    """

    serializer_class = LabOrderSerializer

    def get_queryset(self):
        return LabOrder.objects.select_related("encounter", "loinc_code").order_by("-ordered_at")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        encounter = serializer.validated_data["encounter"]
        try:
            check_billing_clearance(encounter)
        except BillingNotCleared as exc:
            return Response(
                {"error": {"code": "BILLING_NOT_CLEARED", "message": str(exc)}},
                status=status.HTTP_402_PAYMENT_REQUIRED,
            )
        serializer.save(organization=request.user.organization, ordered_by=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class LabSpecimenViewSet(viewsets.ModelViewSet):
    serializer_class = LabSpecimenSerializer

    def get_queryset(self):
        return LabSpecimen.objects.select_related("lab_order").order_by("-collected_at")

    def perform_create(self, serializer):
        specimen = serializer.save(
            organization=self.request.user.organization, collected_by=self.request.user
        )
        specimen.lab_order.status = "SPECIMEN_COLLECTED"
        specimen.lab_order.save(update_fields=["status"])


class LabResultViewSet(viewsets.ModelViewSet):
    """
    QC gate — docs/07-CLINICAL-MODULES-SPEC.md §7.4: unvalidated results are
    excluded from the queryset entirely for anyone who isn't lab staff/an
    auditor/superuser. Once a senior lab scientist validates a result, it
    becomes visible to ordering clinicians like any other clinical result —
    the gate is about *when* it's visible, not *who* may ever see it.
    """

    serializer_class = LabResultSerializer

    def get_queryset(self):
        queryset = LabResult.objects.select_related("lab_order").order_by("-recorded_at")
        if not can_see_unvalidated_results(self.request.user):
            queryset = queryset.filter(is_validated=True)
        return queryset

    def perform_create(self, serializer):
        result = serializer.save(
            organization=self.request.user.organization, recorded_by=self.request.user
        )
        result.lab_order.status = "RESULT_PENDING"
        result.lab_order.save(update_fields=["status"])

    @action(detail=True, methods=["post"])
    def validate(self, request, pk=None):
        """Senior lab scientist review & approval gate — docs/07-CLINICAL-MODULES-SPEC.md §7.4."""
        result = LabResult.objects.get(pk=pk)
        result.is_validated = True
        result.validated_by = request.user
        result.validated_at = timezone.now()
        result.save(update_fields=["is_validated", "validated_by", "validated_at"])
        result.lab_order.status = "RESULT_VALIDATED"
        result.lab_order.save(update_fields=["status"])
        return Response(LabResultSerializer(result).data)
