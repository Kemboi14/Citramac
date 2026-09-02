from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AppointmentViewSet,
    AttachmentViewSet,
    ClinicalDashboardSummaryView,
    ErasureRequestViewSet,
    PatientViewSet,
)

router = DefaultRouter()
router.register("patients", PatientViewSet, basename="patient")
router.register("appointments", AppointmentViewSet, basename="appointment")
router.register("attachments", AttachmentViewSet, basename="attachment")
router.register("erasure-requests", ErasureRequestViewSet, basename="erasure-request")

urlpatterns = router.urls + [
    path(
        "clinical/dashboard-summary/",
        ClinicalDashboardSummaryView.as_view(),
        name="clinical-dashboard-summary",
    ),
]
