from django.contrib import admin

from .models import DispenseRecord, DrugStockItem, StockMovement, Store


@admin.register(Store)
class StoreAdmin(admin.ModelAdmin):
    list_display = ["name", "store_type", "branch"]


@admin.register(DrugStockItem)
class DrugStockItemAdmin(admin.ModelAdmin):
    list_display = ["drug", "store", "batch_number", "expiry_date", "quantity_on_hand"]
    list_filter = ["store"]
    search_fields = ["batch_number"]


@admin.register(StockMovement)
class StockMovementAdmin(admin.ModelAdmin):
    list_display = ["stock_item", "movement_type", "quantity", "moved_at"]
    list_filter = ["movement_type"]


@admin.register(DispenseRecord)
class DispenseRecordAdmin(admin.ModelAdmin):
    list_display = ["prescription_item", "stock_item", "quantity_dispensed", "dispensed_at"]
