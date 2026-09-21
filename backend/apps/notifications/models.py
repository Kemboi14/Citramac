import uuid

from django.db import models


class Notification(models.Model):
    """
    A persisted, in-app alert for one user — the topbar bell
    (frontend/src/shells/TopbarActions.tsx) reads these. Distinct from, and
    additional to, the outbound email/SMS dispatch in tasks.py: those reach
    someone outside the app (or before they've logged in); this is what
    lets them see the same event once they're in it.

    Not a TenantScopedModel: `recipient` alone is the real security
    boundary (every view filters by `recipient=request.user`), and a
    platform-level notification legitimately has no organization at all
    (mirrors apps.accounts.models.User.organization being nullable for
    platform staff).
    """

    CATEGORY_RISK_ALERT = "RISK_ALERT"
    CATEGORY_SYSTEM = "SYSTEM"
    CATEGORY_CHOICES = [
        (CATEGORY_RISK_ALERT, "Risk Alert"),
        (CATEGORY_SYSTEM, "System"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="notifications"
    )
    organization = models.ForeignKey(
        "tenancy.Organization",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="notifications",
    )
    category = models.CharField(max_length=32, choices=CATEGORY_CHOICES)
    title = models.CharField(max_length=255)
    body = models.TextField(blank=True)
    # Frontend route to navigate to on click, e.g. "/clinical/encounter" —
    # deliberately a plain path, not a FK to whatever the notification is
    # about, since that target (an Encounter, a StaffInvite, ...) varies by
    # category and may itself be deleted later.
    link = models.CharField(max_length=255, blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["recipient", "is_read", "-created_at"])]

    def __str__(self):
        return f"{self.category}: {self.title} -> {self.recipient_id}"
