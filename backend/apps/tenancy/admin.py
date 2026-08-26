from django.contrib import admin

from .models import Branch, Organization, SubscriptionPlan


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "facility_type", "is_active", "created_at"]
    search_fields = ["name", "slug", "dha_facility_code"]
    list_filter = ["facility_type", "is_active"]
    prepopulated_fields = {"slug": ("name",)}
    fieldsets = (
        (
            None,
            {
                "fields": (
                    "name",
                    "slug",
                    "facility_type",
                    "dha_facility_code",
                    "sha_provider_code",
                    "subscription_plan",
                    "enabled_modules",
                    "isolation_mode",
                    "is_active",
                )
            },
        ),
        (
            "Tenant-branded login (docs/14-TENANT-BRANDED-LOGIN-UX.md)",
            {
                "description": (
                    "Controls what staff see on the tenant discovery + login screens "
                    "before any credential is entered. email_domains drives which "
                    "organization a work email routes to."
                ),
                "fields": (
                    "email_domains",
                    "logo_url",
                    "login_image_url",
                    "tagline",
                    "primary_color",
                    "support_email",
                    "support_phone",
                    "website",
                ),
            },
        ),
        ("Advanced", {"fields": ("theme_overrides",), "classes": ("collapse",)}),
    )


@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ["name", "organization", "facility_level", "county", "is_active"]
    search_fields = ["name", "organization__name"]
    list_filter = ["facility_level", "is_active"]


@admin.register(SubscriptionPlan)
class SubscriptionPlanAdmin(admin.ModelAdmin):
    list_display = ["name", "max_branches", "max_staff_seats", "price_monthly"]
