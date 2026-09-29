from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    ArchiveBatchViewSet,
    ArchivedPatientListView,
    OrganizationRetentionPolicyView,
    PatientLifecycleViewSet,
    RetentionPlatformSettingsView,
    RetentionScanRunViewSet,
)

router = DefaultRouter()
router.register("scans", RetentionScanRunViewSet, basename="retention-scan")
router.register("batches", ArchiveBatchViewSet, basename="archive-batch")
router.register("patients", PatientLifecycleViewSet, basename="retention-patient")

urlpatterns = [
    path(
        "platform-settings/",
        RetentionPlatformSettingsView.as_view(),
        name="retention-platform-settings",
    ),
    path("policy/", OrganizationRetentionPolicyView.as_view(), name="retention-policy"),
    path("archived/", ArchivedPatientListView.as_view(), name="retention-archived"),
    *router.urls,
]
