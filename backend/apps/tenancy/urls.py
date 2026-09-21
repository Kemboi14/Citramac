from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    BranchViewSet,
    DepartmentViewSet,
    OrganizationDetailView,
    OrganizationEmailSettingsView,
    OrganizationListCreateView,
    OrganizationLogoUploadView,
    OrganizationSmsSettingsView,
    OrganizationSmsTestView,
    OrganizationStatusView,
    OrganizationThemeView,
    OrgDashboardStatsView,
    PlatformBrandingView,
    PlatformDashboardStatsView,
    PlatformEmailSettingsView,
    PlatformSmsSettingsView,
    PlatformSmsTestView,
    SubscriptionPlanViewSet,
    SubscriptionViewSet,
)

router = DefaultRouter()
router.register(r"branches", BranchViewSet, basename="branch")
router.register(r"departments", DepartmentViewSet, basename="department")
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
    path(
        "organizations/<uuid:pk>/email-settings/",
        OrganizationEmailSettingsView.as_view(),
        name="platform-organization-email-settings",
    ),
    path(
        "organizations/<uuid:pk>/sms-settings/",
        OrganizationSmsSettingsView.as_view(),
        name="platform-organization-sms-settings",
    ),
    path(
        "organizations/<uuid:pk>/sms-settings/test/",
        OrganizationSmsTestView.as_view(),
        name="platform-organization-sms-settings-test",
    ),
    path(
        "organizations/<uuid:pk>/theme/",
        OrganizationThemeView.as_view(),
        name="platform-organization-theme",
    ),
    path("dashboard-stats/", PlatformDashboardStatsView.as_view(), name="platform-dashboard-stats"),
    path("branding/", PlatformBrandingView.as_view(), name="platform-branding"),
    path("email-settings/", PlatformEmailSettingsView.as_view(), name="platform-email-settings"),
    path("sms-settings/", PlatformSmsSettingsView.as_view(), name="platform-sms-settings"),
    path("sms-settings/test/", PlatformSmsTestView.as_view(), name="platform-sms-settings-test"),
    path("org-dashboard-stats/", OrgDashboardStatsView.as_view(), name="org-dashboard-stats"),
    path("", include(router.urls)),
]
