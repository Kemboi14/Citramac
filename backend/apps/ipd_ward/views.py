from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Admission, Bed, MedicationAdministration, NursingNote, Ward
from .serializers import (
    AdmissionSerializer,
    BedSerializer,
    MedicationAdministrationSerializer,
    NursingNoteSerializer,
    WardSerializer,
)


class WardViewSet(viewsets.ModelViewSet):
    serializer_class = WardSerializer

    def get_queryset(self):
        # Not `queryset = Ward.objects.all()` as a class attribute — that
        # would bind the tenant-scoped manager's filter at import time
        # (before any request context exists), returning nothing forever.
        return Ward.objects.order_by("name")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)


class BedViewSet(viewsets.ModelViewSet):
    serializer_class = BedSerializer

    def get_queryset(self):
        return Bed.objects.select_related("ward").order_by("ward__name", "bed_number")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)


class AdmissionViewSet(viewsets.ModelViewSet):
    """ADT — docs/07-CLINICAL-MODULES-SPEC.md §7.7."""

    serializer_class = AdmissionSerializer

    def get_queryset(self):
        return Admission.objects.select_related("patient", "bed", "encounter").order_by(
            "-admitted_at"
        )

    def perform_create(self, serializer):
        admission = serializer.save(
            organization=self.request.user.organization, admitted_by=self.request.user
        )
        admission.bed.status = "OCCUPIED"
        admission.bed.save(update_fields=["status"])

    @action(detail=True, methods=["post"])
    def discharge(self, request, pk=None):
        """Discharge planning — auto-compiled summary text supplied by the caller."""
        admission = self.get_object()
        admission.status = "DISCHARGED"
        admission.discharged_at = timezone.now()
        admission.discharge_summary = request.data.get(
            "discharge_summary", admission.discharge_summary
        )
        admission.follow_up_date = request.data.get("follow_up_date", admission.follow_up_date)
        admission.save(
            update_fields=["status", "discharged_at", "discharge_summary", "follow_up_date"]
        )
        admission.bed.status = "AVAILABLE"
        admission.bed.save(update_fields=["status"])
        return Response(AdmissionSerializer(admission).data)

    @action(detail=True, methods=["post"])
    def transfer(self, request, pk=None):
        admission = self.get_object()
        new_bed = Bed.objects.get(pk=request.data["bed"])
        old_bed = admission.bed
        admission.bed = new_bed
        admission.status = "TRANSFERRED"
        admission.save(update_fields=["bed", "status"])
        old_bed.status = "AVAILABLE"
        old_bed.save(update_fields=["status"])
        new_bed.status = "OCCUPIED"
        new_bed.save(update_fields=["status"])
        return Response(AdmissionSerializer(admission).data)


class MedicationAdministrationViewSet(viewsets.ModelViewSet):
    serializer_class = MedicationAdministrationSerializer

    def get_queryset(self):
        return MedicationAdministration.objects.select_related("admission").order_by(
            "scheduled_time"
        )

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)

    @action(detail=True, methods=["post"])
    def administer(self, request, pk=None):
        """Digital MAR checklist confirmation — docs/07-CLINICAL-MODULES-SPEC.md §7.7."""
        entry = self.get_object()
        entry.status = request.data.get("status", "ADMINISTERED")
        entry.administered_by = request.user
        entry.administered_at = timezone.now()
        entry.notes = request.data.get("notes", entry.notes)
        entry.save(update_fields=["status", "administered_by", "administered_at", "notes"])
        return Response(MedicationAdministrationSerializer(entry).data)


class NursingNoteViewSet(viewsets.ModelViewSet):
    serializer_class = NursingNoteSerializer

    def get_queryset(self):
        return NursingNote.objects.select_related("admission").order_by("-recorded_at")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, author=self.request.user)
