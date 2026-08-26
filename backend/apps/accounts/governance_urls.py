from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register(r"roles", views.RoleViewSet, basename="role")
router.register(r"staff", views.StaffViewSet, basename="staff")
router.register(r"platform/staff", views.PlatformStaffViewSet, basename="platform-staff")

urlpatterns = [
    path("permissions/", views.PermissionListView.as_view(), name="permission-list"),
    path("me/enabled-modules/", views.EnabledModulesView.as_view(), name="me-enabled-modules"),
    path("", include(router.urls)),
]
