from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.retention.mixins import NoHardDeleteMixin
from apps.sysadmin_audit.mixins import AuditedReadMixin

from .models import DiagnosisCode, Encounter
from .serializers import DiagnosisCodeSerializer, EncounterSerializer

ERROR_STATUS = "ENTERED_IN_ERROR"


def _error_reason(request):
    reason = str(request.data.get("reason") or "").strip()
    if len(reason) < 5:
        raise ValidationError({"reason": "Say why this was entered in error."})
    return reason


def _audit_error(instance, reason, extra=None):
    from apps.sysadmin_audit.audit import write_event
    from apps.sysadmin_audit.models import AuditLogEntry

    write_event(
        instance.organization_id,
        AuditLogEntry.ACTION_UPDATE,
        f"{instance._meta.app_label}.{instance._meta.model_name}",
        instance.pk,
        {"entered_in_error": reason, **(extra or {})},
    )


# The only type a client may open through this endpoint. Triage, intake,
# psychiatry, psychotherapy and inpatient encounters are opened by their own
# workflows (care_pathway, ipd_ward), which set the type themselves.
API_OPENABLE_TYPES = ("OUTPATIENT",)


class EncounterViewSet(
    AuditedReadMixin,
    NoHardDeleteMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    """Encounter = R4 Encounter. Every one hangs off the client's EpisodeOfCare
    (CLAUDE.md §4): an outpatient visit opened here joins the open episode, or
    opens one. Who it is about, its type and its episode never change after it is
    opened — the SHR export decides what may leave the facility from them."""

    serializer_class = EncounterSerializer

    def get_queryset(self):
        queryset = Encounter.objects.select_related("patient").order_by("-opened_at")
        patient = self.request.query_params.get("patient")
        if patient:
            queryset = queryset.filter(patient_id=patient)
        return queryset

    def perform_create(self, serializer):
        from apps.care_pathway.services import get_or_open_episode

        encounter_type = serializer.validated_data.get("encounter_type") or "OUTPATIENT"
        if encounter_type not in API_OPENABLE_TYPES:
            raise ValidationError(
                {"encounter_type": "Only an outpatient visit can be opened here."}
            )
        patient = serializer.validated_data["patient"]
        serializer.save(
            organization=self.request.user.organization,
            opened_by=self.request.user,
            encounter_type=encounter_type,
            episode=get_or_open_episode(patient, self.request.user),
        )

    @action(detail=True, methods=["post"], url_path="entered-in-error")
    def entered_in_error(self, request, pk=None):
        """The only correction for an encounter opened against the wrong client (its
        subject can't change): R4 entered-in-error, with a reason, audited. Its
        diagnoses go with it — they were recorded against the same mistake."""
        from django.db import transaction

        encounter = self.get_object()
        if encounter.status == ERROR_STATUS:
            raise ValidationError({"detail": "Already marked as entered in error."})
        reason = _error_reason(request)
        with transaction.atomic():
            encounter.status = ERROR_STATUS
            encounter.error_reason = reason
            encounter.closed_at = encounter.closed_at or timezone.now()
            encounter.save(update_fields=["status", "error_reason", "closed_at"])
            diagnoses = list(encounter.diagnoses.exclude(verification_status=ERROR_STATUS))
            for diagnosis in diagnoses:
                diagnosis.verification_status = ERROR_STATUS
                diagnosis.error_reason = reason
                diagnosis.save(update_fields=["verification_status", "error_reason"])
            _audit_error(encounter, reason, {"diagnoses": [str(d.pk) for d in diagnoses]})
        return Response(EncounterSerializer(encounter).data)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        encounter = self.get_object()
        if encounter.status == ERROR_STATUS:
            raise ValidationError({"detail": "This encounter was entered in error."})
        if encounter.status != "CLOSED":
            encounter.status = "CLOSED"
            encounter.closed_at = timezone.now()
            encounter.save(update_fields=["status", "closed_at"])
        return Response(EncounterSerializer(encounter).data, status=status.HTTP_200_OK)


class DiagnosisCodeViewSet(AuditedReadMixin, NoHardDeleteMixin, viewsets.ModelViewSet):
    """Diagnoses (R4 Condition), patient- or encounter-scoped. The encounter and
    the ICD-11 code are fixed once recorded; status and certainty may change."""

    serializer_class = DiagnosisCodeSerializer

    def get_queryset(self):
        queryset = DiagnosisCode.objects.select_related("icd11_code", "encounter").order_by(
            "-noted_at"
        )
        params = self.request.query_params
        if params.get("patient"):
            queryset = queryset.filter(encounter__patient_id=params["patient"])
        if params.get("encounter"):
            queryset = queryset.filter(encounter_id=params["encounter"])
        return queryset

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, recorded_by=self.request.user)

    @action(detail=True, methods=["post"], url_path="entered-in-error")
    def entered_in_error(self, request, pk=None):
        """Recorded against the wrong client or with the wrong code — not a clinical
        judgement (that is "ruled out"). R4 entered-in-error, with a reason, audited."""
        diagnosis = self.get_object()
        if diagnosis.verification_status == ERROR_STATUS:
            raise ValidationError({"detail": "Already marked as entered in error."})
        reason = _error_reason(request)
        diagnosis.verification_status = ERROR_STATUS
        diagnosis.error_reason = reason
        diagnosis.save(update_fields=["verification_status", "error_reason"])
        _audit_error(diagnosis, reason)
        return Response(DiagnosisCodeSerializer(diagnosis).data)
