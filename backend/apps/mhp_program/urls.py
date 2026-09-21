from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    BiopsychosocialAssessmentViewSet,
    CareTeamMembershipViewSet,
    MhpTeamRosterView,
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
    "mhp/biopsychosocial-assessments",
    BiopsychosocialAssessmentViewSet,
    basename="biopsychosocial-assessment",
)
router.register(
    "mhp/substance-use-entries", SubstanceUseEntryViewSet, basename="substance-use-entry"
)
router.register(
    "mhp/review-of-systems", ReviewOfSystemEntryViewSet, basename="review-of-system-entry"
)
router.register(
    "mhp/psychotherapy-sessions", PsychotherapySessionViewSet, basename="psychotherapy-session"
)
router.register("mhp/care-team", CareTeamMembershipViewSet, basename="care-team-membership")
router.register("mhp/sud-rehab-plans", SudRehabPlanViewSet, basename="sud-rehab-plan")
router.register("mhp/urine-drug-screens", UrineDrugScreenViewSet, basename="urine-drug-screen")
router.register("mhp/clinical-reviews", ClinicalReviewViewSet, basename="clinical-review")
router.register(
    "mhp/supervision-requests", SupervisionRequestViewSet, basename="supervision-request"
)
router.register("mhp/nacada-ndo-reports", NacadaNdoReportViewSet, basename="nacada-ndo-report")

urlpatterns = router.urls + [
    path("mhp/team-roster/", MhpTeamRosterView.as_view(), name="mhp-team-roster"),
]
