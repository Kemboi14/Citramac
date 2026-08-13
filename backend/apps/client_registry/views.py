from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .consent import capture_consent
from .erasure import execute_erasure
from .models import (
    Appointment,
    ErasureRequest,
    Patient,
)
from .serializers import (
    AllergyRecordSerializer,
    AppointmentSerializer,
    AttachmentSerializer,
    ConsentRecordSerializer,
    EmergencyContactSerializer,
    ErasureRequestSerializer,
    InsuranceCoverageSerializer,
    PatientDetailSerializer,
    PatientListSerializer,
)


def _is_org_admin(user):
    return user.is_superuser or user.roles.filter(name="Org Admin").exists()


def _is_compliance_officer(user):
    """docs/09 §9.5's "compliance officer" sign-off maps to the Auditor role."""
    return user.is_superuser or user.roles.filter(name="Auditor").exists()


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

    @action(detail=True, methods=["get", "post"])
    def consent(self, request, pk=None):
        """
        docs/09-SECURITY-COMPLIANCE.md §9.5 — explicit, timestamped,
        revocable consent capture with the exact text version shown at
        capture time. POST to grant or revoke (both write a new history
        row rather than mutating one); GET returns the full history.
        """
        patient = self.get_object()
        if request.method == "POST":
            granted = request.data.get("granted")
            consent_text_version = request.data.get("consent_text_version")
            consent_text_snapshot = request.data.get("consent_text_snapshot")
            if granted is None or not consent_text_version or not consent_text_snapshot:
                return Response(
                    {
                        "error": {
                            "code": "MISSING_FIELDS",
                            "message": (
                                "granted, consent_text_version, and consent_text_snapshot "
                                "are all required."
                            ),
                        }
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            record = capture_consent(
                patient, request.user, granted, consent_text_version, consent_text_snapshot
            )
            return Response(ConsentRecordSerializer(record).data, status=status.HTTP_201_CREATED)
        return Response(ConsentRecordSerializer(patient.consent_records.all(), many=True).data)


class AppointmentViewSet(viewsets.ModelViewSet):
    serializer_class = AppointmentSerializer

    def get_queryset(self):
        return Appointment.objects.select_related("patient", "provider").order_by("-scheduled_for")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)


class ErasureRequestViewSet(viewsets.ModelViewSet):
    """
    Right-to-Erasure workflow — docs/09-SECURITY-COMPLIANCE.md §9.5.
    Distinct from routine soft-delete: requires Org Admin + compliance
    officer (Auditor role) sign-off, and `execute` enforces the statutory
    retention check before anonymizing the patient.
    """

    serializer_class = ErasureRequestSerializer

    def get_queryset(self):
        return ErasureRequest.objects.select_related("patient").order_by("-created_at")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, requested_by=self.request.user)

    @action(detail=True, methods=["post"], url_path="approve-org-admin")
    def approve_org_admin(self, request, pk=None):
        if not _is_org_admin(request.user):
            return Response(
                {"error": {"code": "FORBIDDEN", "message": "Requires the Org Admin role."}},
                status=status.HTTP_403_FORBIDDEN,
            )
        erasure_request = self.get_object()
        erasure_request.org_admin_approved_by = request.user
        erasure_request.org_admin_approved_at = timezone.now()
        erasure_request.save(update_fields=["org_admin_approved_by", "org_admin_approved_at"])
        return Response(ErasureRequestSerializer(erasure_request).data)

    @action(detail=True, methods=["post"], url_path="approve-compliance")
    def approve_compliance(self, request, pk=None):
        if not _is_compliance_officer(request.user):
            return Response(
                {
                    "error": {
                        "code": "FORBIDDEN",
                        "message": "Requires the Auditor/compliance role.",
                    }
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        erasure_request = self.get_object()
        erasure_request.compliance_officer_approved_by = request.user
        erasure_request.compliance_officer_approved_at = timezone.now()
        erasure_request.save(
            update_fields=["compliance_officer_approved_by", "compliance_officer_approved_at"]
        )
        return Response(ErasureRequestSerializer(erasure_request).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        if not (_is_org_admin(request.user) or _is_compliance_officer(request.user)):
            return Response(
                {"error": {"code": "FORBIDDEN", "message": "Requires Org Admin or Auditor."}},
                status=status.HTTP_403_FORBIDDEN,
            )
        erasure_request = self.get_object()
        erasure_request.status = ErasureRequest.STATUS_REJECTED
        erasure_request.rejection_reason = request.data.get("rejection_reason", "")
        erasure_request.save(update_fields=["status", "rejection_reason"])
        return Response(ErasureRequestSerializer(erasure_request).data)

    @action(detail=True, methods=["post"])
    def execute(self, request, pk=None):
        erasure_request = self.get_object()
        if not erasure_request.is_fully_approved:
            return Response(
                {
                    "error": {
                        "code": "APPROVALS_INCOMPLETE",
                        "message": "Both Org Admin and compliance officer sign-off are required.",
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        override = bool(request.data.get("override_retention_conflict", False))
        if override and not _is_compliance_officer(request.user):
            return Response(
                {
                    "error": {
                        "code": "FORBIDDEN",
                        "message": "Only the compliance officer may override a retention conflict.",
                    }
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        erasure_request = execute_erasure(erasure_request, override_retention_conflict=override)
        return Response(ErasureRequestSerializer(erasure_request).data)
