"""
URL configuration for the config project.
"""

from django.conf import settings
from django.conf.urls.static import static
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
    path("api/v1/", include("apps.client_registry.urls")),
    path("api/v1/", include("apps.dha_interop.urls")),
    path("api/v1/", include("apps.clinical_encounter.urls")),
    path("api/v1/", include("apps.ccp_program.urls")),
    path("api/v1/", include("apps.billing.urls")),
    path("api/v1/", include("apps.insurance_claims.urls")),
    path("api/v1/", include("apps.lims.urls")),
    path("api/v1/", include("apps.pharmacy.urls")),
    path("api/v1/", include("apps.ipd_ward.urls")),
    path("api/v1/", include("apps.offline_sync.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
