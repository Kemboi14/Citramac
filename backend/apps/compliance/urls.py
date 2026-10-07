from django.urls import path

from . import views

urlpatterns = [
    path("breach-incidents/", views.BreachIncidentsView.as_view(), name="breach-incidents"),
    path("breach-incidents/<uuid:pk>/", views.BreachIncidentView.as_view(), name="breach-incident"),
    path(
        "breach-notifications/<uuid:pk>/record/",
        views.BreachNotificationView.as_view(),
        name="breach-notification-record",
    ),
    path("subject-requests/", views.SubjectRequestsView.as_view(), name="subject-requests"),
    path(
        "subject-requests/<uuid:pk>/decision/",
        views.SubjectRequestDecisionView.as_view(),
        name="subject-request-decision",
    ),
    path(
        "subject-requests/<uuid:pk>/export/",
        views.SubjectRequestExportView.as_view(),
        name="subject-request-export",
    ),
    path("support-grants/", views.SupportGrantsView.as_view(), name="support-grants"),
    path(
        "support-grants/<uuid:pk>/decision/",
        views.SupportGrantDecisionView.as_view(),
        name="support-grant-decision",
    ),
    path("profile/", views.ComplianceProfileView.as_view(), name="compliance-profile"),
    path(
        "profile/accept-warranty/",
        views.AcceptWarrantyView.as_view(),
        name="compliance-accept-warranty",
    ),
    path("profile/evidence/", views.OwnEvidenceView.as_view(), name="compliance-own-evidence"),
    path("tenants/", views.TenantComplianceListView.as_view(), name="compliance-tenants"),
    path(
        "tenants/<uuid:organization_id>/evidence/",
        views.TenantEvidenceView.as_view(),
        name="compliance-tenant-evidence",
    ),
    path(
        "tenants/<uuid:organization_id>/",
        views.TenantComplianceView.as_view(),
        name="compliance-tenant",
    ),
    path(
        "platform-settings/",
        views.PlatformComplianceSettingsView.as_view(),
        name="compliance-platform-settings",
    ),
    path("public/dpo/", views.PublicDpoView.as_view(), name="compliance-public-dpo"),
]
