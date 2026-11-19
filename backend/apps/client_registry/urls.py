from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AppointmentViewSet,
    AttachmentDownloadDecisionView,
    AttachmentDownloadRequestListView,
    AttachmentViewSet,
    CaseloadView,
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
    path("clinical/caseload/", CaseloadView.as_view(), name="clinical-caseload"),
    path(
        "attachment-download-requests/",
        AttachmentDownloadRequestListView.as_view(),
        name="attachment-download-requests",
    ),
    path(
        "attachment-download-requests/<uuid:pk>/decide/",
        AttachmentDownloadDecisionView.as_view(),
        name="attachment-download-decide",
    ),
]
