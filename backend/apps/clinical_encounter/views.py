from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.triage.serializers import MentalStatusExamSerializer, VitalSignsSerializer

from .models import Encounter, SoapNote
from .serializers import (
    ClinicalOrderSerializer,
    DiagnosisCodeSerializer,
    EncounterSerializer,
    PrescriptionSerializer,
    ReferralPacketSerializer,
    SoapNoteSerializer,
)


class EncounterViewSet(viewsets.ModelViewSet):
    """docs/10-API-SPECIFICATION.md §10.5 — Modules 2-3."""

    serializer_class = EncounterSerializer

    def get_queryset(self):
        return Encounter.objects.select_related("patient").order_by("-opened_at")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, opened_by=self.request.user)

    @action(detail=True, methods=["get", "post"])
    def vitals(self, request, pk=None):
        encounter = self.get_object()
        if request.method == "POST":
            serializer = VitalSignsSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(
                encounter=encounter, organization=encounter.organization, recorded_by=request.user
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(VitalSignsSerializer(encounter.vital_signs.all(), many=True).data)

    @action(detail=True, methods=["get", "post"])
    def mse(self, request, pk=None):
        encounter = self.get_object()
        if request.method == "POST":
            serializer = MentalStatusExamSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            mse = serializer.save(
                encounter=encounter, organization=encounter.organization, recorded_by=request.user
            )
            if mse.risk_escalated_to_supervisor:
                from apps.notifications.tasks import notify_supervisors_of_risk

                notify_supervisors_of_risk.delay(
                    str(encounter.organization_id),
                    str(encounter.id),
                    encounter.patient.get_full_name(),
                )
            return Response(MentalStatusExamSerializer(mse).data, status=status.HTTP_201_CREATED)
        return Response(
            MentalStatusExamSerializer(encounter.mental_status_exams.all(), many=True).data
        )

    @action(detail=True, methods=["get", "post"], url_path="soap-notes")
    def soap_notes(self, request, pk=None):
        encounter = self.get_object()
        if request.method == "POST":
            serializer = SoapNoteSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(
                encounter=encounter, organization=encounter.organization, author=request.user
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(SoapNoteSerializer(encounter.soap_notes.all(), many=True).data)

    @action(detail=True, methods=["post"], url_path="soap-notes/(?P<note_id>[^/.]+)/sign")
    def sign_soap_note(self, request, pk=None, note_id=None):
        note = SoapNote.objects.get(pk=note_id, encounter_id=pk)
        note.is_locked = True
        note.signed_at = timezone.now()
        note.save(update_fields=["is_locked", "signed_at"])
        return Response(SoapNoteSerializer(note).data)

    @action(detail=True, methods=["get", "post"])
    def diagnoses(self, request, pk=None):
        encounter = self.get_object()
        if request.method == "POST":
            serializer = DiagnosisCodeSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(encounter=encounter, organization=encounter.organization)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(DiagnosisCodeSerializer(encounter.diagnoses.all(), many=True).data)

    @action(detail=True, methods=["get", "post"])
    def orders(self, request, pk=None):
        encounter = self.get_object()
        if request.method == "POST":
            serializer = ClinicalOrderSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(
                encounter=encounter, organization=encounter.organization, ordered_by=request.user
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(ClinicalOrderSerializer(encounter.orders.all(), many=True).data)

    @action(detail=True, methods=["get", "post"])
    def prescriptions(self, request, pk=None):
        encounter = self.get_object()
        if request.method == "POST":
            serializer = PrescriptionSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(
                encounter=encounter, organization=encounter.organization, prescribed_by=request.user
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(PrescriptionSerializer(encounter.prescriptions.all(), many=True).data)

    @action(detail=True, methods=["get", "post"])
    def referrals(self, request, pk=None):
        """Generates a FHIR bundle placeholder — real construction is Phase 6 (docs/08 §8.1)."""
        encounter = self.get_object()
        if request.method == "POST":
            serializer = ReferralPacketSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(
                encounter=encounter,
                organization=encounter.organization,
                fhir_bundle_json={
                    "resourceType": "Bundle",
                    "type": "document",
                    "note": "Placeholder — real FHIR Bundle construction is a Phase 6 item.",
                },
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(ReferralPacketSerializer(encounter.referrals.all(), many=True).data)
