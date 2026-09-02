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
        from django.db.models import Count

        queryset = Ward.objects.annotate(bed_count=Count("beds", distinct=True)).order_by("name")
        branch = self.request.query_params.get("branch")
        if branch:
            queryset = queryset.filter(branch_id=branch)
        return queryset

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Ward & Bed Management screen's legend counts (vacant/occupied/
        reserved/maintenance) and per-ward totals, in one call."""
        from django.db.models import Count

        branch = request.query_params.get("branch")
        beds = Bed.objects.all()
        if branch:
            beds = beds.filter(ward__branch_id=branch)
        by_status = {
            row["status"]: row["count"] for row in beds.values("status").annotate(count=Count("id"))
        }
        wards = self.get_queryset()
        return Response(
            {
                "beds_by_status": {
                    status: by_status.get(status, 0) for status, _ in Bed.STATUS_CHOICES
                },
                "wards": WardSerializer(wards, many=True).data,
            }
        )


class BedViewSet(viewsets.ModelViewSet):
    serializer_class = BedSerializer

    def get_queryset(self):
        queryset = (
            Bed.objects.select_related("ward")
            .prefetch_related("admissions__patient")
            .order_by("ward__name", "bed_number")
        )
        ward = self.request.query_params.get("ward")
        if ward:
            queryset = queryset.filter(ward_id=ward)
        return queryset

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)


class AdmissionViewSet(viewsets.ModelViewSet):
    """
    ADT — docs/07-CLINICAL-MODULES-SPEC.md §7.7. `admission_type` distinguishes
    voluntary (client-consented) from involuntary (Mental Health Act Cap. 248
    legal order) inpatient admission — mockups/citramac_clinical_workspace.html.
    """

    serializer_class = AdmissionSerializer

    def get_queryset(self):
        queryset = Admission.objects.select_related(
            "patient", "bed", "bed__ward", "encounter"
        ).order_by("-admitted_at")
        params = self.request.query_params
        if params.get("admission_type"):
            queryset = queryset.filter(admission_type=params["admission_type"])
        if params.get("status"):
            queryset = queryset.filter(status=params["status"])
        if params.get("patient"):
            queryset = queryset.filter(patient_id=params["patient"])
        return queryset

    def perform_create(self, serializer):
        admission = serializer.save(
            organization=self.request.user.organization, admitted_by=self.request.user
        )
        admission.bed.status = "OCCUPIED"
        admission.bed.save(update_fields=["status"])

    @action(detail=False, methods=["get"], url_path="eligible-patients")
    def eligible_patients(self, request):
        """
        Inpatient-category clients without a currently active admission —
        the pool a new Voluntary/Involuntary Admission can be started against
        (mockup's "Voluntary/Involuntary Admissions" records screen).
        """
        from apps.client_registry.models import Patient
        from apps.client_registry.serializers import PatientListSerializer

        admitted_patient_ids = Admission.objects.filter(status="ADMITTED").values_list(
            "patient_id", flat=True
        )
        patients = Patient.objects.filter(patient_category="INPATIENT").exclude(
            id__in=admitted_patient_ids
        )
        return Response(PatientListSerializer(patients, many=True).data)

    @action(detail=True, methods=["get"])
    def fhir(self, request, pk=None):
        """FHIR Bundle (Encounter + Consent/RiskAssessment) for this admission."""
        from apps.dha_interop.fhir_mapper import build_admission_bundle

        admission = self.get_object()
        return Response(build_admission_bundle(admission))

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
        queryset = MedicationAdministration.objects.select_related("admission").order_by(
            "scheduled_time"
        )
        admission = self.request.query_params.get("admission")
        if admission:
            queryset = queryset.filter(admission_id=admission)
        return queryset

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
        queryset = NursingNote.objects.select_related("admission").order_by("-recorded_at")
        admission = self.request.query_params.get("admission")
        if admission:
            queryset = queryset.filter(admission_id=admission)
        return queryset

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, author=self.request.user)
