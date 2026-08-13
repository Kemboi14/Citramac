from rest_framework.routers import DefaultRouter

from .views import (
    BiopsychosocialAssessmentViewSet,
    CareTeamMembershipViewSet,
    PsychotherapySessionViewSet,
)

router = DefaultRouter()
router.register(
    "ccp/biopsychosocial-assessments",
    BiopsychosocialAssessmentViewSet,
    basename="biopsychosocial-assessment",
)
router.register(
    "ccp/psychotherapy-sessions", PsychotherapySessionViewSet, basename="psychotherapy-session"
)
router.register("ccp/care-team", CareTeamMembershipViewSet, basename="care-team-membership")

urlpatterns = router.urls
