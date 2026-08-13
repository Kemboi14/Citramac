from rest_framework.routers import DefaultRouter

from .views import AppointmentViewSet, PatientViewSet

router = DefaultRouter()
router.register("patients", PatientViewSet, basename="patient")
router.register("appointments", AppointmentViewSet, basename="appointment")

urlpatterns = router.urls
