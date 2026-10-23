from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import _has_org_admin_role
from apps.billing.permissions import IsFinanceOrReadOnly, is_finance
from apps.client_registry.models import Patient
from apps.retention.mixins import NoHardDeleteMixin

from apps.tenancy.models import Branch

from . import sha_callbacks, sha_claims, sha_eligibility, sha_remittance, workspace
from .models import (
    ClaimAttachment,
    ClaimLine,
    InsuranceClaim,
    PreAuthorization,
    Remittance,
    ServicePayerCode,
    ShaVisit,
)
from .sha_eligibility import ShaError
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
                request.user,
                claim,
                bool(request.data.get("lines_checked")),
                request.data.get("sha") or {},
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
        except (workspace.BillingError, ShaError) as exc:
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
                request.user,
                claim,
                bool(request.data.get("lines_checked")),
                request.data.get("sha") or {},
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
            claim.patient,
            lambda: workspace.request_preauth(request.user, claim, line, request.data),
        )


class BillingClaimAttachmentsView(_FinanceView):
    def post(self, request, pk):
        claim = self._claim(pk)
        return self._run(
            claim.patient,
            lambda: workspace.add_attachment(
                request.user,
                claim,
                request.data.get("category"),
                request.data.get("file"),
                request.data.get("sha_document_type") or "",
                request.data.get("intervention_code") or "",
            ),
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


# ── SHA through the DHA HIE (sha_eligibility / sha_claims / sha_callbacks) ──


def _sha_branch(patient, branch_id):
    branch = Branch.objects.filter(
        pk=branch_id, organization_id=patient.organization_id, is_active=True
    ).first() if branch_id else None
    if branch is None:
        raise ShaError("Choose the facility (branch) the client is at.", field="branch")
    return branch


def _patient(patient_id):
    return get_object_or_404(Patient, pk=patient_id)


class ClientShaEligibilityView(_FinanceView):
    def post(self, request, patient_id):
        patient = _patient(patient_id)
        return self._run(
            patient,
            lambda: sha_eligibility.check_eligibility(
                patient, _sha_branch(patient, request.data.get("branch")), request.user
            ),
        )


class ClientShaInterventionsView(_FinanceView):
    def get(self, request, patient_id):
        patient = _patient(patient_id)
        try:
            data = sha_eligibility.list_interventions(
                patient,
                _sha_branch(patient, request.query_params.get("branch")),
                search=request.query_params.get("search", "").strip(),
                code=request.query_params.get("code", "").strip(),
                page=int(request.query_params.get("page") or 1),
            )
        except ShaError as exc:
            return _refused(exc)
        return Response(data)


class ClientShaContactsView(_FinanceView):
    def get(self, request, patient_id):
        patient = _patient(patient_id)
        try:
            contacts = sha_claims.list_contacts(
                patient, _sha_branch(patient, request.query_params.get("branch"))
            )
        except ShaError as exc:
            return _refused(exc)
        return Response({"contacts": contacts})


class ClientShaOtpView(_FinanceView):
    def post(self, request, patient_id):
        patient = _patient(patient_id)
        try:
            message = sha_claims.send_visit_otp(
                patient,
                _sha_branch(patient, request.data.get("branch")),
                request.data.get("intervention_codes") or [],
                request.data.get("contact_id"),
            )
        except ShaError as exc:
            return _refused(exc)
        return Response({"message": message})


class ClientShaVisitView(_FinanceView):
    """Open an SHA visit with the client's OTP, or start fingerprint consent."""

    def post(self, request, patient_id):
        patient = _patient(patient_id)
        data = request.data

        def run():
            branch = _sha_branch(patient, data.get("branch"))
            episode = None
            if data.get("episode"):
                from apps.care_pathway.models import EpisodeOfCare

                episode = EpisodeOfCare.objects.filter(pk=data["episode"], patient=patient).first()
            if data.get("consent_method") == "BIOMETRIC":
                return sha_claims.start_biometric_consent(
                    patient,
                    branch,
                    request.user,
                    data.get("service_type"),
                    data.get("intervention_codes") or [],
                    agent_id=data.get("agent_id") or "",
                    work_station_id=data.get("work_station_id") or "",
                    device_os=data.get("device_os") or "windows",
                    episode=episode,
                )
            return sha_claims.open_visit_with_otp(
                patient,
                branch,
                request.user,
                data.get("service_type"),
                data.get("intervention_codes") or [],
                data.get("otp"),
                episode=episode,
            )

        return self._run(patient, run, status.HTTP_201_CREATED)


class ClientShaWhitelistView(_FinanceView):
    def post(self, request, patient_id):
        patient = _patient(patient_id)
        return self._run(
            patient,
            lambda: sha_claims.request_otp_whitelist(
                patient,
                _sha_branch(patient, request.data.get("branch")),
                request.user,
                request.data.get("reason_type"),
                request.data.get("reason", ""),
                request.data.get("biometric_attempts") or 0,
            ),
        )


class ShaVisitActionView(_FinanceView):
    """refresh (poll fingerprint consent) · cancel (clear a stuck one) · close."""

    def post(self, request, pk, action_name):
        visit = get_object_or_404(ShaVisit.objects.select_related("patient", "branch"), pk=pk)
        actions = {
            "refresh": lambda: sha_claims.refresh_biometric_consent(visit, request.user),
            "cancel": lambda: sha_claims.cancel_biometric_consent(visit, request.user),
            "close": lambda: sha_claims.close_visit(
                visit,
                request.user,
                request.data.get("reason_type"),
                request.data.get("reason_text", ""),
            ),
        }
        if action_name not in actions:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return self._run(visit.patient, actions[action_name])


class BillingClaimShaView(_FinanceView):
    """visit (bill against a visit) · sync (push lines, diagnoses, documents) ·
    discharge-otp · refresh (payer status + preauths) · resubmit · preview."""

    def post(self, request, pk, action_name):
        claim = get_object_or_404(
            InsuranceClaim.objects.select_related("patient", "sha_visit__branch"), pk=pk
        )
        if action_name == "preview":
            try:
                return Response({"preview": sha_claims.preview_claim(claim)})
            except ShaError as exc:
                return _refused(exc)
        if action_name == "discharge-otp":
            try:
                return Response({"message": sha_claims.send_discharge_otp(claim)})
            except ShaError as exc:
                return _refused(exc)

        def refresh():
            sha_claims.refresh_payer_status(claim, request.user)
            for line in claim.lines.select_related("pre_authorization"):
                if line.pre_authorization and line.pre_authorization.intervention_code:
                    sha_claims.refresh_preauth(line.pre_authorization, claim.sha_visit)

        def attach():
            visit = get_object_or_404(ShaVisit, pk=request.data.get("visit"))
            sha_claims.attach_visit(claim, visit, request.user)

        actions = {
            "visit": attach,
            "sync": lambda: sha_claims.sync_claim(claim, request.user),
            "refresh": refresh,
            "resubmit": lambda: sha_claims.resubmit(claim, request.user),
        }
        if action_name not in actions:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return self._run(claim.patient, actions[action_name])


class ShaRemittanceView(_FinanceView):
    """Remittance statements fetched from the HIE, kept verbatim (VERIFY:
    unpublished shape — not matched to claims)."""

    def get(self, request):
        from apps.dha_interop.models import ShaRemittanceStatement

        statements = ShaRemittanceStatement.objects.filter(
            organization_id=request.user.organization_id
        )[:50]
        return Response(
            {"statements": [sha_remittance.statement_data(s) for s in statements]}
        )

    def post(self, request):
        branch = Branch.objects.filter(
            pk=request.data.get("branch"), organization_id=request.user.organization_id
        ).first()
        try:
            if branch is None:
                raise ShaError("Choose the facility (branch).", field="branch")
            if request.data.get("bank_reference"):
                statement = sha_remittance.fetch_paid_claims(
                    branch, request.user, request.data.get("bank_reference")
                )
            else:
                statement = sha_remittance.fetch_remittances(branch, request.user)
        except ShaError as exc:
            return _refused(exc)
        return Response(sha_remittance.statement_data(statement), status=status.HTTP_201_CREATED)


class ShaCallbackReceiverView(APIView):
    """
    Public endpoint the HIE posts status callbacks to. Authenticated by the
    unguessable path token (auth_type "none" — status-callbacks.md). Stores
    the event durably and returns 2xx immediately; the event is applied after
    commit ("Acknowledge as soon as you have durably accepted the payload").
    """

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = []

    def post(self, request, token, entity):
        if not sha_callbacks.token_matches(token):
            return Response(status=status.HTTP_404_NOT_FOUND)
        try:
            event, created = sha_callbacks.record_event(request.data, entity)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if created:
            from .tasks import apply_sha_callback

            transaction.on_commit(lambda: apply_sha_callback.delay(str(event.id)))
        return Response({"received": True})
