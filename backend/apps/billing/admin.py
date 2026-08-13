from django.contrib import admin

from .models import CostCenter, Invoice, InvoiceLine, Payment


class InvoiceLineInline(admin.TabularInline):
    model = InvoiceLine
    extra = 0


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ["patient", "status", "currency", "created_at"]
    list_filter = ["status", "organization"]
    inlines = [InvoiceLineInline, PaymentInline]


@admin.register(CostCenter)
class CostCenterAdmin(admin.ModelAdmin):
    list_display = ["name", "branch", "organization"]
