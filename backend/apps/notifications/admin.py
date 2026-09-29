from django.contrib import admin

from .models import Notification, NotificationDelivery


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ["title", "recipient", "category", "severity", "is_read", "created_at"]
    list_filter = ["category", "severity", "is_read"]
    search_fields = ["title", "dedupe_key"]
    readonly_fields = [f.name for f in Notification._meta.fields]

    def has_add_permission(self, request):
        return False


@admin.register(NotificationDelivery)
class NotificationDeliveryAdmin(admin.ModelAdmin):
    """The delivery log — where an undelivered notice shows up and why."""

    list_display = ["channel", "address", "status", "attempts", "created_at", "sent_at"]
    list_filter = ["status", "channel"]
    search_fields = ["address", "dedupe_key"]
    readonly_fields = [f.name for f in NotificationDelivery._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
