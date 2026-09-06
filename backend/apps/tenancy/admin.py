from django import forms
from django.contrib import admin

from .crypto import encrypt_value
from .models import (
    Branch,
    Organization,
    PlatformBranding,
    PlatformEmailSettings,
    Subscription,
    SubscriptionPlan,
)


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "org_type", "facility_type", "status", "created_at"]
    search_fields = ["name", "slug", "dha_facility_code"]
    list_filter = ["org_type", "facility_type", "status", "ownership_type"]
    prepopulated_fields = {"slug": ("name",)}
    fieldsets = (
        (
            None,
            {
                "fields": (
                    "name",
                    "slug",
                    "org_type",
                    "facility_type",
                    "ownership_type",
                    "dha_facility_code",
                    "sha_provider_code",
                    "county",
                    "sub_county",
                    "subscription_plan",
                    "enabled_modules",
                    "isolation_mode",
                    "status",
                    "is_active",
                    "mfl_verified_at",
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
        (
            "Self-service SMTP",
            {
                "description": (
                    "Org Admin's own 'Email Configuration' settings screen writes "
                    "these fields via a narrow API endpoint, not this admin. The "
                    "SMTP password is Fernet-encrypted at rest and never shown here."
                ),
                "fields": (
                    "email_host",
                    "email_port",
                    "email_host_user",
                    "email_use_tls",
                    "email_use_ssl",
                    "email_from_address",
                ),
                "classes": ("collapse",),
            },
        ),
        ("Advanced", {"fields": ("theme_overrides",), "classes": ("collapse",)}),
    )


@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ["name", "organization", "facility_level", "county", "is_active"]
    search_fields = ["name", "organization__name", "mfl_code"]
    list_filter = ["facility_level", "is_active", "ccp_registration_status"]
    exclude = ["sha_api_credentials_encrypted"]


@admin.register(SubscriptionPlan)
class SubscriptionPlanAdmin(admin.ModelAdmin):
    list_display = ["name", "code", "max_branches", "max_staff_seats", "price_monthly", "is_active"]


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ["organization", "plan", "billing_cycle", "status", "current_period_end"]
    list_filter = ["status", "billing_cycle"]
    search_fields = ["organization__name"]


@admin.register(PlatformBranding)
class PlatformBrandingAdmin(admin.ModelAdmin):
    list_display = ["logo", "updated_at", "updated_by"]

    def has_add_permission(self, request):
        # Singleton — always pk=1, editing is the only meaningful action.
        return not PlatformBranding.objects.exists()


class PlatformEmailSettingsForm(forms.ModelForm):
    host_password = forms.CharField(
        label="Host password",
        required=False,
        widget=forms.PasswordInput(render_value=False),
        help_text="Leave blank to keep the currently saved password.",
    )

    class Meta:
        model = PlatformEmailSettings
        exclude = ["host_password_encrypted"]

    def save(self, commit=True):
        instance = super().save(commit=False)
        new_password = self.cleaned_data.get("host_password")
        if new_password:
            instance.host_password_encrypted = encrypt_value(new_password)
        if commit:
            instance.save()
        return instance


@admin.register(PlatformEmailSettings)
class PlatformEmailSettingsAdmin(admin.ModelAdmin):
    form = PlatformEmailSettingsForm
    list_display = ["host", "host_user", "use_tls", "use_ssl", "updated_at", "updated_by"]

    def has_add_permission(self, request):
        # Singleton — always pk=1, editing is the only meaningful action.
        return not PlatformEmailSettings.objects.exists()
