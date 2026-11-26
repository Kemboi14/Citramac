from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts.access import has_permission
from apps.billing.gate import BillingNotCleared, check_billing_clearance
from apps.retention.mixins import NoHardDeleteMixin
from apps.sysadmin_audit.mixins import AuditedReadMixin

from .models import LabOrder, LabResult, LabSpecimen
from .permissions import can_see_unvalidated_results
from .serializers import LabOrderSerializer, LabResultSerializer, LabSpecimenSerializer


def _require_lab_or_clinical(user):
    """Ordering, collecting and recording are clinical or laboratory work."""
    from apps.care_pathway.access import CARE, require

    require(user, (CARE, "laboratory.results.validate"))


class LabOrderViewSet(AuditedReadMixin, NoHardDeleteMixin, viewsets.ModelViewSet):
    """
    docs/10-API-SPECIFICATION.md §10.6 — Module 4. Gated by the same POS
    validation check as generic clinical orders — docs/07-CLINICAL-MODULES-SPEC.md
    §7.10 names "order a lab test" explicitly.
    """

    serializer_class = LabOrderSerializer

    def get_queryset(self):
        return LabOrder.objects.select_related("encounter", "loinc_code").order_by("-ordered_at")

    def create(self, request, *args, **kwargs):
        _require_lab_or_clinical(request.user)
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

    def perform_update(self, serializer):
        _require_lab_or_clinical(self.request.user)
        serializer.save()


class LabSpecimenViewSet(AuditedReadMixin, NoHardDeleteMixin, viewsets.ModelViewSet):
    serializer_class = LabSpecimenSerializer

    def get_queryset(self):
        return LabSpecimen.objects.select_related("lab_order").order_by("-collected_at")

    def perform_create(self, serializer):
        _require_lab_or_clinical(self.request.user)
        specimen = serializer.save(
            organization=self.request.user.organization, collected_by=self.request.user
        )
        specimen.lab_order.status = "SPECIMEN_COLLECTED"
        specimen.lab_order.save(update_fields=["status"])

    def perform_update(self, serializer):
        _require_lab_or_clinical(self.request.user)
        order = serializer.validated_data.get("lab_order")
        if order is not None and order.pk != serializer.instance.lab_order_id:
            raise ValidationError({"lab_order": "A specimen can't be moved to another order."})
        serializer.save()


class LabResultViewSet(AuditedReadMixin, NoHardDeleteMixin, viewsets.ModelViewSet):
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
        _require_lab_or_clinical(self.request.user)
        result = serializer.save(
            organization=self.request.user.organization, recorded_by=self.request.user
        )
        result.lab_order.status = "RESULT_PENDING"
        result.lab_order.save(update_fields=["status"])

    def perform_update(self, serializer):
        _require_lab_or_clinical(self.request.user)
        if serializer.instance.is_validated:
            raise ValidationError({"detail": "A validated result can no longer be changed."})
        order = serializer.validated_data.get("lab_order")
        if order is not None and order.pk != serializer.instance.lab_order_id:
            raise ValidationError({"lab_order": "A result can't be moved to another order."})
        serializer.save()

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def validate(self, request, pk=None):
        """Senior lab scientist review & approval gate — docs/07-CLINICAL-MODULES-SPEC.md §7.4."""
        if not (
            request.user.is_superuser or has_permission(request.user, "laboratory.results.validate")
        ):
            raise PermissionDenied("You don't have permission to validate laboratory results.")
        result = self.get_queryset().select_for_update(of=("self",)).filter(pk=pk).first()
        if result is None:
            from django.http import Http404

            raise Http404
        if result.is_validated:
            raise ValidationError({"detail": "This result is already validated."})
        result.is_validated = True
        result.validated_by = request.user
        result.validated_at = timezone.now()
        result.save(update_fields=["is_validated", "validated_by", "validated_at"])
        result.lab_order.status = "RESULT_VALIDATED"
        result.lab_order.save(update_fields=["status"])
        return Response(LabResultSerializer(result).data)
