from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from config.errors import error_response

from . import shr
from .models import IcdCodeIndex, LoincCodeIndex, NationalDrugIndex, ShrConsent
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


# ── National Shared Health Record (apps.dha_interop.shr) ──


def _care_team_only(user, patient):
    from apps.mhp_program.permissions import has_full_mhp_access

    if not has_full_mhp_access(user, patient):
        raise PermissionDenied(
            "Only the client's care team can request, send or read their national health record."
        )


def _refused(exc):
    return error_response(
        "shr_refused",
        exc.message,
        status.HTTP_400_BAD_REQUEST,
        fields={exc.field: [exc.message]} if exc.field else None,
    )


class PatientShrView(APIView):
    """GET: the client's SHR visits. POST: request patient consent for a visit."""

    def _patient(self, request, patient_id):
        from apps.client_registry.models import Patient

        patient = get_object_or_404(Patient, pk=patient_id)
        _care_team_only(request.user, patient)
        return patient

    def get(self, request, patient_id):
        patient = self._patient(request, patient_id)
        consents = ShrConsent.objects.filter(patient=patient).select_related("branch")[:20]
        return Response({"consents": [shr.consent_data(c) for c in consents]})

    def post(self, request, patient_id):
        from apps.care_pathway.models import EpisodeOfCare
        from apps.tenancy.models import Branch

        patient = self._patient(request, patient_id)
        data = request.data
        branch = Branch.objects.filter(
            pk=data.get("branch"), organization_id=patient.organization_id, is_active=True
        ).first()
        episode = EpisodeOfCare.objects.filter(pk=data.get("episode"), patient=patient).first()
        try:
            if branch is None:
                raise shr.ShrError("Choose the facility (branch).", field="branch")
            if episode is None:
                raise shr.ShrError("Choose the episode of care this visit belongs to.", field="episode")
            consent = shr.request_consent(
                patient,
                branch,
                episode,
                request.user,
                data.get("visit_type"),
                emergency=bool(data.get("emergency")),
                incapacity_reason=data.get("incapacity_reason") or "",
                representative_cr_id=data.get("representative_cr_id") or "",
                representative_relationship=data.get("representative_relationship") or "",
                patient_capable=data.get("patient_capable", True) is not False,
            )
        except shr.ShrError as exc:
            return _refused(exc)
        return Response(shr.consent_data(consent), status=status.HTTP_201_CREATED)


class ShrConsentActionView(APIView):
    """verify · refuse · resend-otp · refresh · close · preview · send · records"""

    def post(self, request, pk, action_name):
        consent = get_object_or_404(
            ShrConsent.objects.select_related("patient", "branch", "episode"), pk=pk
        )
        _care_team_only(request.user, consent.patient)
        data = request.data
        try:
            if action_name == "verify":
                consent = shr.verify_consent(consent, request.user, otp=data.get("otp") or "")
            elif action_name == "refuse":
                consent = shr.verify_consent(
                    consent,
                    request.user,
                    otp=data.get("otp") or "",
                    approve=False,
                    rejection_reason=data.get("rejection_reason") or "",
                )
            elif action_name == "resend-otp":
                consent = shr.resend_otp(consent)
            elif action_name == "refresh":
                consent = shr.refresh_token(consent)
            elif action_name == "close":
                consent = shr.close_visit(
                    consent,
                    request.user,
                    patient_incapable=bool(data.get("patient_incapable")),
                    incapacity_reason=data.get("incapacity_reason") or "",
                )
            elif action_name == "preview":
                return Response(shr.preview(consent))
            elif action_name == "send":
                shr.send_visit(consent, request.user)
            elif action_name == "records":
                return Response(
                    {"records": shr.read_records(consent, request.user, data.get("resources") or [])}
                )
            else:
                return Response(status=status.HTTP_404_NOT_FOUND)
        except shr.ShrError as exc:
            return _refused(exc)
        consent.refresh_from_db()
        return Response(shr.consent_data(consent))
