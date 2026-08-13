from rest_framework.routers import DefaultRouter

from .views import DispenseRecordViewSet, DrugStockItemViewSet, StockMovementViewSet, StoreViewSet

router = DefaultRouter()
router.register("pharmacy/stores", StoreViewSet, basename="pharmacy-store")
router.register("pharmacy/stock-items", DrugStockItemViewSet, basename="pharmacy-stock-item")
router.register(
    "pharmacy/stock-movements", StockMovementViewSet, basename="pharmacy-stock-movement"
)
router.register("pharmacy/dispense", DispenseRecordViewSet, basename="pharmacy-dispense")

urlpatterns = router.urls
