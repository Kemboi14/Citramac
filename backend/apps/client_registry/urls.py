from rest_framework.routers import DefaultRouter

from .views import AppointmentViewSet, ErasureRequestViewSet, PatientViewSet

router = DefaultRouter()
router.register("patients", PatientViewSet, basename="patient")
router.register("appointments", AppointmentViewSet, basename="appointment")
router.register("erasure-requests", ErasureRequestViewSet, basename="erasure-request")

urlpatterns = router.urls
