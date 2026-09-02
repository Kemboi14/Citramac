from rest_framework.routers import DefaultRouter

from .views import DiagnosisCodeViewSet, EncounterViewSet

router = DefaultRouter()
router.register("encounters", EncounterViewSet, basename="encounter")
router.register("diagnoses", DiagnosisCodeViewSet, basename="diagnosis-code")

urlpatterns = router.urls
