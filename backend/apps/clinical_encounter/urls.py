from rest_framework.routers import DefaultRouter

from .views import EncounterViewSet

router = DefaultRouter()
router.register("encounters", EncounterViewSet, basename="encounter")

urlpatterns = router.urls
