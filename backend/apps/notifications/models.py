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
    CATEGORY_SUBSCRIPTION = "SUBSCRIPTION"
    CATEGORY_RETENTION = "RETENTION"
    CATEGORY_CHOICES = [
        (CATEGORY_RISK_ALERT, "Risk Alert"),
        (CATEGORY_SYSTEM, "System"),
        (CATEGORY_SUBSCRIPTION, "Subscription"),
        (CATEGORY_RETENTION, "Records Retention"),
    ]
    SEVERITY_INFO = "INFO"
    SEVERITY_WARNING = "WARNING"
    SEVERITY_CRITICAL = "CRITICAL"
    SEVERITY_CHOICES = [
        (SEVERITY_INFO, "Info"),
        (SEVERITY_WARNING, "Warning"),
        (SEVERITY_CRITICAL, "Critical"),
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
    severity = models.CharField(max_length=10, choices=SEVERITY_CHOICES, default=SEVERITY_INFO)
    # Identifies the event this notification is about (e.g.
    # "sub:<id>:2026-10-31:T-7"), so a scheduled job that runs twice, or is
    # retried, never tells the same person the same thing twice. Blank for
    # one-off notifications that have no natural identity.
    dedupe_key = models.CharField(max_length=200, blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["recipient", "is_read", "-created_at"])]
        constraints = [
            models.UniqueConstraint(
                fields=["recipient", "dedupe_key"],
                name="unique_notification_per_recipient_event",
                condition=~models.Q(dedupe_key=""),
            )
        ]

    def __str__(self):
        return f"{self.category}: {self.title} -> {self.recipient_id}"


class NotificationDelivery(models.Model):
    """
    One outbound email or SMS, and what happened to it. The record that
    makes delivery failures visible: a notice that could not be sent —
    no SMTP/SMS gateway configured, or the gateway refusing it after every
    retry — ends up NOT_CONFIGURED or FAILED here, never silently "sent".
    Unique per (event, channel, address), so re-running a scheduled job
    can't send a duplicate.
    """

    CHANNEL_EMAIL = "EMAIL"
    CHANNEL_SMS = "SMS"
    CHANNEL_CHOICES = [(CHANNEL_EMAIL, "Email"), (CHANNEL_SMS, "SMS")]

    STATUS_PENDING = "PENDING"
    STATUS_SENT = "SENT"
    STATUS_FAILED = "FAILED"
    STATUS_NOT_CONFIGURED = "NOT_CONFIGURED"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_SENT, "Sent"),
        (STATUS_FAILED, "Failed"),
        (STATUS_NOT_CONFIGURED, "Not configured"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        "tenancy.Organization",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    notification = models.ForeignKey(
        Notification, on_delete=models.SET_NULL, null=True, blank=True, related_name="deliveries"
    )
    dedupe_key = models.CharField(max_length=200)
    channel = models.CharField(max_length=8, choices=CHANNEL_CHOICES)
    address = models.CharField(max_length=255)
    subject = models.CharField(max_length=255, blank=True)
    body_text = models.TextField()
    html_template = models.CharField(max_length=200, blank=True)
    html_context = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING)
    attempts = models.PositiveSmallIntegerField(default=0)
    # When a PENDING delivery is next eligible to be tried — the periodic
    # sweep (tasks.retry_pending_deliveries) picks up anything due, which
    # also recovers a delivery whose queued task was lost.
    next_attempt_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "notification deliveries"
        constraints = [
            models.UniqueConstraint(
                fields=["dedupe_key", "channel", "address"], name="unique_delivery_per_event"
            )
        ]
        indexes = [models.Index(fields=["status", "-created_at"])]

    def __str__(self):
        return f"{self.channel} {self.status} -> {self.address}"
