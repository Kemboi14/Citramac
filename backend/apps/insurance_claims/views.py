from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import _has_org_admin_role
from apps.billing.permissions import IsFinanceOrReadOnly, is_finance
from apps.client_registry.models import Patient
from apps.retention.mixins import NoHardDeleteMixin

from . import sha_gateway, workspace
from .models import (
    ClaimAttachment,
    ClaimLine,
    InsuranceClaim,
    PreAuthorization,
    Remittance,
    ServicePayerCode,
)
from .serializers import (
    InsuranceClaimSerializer,
    PreAuthorizationSerializer,
    RemittanceSerializer,
    ServicePayerCodeSerializer,
)


class PreAuthorizationViewSet(NoHardDeleteMixin, viewsets.ModelViewSet):
    """docs/10-API-SPECIFICATION.md §10.11 — Module 11."""

    serializer_class = PreAuthorizationSerializer
    permission_classes = [IsFinanceOrReadOnly]

    def get_queryset(self):
        return PreAuthorization.objects.select_related("patient").order_by("-id")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)

    @action(detail=True, methods=["post"], url_path="submit-to-sha")
    def submit_to_sha(self, request, pk=None):
        pre_auth = self.get_object()
        log_entry = sha_gateway.submit_pre_authorization(pre_auth)
        pre_auth.status = "SUBMITTED"
        pre_auth.sha_reference = str(log_entry.id)
        pre_auth.submitted_at = timezone.now()
        pre_auth.save(update_fields=["status", "sha_reference", "submitted_at"])
        return Response(PreAuthorizationSerializer(pre_auth).data)


class InsuranceClaimViewSet(NoHardDeleteMixin, viewsets.ModelViewSet):
    serializer_class = InsuranceClaimSerializer
    permission_classes = [IsFinanceOrReadOnly]

    def get_queryset(self):
        return InsuranceClaim.objects.select_related("patient").order_by("-id")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, created_by=self.request.user)

    @action(detail=True, methods=["post"], url_path="submit-to-sha")
    def submit_to_sha(self, request, pk=None):
        # Same finance review as the client record's Billing stage — there is
        # no unchecked submission path.
        claim = self.get_object()
        try:
            claim = workspace.submit_claim(
                request.user, claim, bool(request.data.get("lines_checked"))
            )
        except workspace.BillingError as exc:
            return _refused(exc)
        return Response(InsuranceClaimSerializer(claim).data)


class RemittanceViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = RemittanceSerializer

    def get_queryset(self):
        return Remittance.objects.select_related("claim").order_by("-remittance_date")


# ── Client record → Billing stage (v4 mockup stageBilling) ──


def _refused(exc):
    return Response(
        {
            "error": {
                "code": "billing_refused",
                "message": exc.message,
                "field": exc.field,
                "fields": {exc.field: [exc.message]} if exc.field else {},
            }
        },
        status=status.HTTP_400_BAD_REQUEST,
    )


def _require_finance(user):
    if not is_finance(user):
        raise PermissionDenied(IsFinanceOrReadOnly.message)


class _FinanceView(APIView):
    permission_classes = [IsFinanceOrReadOnly]

    def _claim(self, pk):
        return get_object_or_404(InsuranceClaim.objects.select_related("patient"), pk=pk)

    def _respond(self, patient, code=status.HTTP_200_OK):
        return Response(workspace.workspace(self.request.user, patient), status=code)

    def _run(self, patient, fn, code=status.HTTP_200_OK):
        try:
            fn()
        except workspace.BillingError as exc:
            return _refused(exc)
        return self._respond(patient, code)


class ClientBillingWorkspaceView(_FinanceView):
    def get(self, request, patient_id):
        return self._respond(get_object_or_404(Patient, pk=patient_id))


class ClientClaimCreateView(_FinanceView):
    def post(self, request, patient_id):
        patient = get_object_or_404(Patient, pk=patient_id)
        charge_ids = request.data.get("charge_items")
        return self._run(
            patient,
            lambda: workspace.create_claim(request.user, patient, charge_ids),
            status.HTTP_201_CREATED,
        )


class ClientInvoiceView(_FinanceView):
    def post(self, request, patient_id):
        patient = get_object_or_404(Patient, pk=patient_id)
        return self._run(patient, lambda: workspace.issue_invoice(request.user, patient))


class ClientPaymentView(_FinanceView):
    def post(self, request, patient_id):
        patient = get_object_or_404(Patient, pk=patient_id)
        return self._run(
            patient,
            lambda: workspace.record_payment(request.user, patient, request.data),
            status.HTTP_201_CREATED,
        )


class ClientBillingExportView(APIView):
    """CSV of the client's billing events (finance only: it leaves the system)."""

    def get(self, request, patient_id):
        _require_finance(request.user)
        patient = get_object_or_404(Patient, pk=patient_id)
        response = HttpResponse(workspace.export_csv(patient), content_type="text/csv")
        stem = patient.citramac_number or str(patient.id).split("-")[0]
        response["Content-Disposition"] = f'attachment; filename="billing-{stem}.csv"'
        return response


class BillingClaimView(_FinanceView):
    def patch(self, request, pk):
        claim = self._claim(pk)
        return self._run(
            claim.patient,
            lambda: workspace.update_draft(request.user, claim, request.data.get("guarantor", "")),
        )


class BillingClaimSubmitView(_FinanceView):
    def post(self, request, pk):
        claim = self._claim(pk)
        return self._run(
            claim.patient,
            lambda: workspace.submit_claim(
                request.user, claim, bool(request.data.get("lines_checked"))
            ),
        )


class BillingClaimStatusView(_FinanceView):
    def post(self, request, pk):
        claim = self._claim(pk)
        return self._run(
            claim.patient,
            lambda: workspace.record_payer_status(
                request.user,
                claim,
                request.data.get("status"),
                request.data.get("approved_amount"),
                request.data.get("note", ""),
            ),
        )


class BillingClaimLineView(_FinanceView):
    def delete(self, request, pk, line_id):
        claim = self._claim(pk)
        line = get_object_or_404(ClaimLine, pk=line_id, claim=claim)
        return self._run(claim.patient, lambda: workspace.remove_line(request.user, claim, line))


class BillingClaimLinePreauthView(_FinanceView):
    def post(self, request, pk, line_id):
        claim = self._claim(pk)
        line = get_object_or_404(
            ClaimLine.objects.select_related("charge_item__service", "pre_authorization"),
            pk=line_id,
            claim=claim,
        )
        return self._run(
            claim.patient, lambda: workspace.request_preauth(request.user, claim, line)
        )


class BillingClaimAttachmentsView(_FinanceView):
    def post(self, request, pk):
        claim = self._claim(pk)
        return self._run(
            claim.patient,
            lambda: workspace.add_attachment(request.user, claim, request.data.get("category")),
            status.HTTP_201_CREATED,
        )


class BillingClaimAttachmentView(_FinanceView):
    def delete(self, request, pk, attachment_id):
        claim = self._claim(pk)
        attachment = get_object_or_404(ClaimAttachment, pk=attachment_id, claim=claim)
        return self._run(
            claim.patient, lambda: workspace.remove_attachment(request.user, claim, attachment)
        )


class BillingPreauthDecisionView(_FinanceView):
    def post(self, request, pk):
        pre_auth = get_object_or_404(PreAuthorization.objects.select_related("patient"), pk=pk)
        return self._run(
            pre_auth.patient,
            lambda: workspace.record_preauth_decision(
                request.user,
                pre_auth,
                request.data.get("status"),
                request.data.get("approval_reference", ""),
                request.data.get("note", ""),
            ),
        )


class IsOrgAdminOrReadOnly(IsFinanceOrReadOnly):
    message = "Only an Org Admin can change the payer tariff mapping."

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        return request.method in ("GET", "HEAD", "OPTIONS") or _has_org_admin_role(request.user)


class ServicePayerCodeViewSet(NoHardDeleteMixin, viewsets.ModelViewSet):
    """Facility-configured payer codes per tariff service (from the payer's
    published tariff — VERIFY each value against it)."""

    serializer_class = ServicePayerCodeSerializer
    permission_classes = [IsOrgAdminOrReadOnly]

    def get_queryset(self):
        return ServicePayerCode.objects.select_related("service").order_by("service__name", "payer")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)
