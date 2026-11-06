from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import CostCenterReportView, CostCenterViewSet

router = DefaultRouter()
# Invoices are issued and paid only through the client's billing workspace
# (insurance_claims.workspace): from documented charges, superseded never edited.
router.register("billing/cost-centers", CostCenterViewSet, basename="cost-center")

urlpatterns = [
    path("billing/cost-centers/report/", CostCenterReportView.as_view(), name="cost-center-report"),
] + router.urls
