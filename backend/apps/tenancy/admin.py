from django.contrib import admin

from .models import Branch, Organization, SubscriptionPlan


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "facility_type", "is_active", "created_at"]
    search_fields = ["name", "slug", "dha_facility_code"]
    list_filter = ["facility_type", "is_active"]
    prepopulated_fields = {"slug": ("name",)}


@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ["name", "organization", "facility_level", "county", "is_active"]
    search_fields = ["name", "organization__name"]
    list_filter = ["facility_level", "is_active"]


@admin.register(SubscriptionPlan)
class SubscriptionPlanAdmin(admin.ModelAdmin):
    list_display = ["name", "max_branches", "max_staff_seats", "price_monthly"]
