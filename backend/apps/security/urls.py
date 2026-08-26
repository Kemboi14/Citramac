from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register(r"security/alerts", views.SecurityAlertViewSet, basename="security-alert")

urlpatterns = [
    path("security/policy/", views.SecurityPolicyView.as_view(), name="security-policy"),
    path("security/dashboard/", views.SecurityDashboardView.as_view(), name="security-dashboard"),
    path("", include(router.urls)),
]
