from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import CostCenterReportView, CostCenterViewSet, InvoiceViewSet

router = DefaultRouter()
router.register("billing/invoices", InvoiceViewSet, basename="invoice")
router.register("billing/cost-centers", CostCenterViewSet, basename="cost-center")

urlpatterns = [
    path("billing/cost-centers/report/", CostCenterReportView.as_view(), name="cost-center-report"),
] + router.urls
