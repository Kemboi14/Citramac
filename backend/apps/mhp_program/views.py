from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.retention.mixins import NoHardDeleteMixin
from apps.sysadmin_audit.audit import log_view

from .models import (
    BiopsychosocialAssessment,
    CareTeamMembership,
    ClinicalReview,
    PsychotherapySession,
    ReviewOfSystemEntry,
    SubstanceUseEntry,
    SudRehabPlan,
    SupervisionRequest,
    UrineDrugScreen,
)
from .permissions import has_full_mhp_access
from .serializers import (
    BiopsychosocialAssessmentRestrictedSerializer,
    BiopsychosocialAssessmentSerializer,
    CareTeamMembershipSerializer,
    ClinicalReviewSerializer,
    MhpTeamRosterSerializer,
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
    MHP access, and audit-logs the view itself whenever full sensitive
    content is actually returned — docs/09-SECURITY-COMPLIANCE.md §9.4:
    "Sensitive record views (not just edits) must also be logged."
    """

    full_serializer_class = None
    restricted_serializer_class = None
    # Most MHP records FK straight to Patient; UrineDrugScreen only has one
    # via its SudRehabPlan, so it overrides this accessor.
    patient_accessor = staticmethod(lambda obj: obj.patient)

    def get_serializer_class(self):
        return self.full_serializer_class

    def _serializer_for(self, obj, request):
        if has_full_mhp_access(request.user, self.patient_accessor(obj)):
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

    def perform_update(self, serializer):
        # Editing sensitive content is gated exactly like reading it in full:
        # someone who only sees "an active care episode exists" must not be
        # able to rewrite the session note, assessment or screen behind it.
        if not has_full_mhp_access(self.request.user, self.patient_accessor(serializer.instance)):
            raise PermissionDenied(
                "Only this client's care team or an Org Admin can change this record.",
                code="not_on_care_team",
            )
        # The record stays filed under the client it was written about.
        patient = serializer.validated_data.get("patient")
        if patient is not None and patient != self.patient_accessor(serializer.instance):
            raise PermissionDenied("A record can't be moved to another client.")
        assessment = serializer.validated_data.get("assessment")
        if assessment is not None and assessment.pk != serializer.instance.assessment_id:
            raise PermissionDenied("An entry can't be moved to another assessment.")
        serializer.save()


class BiopsychosocialAssessmentViewSet(
    NoHardDeleteMixin, CareTeamRestrictedMixin, viewsets.ModelViewSet
):
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

    @action(detail=True, methods=["get"])
    def fhir(self, request, pk=None):
        """FHIR Bundle (Composition + Condition + Observation(s)) for this Client History intake."""
        from apps.dha_interop.fhir_mapper import build_client_history_bundle

        assessment = self.get_object()
        return Response(build_client_history_bundle(assessment))


class SubstanceUseEntryViewSet(NoHardDeleteMixin, CareTeamRestrictedMixin, viewsets.ModelViewSet):
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
        # Adding to an assessment is writing to that client's restricted record.
        if not has_full_mhp_access(
            self.request.user, serializer.validated_data["assessment"].patient
        ):
            raise PermissionDenied(
                "Only this client's care team or an Org Admin can add to this assessment.",
                code="not_on_care_team",
            )
        serializer.save(organization=self.request.user.organization)


class ReviewOfSystemEntryViewSet(NoHardDeleteMixin, CareTeamRestrictedMixin, viewsets.ModelViewSet):
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
        # Adding to an assessment is writing to that client's restricted record.
        if not has_full_mhp_access(
            self.request.user, serializer.validated_data["assessment"].patient
        ):
            raise PermissionDenied(
                "Only this client's care team or an Org Admin can add to this assessment.",
                code="not_on_care_team",
            )
        serializer.save(organization=self.request.user.organization, clinician=self.request.user)


class PsychotherapySessionViewSet(CareTeamRestrictedMixin, viewsets.ReadOnlyModelViewSet):
    """Read-only. Sessions are written only by the psychotherapy workflow
    (care_pathway.therapy / psychotherapy), which enforces the therapy contract
    and confidentiality terms; the v3 session pages that wrote here are retired."""

    full_serializer_class = PsychotherapySessionSerializer
    restricted_serializer_class = PsychotherapySessionRestrictedSerializer

    def get_queryset(self):
        # A session whose structured note (care_pathway.psychotherapy) is still a
        # draft is not a recorded session yet.
        queryset = (
            PsychotherapySession.objects.select_related("patient")
            .exclude(psy_note__status="DRAFT")
            .order_by("-session_date")
        )
        session_type = self.request.query_params.get("session_type")
        if session_type:
            queryset = queryset.filter(session_type=session_type)
        patient = self.request.query_params.get("patient")
        if patient:
            queryset = queryset.filter(patient_id=patient)
        return queryset


class CareTeamMembershipViewSet(viewsets.ModelViewSet):
    """The client's care team (docs/07 §7.14.7, at git f80b45b).

    Membership opens the client's full MHP content (``has_full_mhp_access``)
    and puts them on the member's caseload, so only the Org Admin or a holder of
    ``clinical.care_team.assign`` assigns or ends it, never for themselves
    (apps.care_pathway.care_team). Anyone else sees only their own memberships:
    who is on which client's team is itself sensitive. Ending a membership keeps
    the row (CareTeam.participant.period); nothing is deleted.
    """

    serializer_class = CareTeamMembershipSerializer

    def get_queryset(self):
        from apps.accounts.access import is_org_admin

        qs = CareTeamMembership.objects.select_related("patient", "user").order_by("-assigned_at")
        if self.request.user.is_superuser or is_org_admin(self.request.user):
            return qs
        return qs.filter(user=self.request.user)

    def _require_org_admin(self):
        from apps.care_pathway.care_team import require_team_assigner

        require_team_assigner(self.request.user)

    def _check_not_self(self, serializer):
        from apps.accounts.access import is_org_admin

        member = serializer.validated_data.get("user")
        if member == self.request.user and not is_org_admin(self.request.user):
            raise PermissionDenied("You can't add yourself to a client's care team.")

    def _check_member(self, serializer):
        member = serializer.validated_data.get("user")
        if member is not None and member.organization_id != self.request.user.organization_id:
            raise PermissionDenied("A care-team member must belong to this organisation.")

    def perform_create(self, serializer):
        self._require_org_admin()
        self._check_member(serializer)
        self._check_not_self(serializer)
        serializer.save(organization=self.request.user.organization, assigned_by=self.request.user)

    def perform_update(self, serializer):
        self._require_org_admin()
        self._check_member(serializer)
        self._check_not_self(serializer)
        serializer.save()

    def perform_destroy(self, instance):
        # Ended, never deleted: who was on the team, and when, stays answerable.
        self._require_org_admin()
        if instance.ended_at is None:
            instance.ended_at = timezone.now()
            instance.ended_by = self.request.user
            instance.save(update_fields=["ended_at", "ended_by"])


class SudRehabPlanViewSet(CareTeamRestrictedMixin, viewsets.ReadOnlyModelViewSet):
    """Archive, read-only: SUD care is planned in the care plan (care_pathway) now.
    Kept for the records and old-format NACADA counts that cite them."""

    full_serializer_class = SudRehabPlanSerializer
    restricted_serializer_class = SudRehabPlanRestrictedSerializer

    def get_queryset(self):
        return (
            SudRehabPlan.objects.select_related("patient")
            .prefetch_related("milestones")
            .order_by("-started_at")
        )


class UrineDrugScreenViewSet(CareTeamRestrictedMixin, viewsets.ReadOnlyModelViewSet):
    """Archive, read-only, with SudRehabPlan. Still behind the elevated MHP
    privacy tier — panel_results is SUD screening data, not just metadata."""

    full_serializer_class = UrineDrugScreenSerializer
    restricted_serializer_class = UrineDrugScreenRestrictedSerializer
    patient_accessor = staticmethod(lambda obj: obj.plan.patient)

    def get_queryset(self):
        return UrineDrugScreen.objects.select_related("plan__patient").order_by("-collected_at")


class ClinicalReviewViewSet(NoHardDeleteMixin, viewsets.ModelViewSet):
    """Peer/senior review workflow — docs/07-CLINICAL-MODULES-SPEC.md §7.14.5."""

    serializer_class = ClinicalReviewSerializer

    def get_queryset(self):
        return ClinicalReview.objects.select_related("patient").order_by("-requested_at")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, requested_by=self.request.user)

    def perform_update(self, serializer):
        # Only the case summary can be edited, and only by the requester while
        # the review is still open; the decision goes through `decide`.
        review = serializer.instance
        if review.requested_by_id != self.request.user.id or review.status == "APPROVED":
            raise PermissionDenied("Only the requester can edit an open review request.")
        serializer.save()

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def decide(self, request, pk=None):
        from apps.accounts.access import has_permission

        if not has_permission(request.user, "clinical.cosign"):
            raise PermissionDenied("Deciding a clinical review needs a senior clinician.")
        review = ClinicalReview.objects.select_for_update().get(pk=self.get_object().pk)
        if review.requested_by_id == request.user.id:
            raise PermissionDenied("Nobody reviews their own case.")
        if review.status == "APPROVED":
            return Response({"error": "This review has already been approved."}, status=400)
        decision = request.data.get("status")
        if decision not in ("APPROVED", "CHANGES_REQUESTED"):
            return Response({"error": "status must be APPROVED or CHANGES_REQUESTED"}, status=400)
        review.status = decision
        review.reviewer = request.user
        review.review_notes = request.data.get("review_notes", review.review_notes)
        review.reviewed_at = timezone.now()
        review.save(update_fields=["status", "reviewer", "review_notes", "reviewed_at"])
        return Response(ClinicalReviewSerializer(review).data)


class SupervisionRequestViewSet(NoHardDeleteMixin, viewsets.ModelViewSet):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.14.5 — mirrors the mockup's nav item."""

    serializer_class = SupervisionRequestSerializer

    def get_queryset(self):
        return SupervisionRequest.objects.select_related("patient").order_by("-requested_at")

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization, requested_by=self.request.user)

    def perform_update(self, serializer):
        request_ = serializer.instance
        if request_.requested_by_id != self.request.user.id or request_.status != "OPEN":
            raise PermissionDenied("Only the requester can edit an open supervision request.")
        serializer.save()

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def schedule(self, request, pk=None):
        supervision_request = SupervisionRequest.objects.select_for_update().get(
            pk=self.get_object().pk
        )
        if supervision_request.status != "OPEN":
            return Response(
                {"error": "This request is already scheduled or completed."}, status=400
            )
        if supervision_request.requested_by_id == request.user.id:
            raise PermissionDenied("Nobody supervises their own request.")
        supervision_request.status = "SCHEDULED"
        supervision_request.supervisor = request.user
        supervision_request.save(update_fields=["status", "supervisor"])
        return Response(SupervisionRequestSerializer(supervision_request).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def complete(self, request, pk=None):
        supervision_request = SupervisionRequest.objects.select_for_update().get(
            pk=self.get_object().pk
        )
        if supervision_request.status != "SCHEDULED":
            return Response({"error": "Only a scheduled request can be completed."}, status=400)
        if supervision_request.supervisor_id != request.user.id:
            raise PermissionDenied("Only the supervisor who took the request completes it.")
        supervision_request.status = "COMPLETED"
        supervision_request.completed_at = timezone.now()
        supervision_request.notes = request.data.get("notes", supervision_request.notes)
        supervision_request.save(update_fields=["status", "completed_at", "notes"])
        return Response(SupervisionRequestSerializer(supervision_request).data)


class MhpTeamRosterView(APIView):
    """
    Roster/caseload view of the MHP team — docs/07-CLINICAL-MODULES-SPEC.md
    §7.14.6. "specialties" is sourced from each member's assigned Roles (no
    separate specialty taxonomy exists yet).
    """

    def get(self, request):
        from apps.accounts.models import User

        therapists = User.objects.filter(
            care_team_memberships__isnull=False, care_team_memberships__ended_at__isnull=True
        ).distinct()
        roster = []
        for user in therapists:
            roster.append(
                {
                    "user_id": user.id,
                    "email": user.email,
                    "first_name": user.first_name,
                    "last_name": user.last_name,
                    "caseload_count": user.care_team_memberships.filter(ended_at__isnull=True)
                    .values("patient")
                    .distinct()
                    .count(),
                    "specialties": list(user.roles.values_list("name", flat=True)),
                }
            )
        return Response(MhpTeamRosterSerializer(roster, many=True).data)
