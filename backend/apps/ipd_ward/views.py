from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts.permissions import _has_org_admin_role
from apps.retention.mixins import NoHardDeleteMixin
from apps.sysadmin_audit.mixins import AuditedReadMixin

from .models import Admission, Bed, MedicationAdministration, NursingNote, Ward
from .serializers import (
    AdmissionSerializer,
    BedSerializer,
    MedicationAdministrationSerializer,
    NursingNoteSerializer,
    WardSerializer,
)


def _require_org_admin_for_layout_change(request, changed_fields, what):
    """Renaming a ward or bed, or moving a bed, is facility administration —
    the Org Admin's (apps.accounts.catalogue). Every save is audited with its
    before/after values by apps.sysadmin_audit's signals."""
    if changed_fields and not _has_org_admin_role(request.user):
        raise PermissionDenied(
            f"Only an Org Admin can change {what} details.", code="org_admin_required"
        )


class WardViewSet(viewsets.ModelViewSet):
    serializer_class = WardSerializer

    def perform_update(self, serializer):
        _require_org_admin_for_layout_change(
            self.request, set(serializer.validated_data) & {"name", "ward_type", "branch"}, "ward"
        )
        serializer.save()

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

    def perform_update(self, serializer):
        # Status (vacant / reserved / maintenance) stays with ward staff, as
        # before; the bed's number and ward are Org Admin changes.
        _require_org_admin_for_layout_change(
            self.request, set(serializer.validated_data) & {"bed_number", "ward"}, "bed"
        )
        serializer.save()

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


class AdmissionViewSet(AuditedReadMixin, NoHardDeleteMixin, viewsets.ModelViewSet):
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

    @transaction.atomic
    def perform_create(self, serializer):
        from apps.care_pathway.models import BillingService, ChargeItem
        from apps.care_pathway.services import get_or_open_episode
        from apps.clinical_encounter.models import Encounter

        patient = serializer.validated_data["patient"]
        user = self.request.user
        _take_bed(serializer.validated_data.get("bed"))
        if Admission.objects.filter(
            patient=patient, status__in=("ADMITTED", "TRANSFERRED")
        ).exists():
            raise ValidationError({"patient": "This client is already admitted."})
        # The admission is an Encounter (class IMP) inside the client's
        # EpisodeOfCare — CLAUDE.md §4, docs/15-CLINICAL-WORKSPACE-V3.md §1.10.
        episode = get_or_open_episode(patient, user)
        admitted_at = serializer.validated_data.get("admitted_at") or timezone.now()
        encounter = serializer.validated_data.get("encounter") or Encounter.objects.create(
            organization=user.organization,
            patient=patient,
            episode=episode,
            opened_by=user,
            encounter_type="INPATIENT",
            status="IN_PROGRESS",
            opened_at=admitted_at,
        )
        admission = serializer.save(
            organization=user.organization,
            admitted_by=user,
            episode=episode,
            encounter=encounter,
        )
        admission.bed.status = "OCCUPIED"
        admission.bed.save(update_fields=["status"])
        if episode.status in ("planned", "waitlist"):
            episode.transition("active", user=user, at=admitted_at)
        # The admission is a documented delivered service; priced from the
        # facility tariff, or recorded unpriced when no rate is configured.
        service = BillingService.objects.filter(name="Admission", active=True).first()
        if service:
            ChargeItem.objects.create(
                organization=user.organization,
                patient=patient,
                episode=episode,
                service=service,
                quantity=1,
                unit_price=service.rate,
                delivered_at=admitted_at,
                created_by=user,
            )

    @action(detail=False, methods=["get"], url_path="eligible-patients")
    def eligible_patients(self, request):
        """
        Inpatient-category clients without a currently active admission —
        the pool a new Voluntary/Involuntary Admission can be started against
        (mockup's "Voluntary/Involuntary Admissions" records screen).
        """
        from apps.client_registry.models import Patient
        from apps.client_registry.serializers import PatientListSerializer

        admitted_patient_ids = Admission.objects.filter(
            status__in=("ADMITTED", "TRANSFERRED")
        ).values_list("patient_id", flat=True)
        # An archived record can't be admitted into until it is restored.
        patients = Patient.objects.filter(archived_at__isnull=True).exclude(
            id__in=admitted_patient_ids
        )
        # `?all=true` — the v3 admission form (docs/15 §1.10) admits any
        # registered client; the older screen keeps the Inpatient-category pool.
        if request.query_params.get("all") != "true":
            patients = patients.filter(patient_category="INPATIENT")
        return Response(PatientListSerializer(patients, many=True).data)

    @action(detail=True, methods=["get"])
    def fhir(self, request, pk=None):
        """FHIR Bundle (Encounter + Consent/RiskAssessment) for this admission."""
        from apps.dha_interop.fhir_mapper import build_admission_bundle

        admission = self.get_object()
        return Response(build_admission_bundle(admission))

    @action(detail=True, methods=["post"])
    def discharge(self, request, pk=None):
        """Retired. A discharge is a signed, versioned clinical record, recorded in
        Discharge planning (`POST /care/admissions/<id>/discharge/sign/`) — never as
        free text copied onto the admission, which could be overwritten later."""
        from rest_framework.exceptions import ValidationError

        raise ValidationError(
            {
                "detail": "Discharge is recorded in Discharge planning, where it is signed "
                "and kept as a versioned record. Open Discharge planning for this client."
            }
        )

    def perform_update(self, serializer):
        # A bed changes only by transfer, which frees the old bed and checks
        # the new one is free.
        bed = serializer.validated_data.get("bed")
        if bed is not None and bed.pk != serializer.instance.bed_id:
            raise ValidationError({"bed": "Move the client with a transfer."})
        serializer.save()

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def transfer(self, request, pk=None):
        admission = self.get_object()
        if admission.status not in ("ADMITTED", "TRANSFERRED"):
            raise ValidationError({"detail": "Only a current admission can be transferred."})
        new_bed = (
            Bed.objects.filter(pk=request.data.get("bed")).first()
            if _is_uuid(request.data.get("bed"))
            else None
        )
        if new_bed is None:
            raise ValidationError({"bed": "Choose the bed to move to."})
        if new_bed.pk == admission.bed_id:
            raise ValidationError({"bed": "The client is already in this bed."})
        _take_bed(new_bed)
        old_bed = admission.bed
        admission.bed = new_bed
        admission.status = "TRANSFERRED"
        admission.save(update_fields=["bed", "status"])
        old_bed.status = "AVAILABLE"
        old_bed.save(update_fields=["status"])
        new_bed.status = "OCCUPIED"
        new_bed.save(update_fields=["status"])
        return Response(AdmissionSerializer(admission).data)


def _is_uuid(value):
    import uuid

    try:
        uuid.UUID(str(value))
    except (TypeError, ValueError):
        return False
    return True


def _take_bed(bed):
    """Lock the bed and make sure nobody else is in it before it is given."""
    if bed is None:
        return
    locked = Bed.objects.select_for_update().get(pk=bed.pk)
    if locked.status != "AVAILABLE":
        raise ValidationError(
            {"bed": f"Bed {locked.bed_number} is {locked.get_status_display().lower()}."}
        )


class MedicationAdministrationViewSet(AuditedReadMixin, NoHardDeleteMixin, viewsets.ModelViewSet):
    serializer_class = MedicationAdministrationSerializer
    # A recorded dose is never edited in place: status, who gave it and when
    # are set only by `administer` (the same checks as the client record's MAR).
    http_method_names = ["get", "post", "head", "options"]

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
        from apps.care_pathway.interventions import record_administration

        entry = self.get_object()
        # The same rules as the client record's MAR (care_pathway.interventions):
        # one recording per dose, a reason to decline or withhold, a witness for
        # a controlled drug, an indication and the 24 h limit for PRN.
        entry = record_administration(
            entry,
            request.user,
            request.data.get("status", "ADMINISTERED"),
            notes=request.data.get("notes", ""),
            indication=request.data.get("prn_indication", ""),
            witness=request.data.get("witness_name", ""),
            override_reason=request.data.get("override_reason", ""),
        )
        return Response(MedicationAdministrationSerializer(entry).data)


class NursingNoteViewSet(AuditedReadMixin, NoHardDeleteMixin, viewsets.ModelViewSet):
    serializer_class = NursingNoteSerializer

    def get_queryset(self):
        queryset = NursingNote.objects.select_related("admission").order_by("-recorded_at")
        admission = self.request.query_params.get("admission")
        if admission:
            queryset = queryset.filter(admission_id=admission)
        return queryset

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, author=self.request.user)
