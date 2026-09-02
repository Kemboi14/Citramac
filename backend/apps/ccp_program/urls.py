from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    BiopsychosocialAssessmentViewSet,
    CareTeamMembershipViewSet,
    CcpTeamRosterView,
    ClinicalReviewViewSet,
    NacadaNdoReportViewSet,
    PsychotherapySessionViewSet,
    ReviewOfSystemEntryViewSet,
    SubstanceUseEntryViewSet,
    SudRehabPlanViewSet,
    SupervisionRequestViewSet,
    UrineDrugScreenViewSet,
)

router = DefaultRouter()
router.register(
    "ccp/biopsychosocial-assessments",
    BiopsychosocialAssessmentViewSet,
    basename="biopsychosocial-assessment",
)
router.register(
    "ccp/substance-use-entries", SubstanceUseEntryViewSet, basename="substance-use-entry"
)
router.register(
    "ccp/review-of-systems", ReviewOfSystemEntryViewSet, basename="review-of-system-entry"
)
router.register(
    "ccp/psychotherapy-sessions", PsychotherapySessionViewSet, basename="psychotherapy-session"
)
router.register("ccp/care-team", CareTeamMembershipViewSet, basename="care-team-membership")
router.register("ccp/sud-rehab-plans", SudRehabPlanViewSet, basename="sud-rehab-plan")
router.register("ccp/urine-drug-screens", UrineDrugScreenViewSet, basename="urine-drug-screen")
router.register("ccp/clinical-reviews", ClinicalReviewViewSet, basename="clinical-review")
router.register(
    "ccp/supervision-requests", SupervisionRequestViewSet, basename="supervision-request"
)
router.register("ccp/nacada-ndo-reports", NacadaNdoReportViewSet, basename="nacada-ndo-report")

urlpatterns = router.urls + [
    path("ccp/team-roster/", CcpTeamRosterView.as_view(), name="ccp-team-roster"),
]
