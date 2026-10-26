"""Legal admission status endpoints (master prompt §7A). Logic is in legal_status.py."""

from django.http import FileResponse, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from . import legal_config, legal_print, legal_status
from .legal_models import DischargeNotice, LegalDocument, LegalStatus
from .models import CareTask
from .views import _is_org_admin, _patient


class ClientLegalStatusView(APIView):
    def get(self, request, patient_id):
        return Response(legal_status.workspace(_patient(patient_id), request.user))


class LegalApplicationView(APIView):
    def post(self, request, patient_id):
        doc = legal_status.start_application(_patient(patient_id), request.user, request.data.get("category"))
        return Response(legal_status.document_row(doc), status=status.HTTP_201_CREATED)


class LegalDocumentView(APIView):
    def put(self, request, pk):
        doc = legal_status.save_draft(get_object_or_404(LegalDocument, pk=pk), request.user, request.data)
        return Response(legal_status.document_row(doc))


class LegalDocumentSignView(APIView):
    def post(self, request, pk):
        doc = legal_status.sign(get_object_or_404(LegalDocument, pk=pk), request.user, request.data)
        return Response(legal_status.document_row(doc))


class LegalDocumentAmendView(APIView):
    def post(self, request, pk):
        doc = legal_status.amend(get_object_or_404(LegalDocument, pk=pk), request.user, request.data.get("reason", ""))
        return Response(legal_status.document_row(doc), status=status.HTTP_201_CREATED)


class LegalRecommendationView(APIView):
    def post(self, request, pk):
        doc = legal_status.start_recommendation(get_object_or_404(LegalDocument, pk=pk), request.user)
        return Response(legal_status.document_row(doc), status=status.HTTP_201_CREATED)


class LegalDocumentPrintView(APIView):
    def get(self, request, pk):
        doc = get_object_or_404(LegalDocument.objects.select_related("legal_status", "patient"), pk=pk)
        from apps.sysadmin_audit.audit import log_view

        log_view(doc)
        return HttpResponse(legal_print.render(doc, request.user), content_type="text/html; charset=utf-8")


class LegalDecisionView(APIView):
    def post(self, request, pk):
        ls = legal_status.decide(get_object_or_404(LegalStatus, pk=pk), request.user,
                                 request.data.get("decision"), request.data.get("reason", ""))
        return Response(legal_status.banner_summary(ls.patient))


class LegalEndView(APIView):
    def post(self, request, pk):
        ls = legal_status.end_involuntary(get_object_or_404(LegalStatus, pk=pk), request.user, request.data.get("reason", ""))
        return Response(legal_status.banner_summary(ls.patient))


class LegalNoticeView(APIView):
    def post(self, request, pk):
        notice = legal_status.give_notice(get_object_or_404(LegalStatus, pk=pk), request.user, request.data)
        return Response({"id": str(notice.pk), "earliest_departure_at": notice.earliest_departure_at.isoformat()},
                        status=status.HTTP_201_CREATED)


class LegalNoticeWithdrawView(APIView):
    def post(self, request, pk):
        notice = legal_status.withdraw_notice(get_object_or_404(DischargeNotice, pk=pk), request.user)
        return Response({"id": str(notice.pk), "withdrawn_at": notice.withdrawn_at.isoformat()})


class LegalNoticeDepartView(APIView):
    def post(self, request, pk):
        out = legal_status.record_departure(get_object_or_404(DischargeNotice, pk=pk), request.user)
        return Response({"admission_id": out["admission_id"], "against_medical_advice": out["against_medical_advice"]})


class LegalTaskCompleteView(APIView):
    def post(self, request, pk):
        task = legal_status.complete_task(get_object_or_404(CareTask, pk=pk), request.user)
        return Response({"id": str(task.pk), "completed_at": task.completed_at.isoformat()})


class LegalIdentityView(APIView):
    """LGL-DOC-06: one unmasked identity number, for an authorised role; logged."""

    def get(self, request, pk):
        ls = get_object_or_404(LegalStatus, pk=pk)
        value = legal_status.unmask(ls, request.user, request.query_params.get("subject"),
                                    request.query_params.get("related_person_id"))
        return Response({"value": value})


class LegalTemplatesView(APIView):
    """The three DOC-CAT category 13 templates with their DOC-SPEC (LGL-DOC-01)."""

    def get(self, request):
        return Response({"version": legal_config.version(), "results": legal_config.document_templates()})


def _apply_nacada(cred, data, user, now):
    """NACADA accreditation / licence. A changed number needs verifying again."""
    from django.utils.dateparse import parse_date

    nacada = data.get("nacada")
    if not isinstance(nacada, dict):
        return
    if "number" in nacada:
        number = str(nacada.get("number") or "").strip()[:64]
        if number != cred.nacada_number:
            cred.nacada_number, cred.nacada_verified_at, cred.nacada_verified_by = number, None, None
    if "category" in nacada:
        cred.nacada_category = str(nacada.get("category") or "").strip()[:150]
    for key in ("issued_on", "expires_on"):
        if key in nacada:
            raw = nacada.get(key)
            value = parse_date(raw) if raw else None
            if raw and value is None:
                raise ValidationError({f"nacada.{key}": "Use a date (YYYY-MM-DD)."})
            setattr(cred, f"nacada_{key}", value)
    if cred.nacada_issued_on and cred.nacada_expires_on and cred.nacada_expires_on <= cred.nacada_issued_on:
        raise ValidationError({"nacada.expires_on": "Must be after the issue date."})
    if nacada.get("verified") is True:
        if not cred.nacada_number:
            raise ValidationError({"nacada.number": "Record the NACADA number before verifying it."})
        cred.nacada_verified_at, cred.nacada_verified_by = now, user
    elif nacada.get("verified") is False:
        cred.nacada_verified_at, cred.nacada_verified_by = None, None


class NacadaEvidenceView(APIView):
    """The NACADA certificate: Org Admin uploads (POST, `file`); Org Admin or its holder downloads (GET)."""

    parser_classes = [MultiPartParser]

    def get(self, request, user_id):
        from apps.accounts.models import PractitionerCredential

        target = PractitionerCredentialView()._target(request, user_id)
        if target.pk != request.user.pk and not _is_org_admin(request.user):
            raise PermissionDenied("Only an organisation administrator can view another practitioner's credential.")
        cred = PractitionerCredential.objects.filter(user=target).first()
        if cred is None or not cred.nacada_evidence:
            raise NotFound("No NACADA certificate uploaded.")
        return FileResponse(cred.nacada_evidence.open("rb"), as_attachment=False,
                            filename=cred.nacada_evidence.name.rsplit("/", 1)[-1])

    def post(self, request, user_id):
        from apps.accounts.models import PractitionerCredential

        if not _is_org_admin(request.user) or request.user.is_superuser:
            raise PermissionDenied("Only an organisation administrator can record practitioner credentials.")
        target = PractitionerCredentialView()._target(request, user_id)
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"file": "Choose the certificate to upload."})
        if upload.size > 10 * 1024 * 1024:
            raise ValidationError({"file": "The certificate must be 10 MB or smaller."})
        if not upload.name.lower().endswith((".pdf", ".png", ".jpg", ".jpeg")):
            raise ValidationError({"file": "Upload a PDF, PNG or JPEG."})
        cred, _ = PractitionerCredential.objects.get_or_create(user=target, defaults={"organization_id": target.organization_id})
        cred.nacada_evidence = upload
        cred.save(update_fields=["nacada_evidence", "updated_at"])
        return Response(legal_status.credential_status(target))


class PractitionerCredentialView(APIView):
    """Org Admin records/verifies a practitioner's registration and the
    MHA_RECOMMENDATION_APPROVED flag (LGL-R-02). Anyone may read their own."""

    def _target(self, request, user_id):
        from apps.accounts.models import User

        target = get_object_or_404(User, pk=user_id)
        if target.organization_id != request.user.organization_id and not request.user.is_superuser:
            raise PermissionDenied("Not in your organisation.")
        return target

    def get(self, request, user_id):
        target = self._target(request, user_id)
        if target.pk != request.user.pk and not _is_org_admin(request.user):
            raise PermissionDenied("Only an organisation administrator can view another practitioner's credential.")
        return Response(legal_status.credential_status(target))

    def put(self, request, user_id):
        from apps.accounts.models import PractitionerCredential

        if not _is_org_admin(request.user) or request.user.is_superuser:
            raise PermissionDenied("Only an organisation administrator can record practitioner credentials.")
        target = self._target(request, user_id)
        cred, _ = PractitionerCredential.objects.get_or_create(user=target, defaults={"organization_id": target.organization_id})
        data, now = request.data, timezone.now()
        number = str(data.get("registration_number", cred.registration_number) or "").strip()
        if number != cred.registration_number:
            cred.registration_number, cred.registration_verified_at, cred.registration_verified_by = number, None, None
            # The registry record described the old number.
            cred.hwr_record, cred.hwr_checked_at = {}, None
        if "hwr_regulator" in data:
            regulator = str(data.get("hwr_regulator") or "").strip()
            if regulator and regulator not in dict(PractitionerCredential.HWR_REGULATOR_CHOICES):
                raise ValidationError({"hwr_regulator": "The Health Worker Registry accepts KMPDC, COC, NCK or PPB."})
            if regulator != cred.hwr_regulator:
                cred.hwr_regulator, cred.hwr_record, cred.hwr_checked_at = regulator, {}, None
        if "hwr_puid" in data:
            cred.hwr_puid = str(data.get("hwr_puid") or "").strip()[:64]
        for field in ("registration_body", "qualifications"):
            if field in data:
                setattr(cred, field, str(data.get(field) or "").strip()[:255])
        _apply_nacada(cred, data, request.user, now)
        if data.get("registration_verified") is True:
            if not cred.registration_number:
                raise ValidationError({"registration_number": "Record the registration number before verifying it."})
            cred.registration_verified_at, cred.registration_verified_by = now, request.user
        elif data.get("registration_verified") is False:
            cred.registration_verified_at, cred.registration_verified_by = None, None
        if "mha_recommendation_approved" in data:
            approved = bool(data["mha_recommendation_approved"])
            if approved != cred.mha_recommendation_approved:
                cred.mha_recommendation_approved = approved
                cred.mha_approved_at, cred.mha_approved_by = (now, request.user) if approved else (None, None)
        cred.save()
        if data.get("check_registry") is True:
            from apps.dha_interop.registries import RegistryError, verify_practitioner

            try:
                verify_practitioner(cred)
            except RegistryError as exc:
                raise ValidationError({exc.field or "health_worker_registry": exc.message}) from None
        return Response(legal_status.credential_status(target))
