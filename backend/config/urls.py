"""
URL configuration for the config project.
"""

from django.contrib import admin
from django.db import connections
from django.db.utils import OperationalError
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def healthz(request):
    """Liveness/readiness probe target for Docker/Kubernetes — checks DB connectivity."""
    checks = {}
    try:
        connections["default"].cursor()
        checks["database"] = "ok"
    except OperationalError:
        checks["database"] = "unavailable"

    status = 200 if checks.get("database") == "ok" else 503
    return JsonResponse(
        {"status": "ok" if status == 200 else "degraded", "checks": checks}, status=status
    )


urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz", healthz, name="healthz"),
    path("api/v1/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/v1/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/v1/auth/", include("apps.accounts.urls")),
    path("api/v1/platform/", include("apps.tenancy.urls")),
]
