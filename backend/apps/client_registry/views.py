from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import (
    Appointment,
    Patient,
)
from .serializers import (
    AllergyRecordSerializer,
    AppointmentSerializer,
    AttachmentSerializer,
    EmergencyContactSerializer,
    InsuranceCoverageSerializer,
    PatientDetailSerializer,
    PatientListSerializer,
)


def _generate_citramac_number(organization):
    prefix = f"{timezone.now():%Y%m}{organization.slug[:4].upper()}"
    count_this_month = Patient.objects.filter(citramac_number__startswith=prefix).count()
    return f"{prefix}-{count_this_month + 1:03d}"


class PatientViewSet(viewsets.ModelViewSet):
    """docs/10-API-SPECIFICATION.md §10.4 — Module 1."""

    def get_serializer_class(self):
        return PatientListSerializer if self.action == "list" else PatientDetailSerializer

    def get_queryset(self):
        return Patient.objects.select_related("doctor").order_by("-registered_at")

    def perform_create(self, serializer):
        serializer.save(
            organization=self.request.user.organization,
            registered_by=self.request.user,
            citramac_number=_generate_citramac_number(self.request.user.organization),
        )

    @action(detail=True, methods=["post"], url_path="verify-iprs")
    def verify_iprs(self, request, pk=None):
        """
        Stub — real IPRS national registry lookup lands with the full
        DHA/SHA integration in Phase 6 (docs/08-DHA-SHA-INTEGRATION.md §8.3.4).
        """
        patient = self.get_object()
        return Response(
            {
                "verified": False,
                "detail": "IPRS integration is a Phase 6 stub — no live registry call made.",
                "patient_id": str(patient.id),
            }
        )

    @action(detail=True, methods=["get", "post"], url_path="emergency-contacts")
    def emergency_contacts(self, request, pk=None):
        patient = self.get_object()
        if request.method == "POST":
            serializer = EmergencyContactSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(patient=patient, organization=patient.organization)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        contacts = patient.emergency_contacts.all()
        return Response(EmergencyContactSerializer(contacts, many=True).data)

    @action(detail=True, methods=["get", "post"], url_path="insurance-coverage")
    def insurance_coverage(self, request, pk=None):
        patient = self.get_object()
        if request.method == "POST":
            serializer = InsuranceCoverageSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(patient=patient, organization=patient.organization)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        coverages = patient.insurance_coverages.all()
        return Response(InsuranceCoverageSerializer(coverages, many=True).data)

    @action(detail=True, methods=["post"], url_path="insurance-coverage/verify-sha")
    def verify_sha(self, request, pk=None):
        """
        Stub — real SHA member-verification API call lands in Phase 6
        (docs/08-DHA-SHA-INTEGRATION.md §8.3.1); logged to ShaTransactionLog
        once that's built. For now, marks the coverage row unverified and
        says so rather than faking a positive result.
        """
        patient = self.get_object()
        coverage = patient.insurance_coverages.order_by("-id").first()
        if not coverage:
            return Response(
                {"detail": "No insurance coverage on file."}, status=status.HTTP_404_NOT_FOUND
            )
        return Response(
            {
                "verified": False,
                "detail": "SHA gateway integration is a Phase 6 stub — no live call made.",
                "coverage_id": coverage.id,
            }
        )

    @action(detail=True, methods=["get", "post"])
    def attachments(self, request, pk=None):
        patient = self.get_object()
        if request.method == "POST":
            serializer = AttachmentSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(
                patient=patient, organization=patient.organization, uploaded_by=request.user
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(AttachmentSerializer(patient.attachments.all(), many=True).data)

    @action(detail=True, methods=["get", "post"], url_path="allergy-records")
    def allergy_records(self, request, pk=None):
        patient = self.get_object()
        if request.method == "POST":
            serializer = AllergyRecordSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save(patient=patient, organization=patient.organization)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(AllergyRecordSerializer(patient.allergy_records.all(), many=True).data)


class AppointmentViewSet(viewsets.ModelViewSet):
    serializer_class = AppointmentSerializer

    def get_queryset(self):
        return Appointment.objects.select_related("patient", "provider").order_by("-scheduled_for")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)
