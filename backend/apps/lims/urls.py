from rest_framework.routers import DefaultRouter

from .views import LabOrderViewSet, LabResultViewSet, LabSpecimenViewSet

router = DefaultRouter()
router.register("lab/orders", LabOrderViewSet, basename="lab-order")
router.register("lab/specimens", LabSpecimenViewSet, basename="lab-specimen")
router.register("lab/results", LabResultViewSet, basename="lab-result")

urlpatterns = router.urls
