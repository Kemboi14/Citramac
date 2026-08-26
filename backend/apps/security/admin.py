from django.contrib import admin

from .models import SecurityAlert, SecurityPolicy


@admin.register(SecurityPolicy)
class SecurityPolicyAdmin(admin.ModelAdmin):
    list_display = ["minimum_password_length", "session_timeout_minutes", "updated_at"]

    def has_add_permission(self, request):
        return not SecurityPolicy.objects.exists()


@admin.register(SecurityAlert)
class SecurityAlertAdmin(admin.ModelAdmin):
    list_display = ["category", "severity", "status", "organization_id", "detected_at"]
    list_filter = ["category", "severity", "status"]
    readonly_fields = [
        "id",
        "organization_id",
        "category",
        "severity",
        "description",
        "detected_at",
    ]
