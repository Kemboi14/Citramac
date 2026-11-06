from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.retention.mixins import NoHardDeleteMixin
from apps.sysadmin_audit.mixins import AuditedReadMixin

from .models import DiagnosisCode, Encounter
from .serializers import DiagnosisCodeSerializer, EncounterSerializer

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

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        encounter = self.get_object()
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
