from rest_framework.routers import DefaultRouter

from .views import InsuranceClaimViewSet, PreAuthorizationViewSet, RemittanceViewSet

router = DefaultRouter()
router.register("claims/pre-authorizations", PreAuthorizationViewSet, basename="pre-authorization")
router.register("claims/e-claims", InsuranceClaimViewSet, basename="e-claim")
router.register("claims/remittances", RemittanceViewSet, basename="remittance")

urlpatterns = router.urls
