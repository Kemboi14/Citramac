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
        "me/professional-profile/items/",
        practitioner_views.MyCredentialItemsView.as_view(),
        name="me-professional-profile-items",
    ),
    path(
        "me/professional-profile/items/<uuid:item_id>/",
        practitioner_views.MyCredentialItemView.as_view(),
        name="me-professional-profile-item",
    ),
    path(
        "me/professional-profile/items/<uuid:item_id>/documents/",
        practitioner_views.MyCredentialItemDocumentView.as_view(),
        name="me-professional-profile-item-document",
    ),
    path(
        "me/professional-profile/files/<uuid:document_id>/",
        practitioner_views.MyProfessionalFileView.as_view(),
        name="me-professional-profile-file",
    ),
    path(
        "staff-credentials/<uuid:user_id>/",
        practitioner_views.StaffCredentialView.as_view(),
        name="staff-credential",
    ),
    path(
        "staff-credentials/<uuid:user_id>/files/<uuid:document_id>/",
        practitioner_views.StaffCredentialFileView.as_view(),
        name="staff-credential-file",
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
