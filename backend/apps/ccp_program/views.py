from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.sysadmin_audit.audit import log_view

from .models import (
    BiopsychosocialAssessment,
    CareTeamMembership,
    ClinicalReview,
    NacadaNdoReport,
    PsychotherapySession,
    ReviewOfSystemEntry,
    SubstanceUseEntry,
    SudRehabPlan,
    SupervisionRequest,
    UrineDrugScreen,
)
from .permissions import has_full_ccp_access
from .serializers import (
    BiopsychosocialAssessmentRestrictedSerializer,
    BiopsychosocialAssessmentSerializer,
    CareTeamMembershipSerializer,
    CcpTeamRosterSerializer,
    ClinicalReviewSerializer,
    NacadaNdoReportSerializer,
    PsychotherapySessionRestrictedSerializer,
    PsychotherapySessionSerializer,
    ReviewOfSystemEntryRestrictedSerializer,
    ReviewOfSystemEntrySerializer,
    SubstanceUseEntryRestrictedSerializer,
    SubstanceUseEntrySerializer,
    SudRehabPlanRestrictedSerializer,
    SudRehabPlanSerializer,
    SupervisionRequestSerializer,
    UrineDrugScreenRestrictedSerializer,
    UrineDrugScreenSerializer,
)


class CareTeamRestrictedMixin:
    """
    Swaps in the restricted serializer per-object for anyone without full
    CCP access, and audit-logs the view itself whenever full sensitive
    content is actually returned — docs/09-SECURITY-COMPLIANCE.md §9.4:
    "Sensitive record views (not just edits) must also be logged."
    """

    full_serializer_class = None
    restricted_serializer_class = None
    # Most CCP records FK straight to Patient; UrineDrugScreen only has one
    # via its SudRehabPlan, so it overrides this accessor.
    patient_accessor = staticmethod(lambda obj: obj.patient)

    def get_serializer_class(self):
        return self.full_serializer_class

    def _serializer_for(self, obj, request):
        if has_full_ccp_access(request.user, self.patient_accessor(obj)):
            log_view(obj)
            return self.full_serializer_class(obj, context={"request": request})
        return self.restricted_serializer_class(obj, context={"request": request})

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        return Response(self._serializer_for(instance, request).data)

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        objects = page if page is not None else queryset
        data = [self._serializer_for(obj, request).data for obj in objects]
        if page is not None:
            return self.get_paginated_response(data)
        return Response(data)


class BiopsychosocialAssessmentViewSet(CareTeamRestrictedMixin, viewsets.ModelViewSet):
    """
    Also the "Client History" intake list/detail from
    mockups/citramac_clinical_workspace.html — filterable by `?patient=`.
    """

    full_serializer_class = BiopsychosocialAssessmentSerializer
    restricted_serializer_class = BiopsychosocialAssessmentRestrictedSerializer

    def get_queryset(self):
        queryset = (
            BiopsychosocialAssessment.objects.select_related("patient", "author")
            .prefetch_related("substance_use_entries", "review_of_systems")
            .order_by("-created_at")
        )
        patient = self.request.query_params.get("patient")
        if patient:
            queryset = queryset.filter(patient_id=patient)
        return queryset

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, author=self.request.user)


class SubstanceUseEntryViewSet(CareTeamRestrictedMixin, viewsets.ModelViewSet):
    full_serializer_class = SubstanceUseEntrySerializer
    restricted_serializer_class = SubstanceUseEntryRestrictedSerializer
    patient_accessor = staticmethod(lambda obj: obj.assessment.patient)

    def get_queryset(self):
        queryset = SubstanceUseEntry.objects.select_related("assessment__patient")
        assessment = self.request.query_params.get("assessment")
        if assessment:
            queryset = queryset.filter(assessment_id=assessment)
        return queryset

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)


class ReviewOfSystemEntryViewSet(CareTeamRestrictedMixin, viewsets.ModelViewSet):
    full_serializer_class = ReviewOfSystemEntrySerializer
    restricted_serializer_class = ReviewOfSystemEntryRestrictedSerializer
    patient_accessor = staticmethod(lambda obj: obj.assessment.patient)

    def get_queryset(self):
        queryset = ReviewOfSystemEntry.objects.select_related("assessment__patient")
        assessment = self.request.query_params.get("assessment")
        if assessment:
            queryset = queryset.filter(assessment_id=assessment)
        return queryset

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, clinician=self.request.user)


class PsychotherapySessionViewSet(CareTeamRestrictedMixin, viewsets.ModelViewSet):
    full_serializer_class = PsychotherapySessionSerializer
    restricted_serializer_class = PsychotherapySessionRestrictedSerializer

    def get_queryset(self):
        queryset = PsychotherapySession.objects.select_related("patient").order_by("-session_date")
        session_type = self.request.query_params.get("session_type")
        if session_type:
            queryset = queryset.filter(session_type=session_type)
        return queryset

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, therapist=self.request.user)


class CareTeamMembershipViewSet(viewsets.ModelViewSet):
    """Org Admin/Supervisor tool for assigning the care team — docs/07 §7.14.7."""

    serializer_class = CareTeamMembershipSerializer

    def get_queryset(self):
        return CareTeamMembership.objects.select_related("patient", "user")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)


class SudRehabPlanViewSet(CareTeamRestrictedMixin, viewsets.ModelViewSet):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.14.4."""

    full_serializer_class = SudRehabPlanSerializer
    restricted_serializer_class = SudRehabPlanRestrictedSerializer

    def get_queryset(self):
        return (
            SudRehabPlan.objects.select_related("patient")
            .prefetch_related("milestones")
            .order_by("-started_at")
        )

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, case_manager=self.request.user)


class UrineDrugScreenViewSet(CareTeamRestrictedMixin, viewsets.ModelViewSet):
    """
    docs/09-SECURITY-COMPLIANCE.md §9.3 explicitly names UrineDrugScreen
    among the records the elevated CCP privacy tier gates — panel_results
    is SUD screening data, not just metadata.
    """

    full_serializer_class = UrineDrugScreenSerializer
    restricted_serializer_class = UrineDrugScreenRestrictedSerializer
    patient_accessor = staticmethod(lambda obj: obj.plan.patient)

    def get_queryset(self):
        return UrineDrugScreen.objects.select_related("plan__patient").order_by("-collected_at")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, collected_by=self.request.user)


class ClinicalReviewViewSet(viewsets.ModelViewSet):
    """Peer/senior review workflow — docs/07-CLINICAL-MODULES-SPEC.md §7.14.5."""

    serializer_class = ClinicalReviewSerializer

    def get_queryset(self):
        return ClinicalReview.objects.select_related("patient").order_by("-requested_at")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, requested_by=self.request.user)

    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        review = self.get_object()
        decision = request.data.get("status")
        if decision not in ("APPROVED", "CHANGES_REQUESTED"):
            return Response({"error": "status must be APPROVED or CHANGES_REQUESTED"}, status=400)
        review.status = decision
        review.reviewer = request.user
        review.review_notes = request.data.get("review_notes", review.review_notes)
        review.reviewed_at = timezone.now()
        review.save(update_fields=["status", "reviewer", "review_notes", "reviewed_at"])
        return Response(ClinicalReviewSerializer(review).data)


class SupervisionRequestViewSet(viewsets.ModelViewSet):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.14.5 — mirrors the mockup's nav item."""

    serializer_class = SupervisionRequestSerializer

    def get_queryset(self):
        return SupervisionRequest.objects.select_related("patient").order_by("-requested_at")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, requested_by=self.request.user)

    @action(detail=True, methods=["post"])
    def schedule(self, request, pk=None):
        supervision_request = self.get_object()
        supervision_request.status = "SCHEDULED"
        supervision_request.supervisor = request.user
        supervision_request.save(update_fields=["status", "supervisor"])
        return Response(SupervisionRequestSerializer(supervision_request).data)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        supervision_request = self.get_object()
        supervision_request.status = "COMPLETED"
        supervision_request.completed_at = timezone.now()
        supervision_request.notes = request.data.get("notes", supervision_request.notes)
        supervision_request.save(update_fields=["status", "completed_at", "notes"])
        return Response(SupervisionRequestSerializer(supervision_request).data)


class NacadaNdoReportViewSet(viewsets.ModelViewSet):
    """
    NACADA National Drug Observatory report — docs/07-CLINICAL-MODULES-SPEC.md
    §7.14.6: auto-compiled from SudRehabPlan/UrineDrugScreen; API submission
    to NACADA itself is a Phase 6+ integration, not implemented here.
    """

    serializer_class = NacadaNdoReportSerializer

    def get_queryset(self):
        return NacadaNdoReport.objects.order_by("-generated_at")

    def perform_create(self, serializer):
        report = serializer.save(
            organization=self.request.user.organization, generated_by=self.request.user
        )
        period_start, period_end = report.period_start, report.period_end
        plans = SudRehabPlan.objects.filter(started_at__date__range=(period_start, period_end))
        screens = UrineDrugScreen.objects.filter(
            collected_at__date__range=(period_start, period_end)
        )
        phase_counts = {}
        for phase_code, phase_label in SudRehabPlan.PHASE_CHOICES:
            phase_counts[phase_label] = plans.filter(current_phase=phase_code).count()
        report.summary_data = {
            "new_rehab_plans": plans.count(),
            "plans_by_phase": phase_counts,
            "urine_drug_screens_conducted": screens.count(),
        }
        report.save(update_fields=["summary_data"])

    @action(detail=True, methods=["post"])
    def export(self, request, pk=None):
        report = self.get_object()
        report.status = "EXPORTED"
        report.save(update_fields=["status"])
        return Response(NacadaNdoReportSerializer(report).data)


class CcpTeamRosterView(APIView):
    """
    Roster/caseload view of the CCP team — docs/07-CLINICAL-MODULES-SPEC.md
    §7.14.6. "specialties" is sourced from each member's assigned Roles (no
    separate specialty taxonomy exists yet).
    """

    def get(self, request):
        from apps.accounts.models import User

        therapists = User.objects.filter(care_team_memberships__isnull=False).distinct()
        roster = []
        for user in therapists:
            roster.append(
                {
                    "user_id": user.id,
                    "email": user.email,
                    "first_name": user.first_name,
                    "last_name": user.last_name,
                    "caseload_count": user.care_team_memberships.values("patient")
                    .distinct()
                    .count(),
                    "specialties": list(user.roles.values_list("name", flat=True)),
                }
            )
        return Response(CcpTeamRosterSerializer(roster, many=True).data)
