from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import practitioner_views, views

router = DefaultRouter()
router.register(r"roles", views.RoleViewSet, basename="role")
router.register(r"staff", views.StaffViewSet, basename="staff")
router.register(r"platform/staff", views.PlatformStaffViewSet, basename="platform-staff")

urlpatterns = [
    path("permissions/", views.PermissionListView.as_view(), name="permission-list"),
    path("me/enabled-modules/", views.EnabledModulesView.as_view(), name="me-enabled-modules"),
    path("me/profile/", views.MyProfileView.as_view(), name="me-profile"),
    path(
        "me/professional-profile/",
        practitioner_views.MyProfessionalProfileView.as_view(),
        name="me-professional-profile",
    ),
    path(
        "me/professional-profile/submit/",
        practitioner_views.MyProfessionalProfileSubmitView.as_view(),
        name="me-professional-profile-submit",
    ),
    path(
        "me/professional-profile/documents/<str:kind>/",
        practitioner_views.MyProfessionalDocumentView.as_view(),
        name="me-professional-profile-document",
    ),
    path(
        "staff-credentials/<uuid:user_id>/",
        practitioner_views.StaffCredentialView.as_view(),
        name="staff-credential",
    ),
    path(
        "staff-credentials/<uuid:user_id>/documents/<str:kind>/",
        practitioner_views.StaffCredentialDocumentView.as_view(),
        name="staff-credential-document",
    ),
    path(
        "staff-credentials/<uuid:user_id>/verify/",
        practitioner_views.StaffCredentialVerifyView.as_view(),
        name="staff-credential-verify",
    ),
    path(
        "staff-credentials/<uuid:user_id>/return/",
        practitioner_views.StaffCredentialReturnView.as_view(),
        name="staff-credential-return",
    ),
    path("", include(router.urls)),
]
