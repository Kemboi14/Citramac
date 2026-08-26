from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    BranchViewSet,
    OrganizationDetailView,
    OrganizationListCreateView,
    OrganizationLogoUploadView,
    OrganizationStatusView,
    OrgDashboardStatsView,
    PlatformBrandingView,
    PlatformDashboardStatsView,
    SubscriptionPlanViewSet,
    SubscriptionViewSet,
)

router = DefaultRouter()
router.register(r"branches", BranchViewSet, basename="branch")
router.register(r"subscription-plans", SubscriptionPlanViewSet, basename="subscription-plan")
router.register(r"subscriptions", SubscriptionViewSet, basename="subscription")

urlpatterns = [
    path("organizations/", OrganizationListCreateView.as_view(), name="platform-organizations"),
    path(
        "organizations/<uuid:pk>/",
        OrganizationDetailView.as_view(),
        name="platform-organization-detail",
    ),
    path(
        "organizations/<uuid:pk>/status/",
        OrganizationStatusView.as_view(),
        name="platform-organization-status",
    ),
    path(
        "organizations/<uuid:pk>/logo/",
        OrganizationLogoUploadView.as_view(),
        name="platform-organization-logo",
    ),
    path("dashboard-stats/", PlatformDashboardStatsView.as_view(), name="platform-dashboard-stats"),
    path("branding/", PlatformBrandingView.as_view(), name="platform-branding"),
    path("org-dashboard-stats/", OrgDashboardStatsView.as_view(), name="org-dashboard-stats"),
    path("", include(router.urls)),
]
