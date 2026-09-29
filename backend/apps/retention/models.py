"""
Records retention and archiving — clinical data is archived at the end of
its retention period, never deleted.

The unit of archiving is the whole client record (every row listed in
apps.retention.registry), not individual rows: hiding a single old
observation (a past allergy, a past risk flag) from an otherwise-active
chart would silently remove clinical history a clinician may need. An
archived client stays in place — same table, same tenant, same RLS — but
drops out of default registry lists and becomes read-only until restored.
The archived state itself lives on Patient (apps.client_registry.models),
and every archive/restore/legal-hold change writes an explicit
AuditLogEntry — there is no second history table.
"""

from django.conf import settings
from django.db import models

from apps.tenancy.models import TenantScopedModel


def _default_floor_years():
    return settings.CLINICAL_RECORD_MINIMUM_RETENTION_YEARS


def _default_forecast_windows():
    return [90, 30]


class RetentionPlatformSettings(models.Model):
    """
    Singleton (pk=1), Super Admin only: the statutory minimum retention
    ("floor") every tenant's policy is held to, per record category.

    VERIFY: the floor values are NOT a statutory figure. The defaults come
    from settings.CLINICAL_RECORD_MINIMUM_RETENTION_YEARS (7), which
    docs/09-SECURITY-COMPLIANCE.md §9.6 and config/settings/base.py both
    say must be confirmed "with legal/DHA guidance before production
    go-live"; no Act or regulation is cited anywhere in this repository.
    Until someone records the confirmed source (`floor_source`) and sets
    `floor_verified`, the scan still runs and still lists due records, but
    no archive batch can be approved — see services.approve_batch.
    """

    clinical_floor_years = models.PositiveSmallIntegerField(default=_default_floor_years)
    mental_health_floor_years = models.PositiveSmallIntegerField(default=_default_floor_years)
    financial_floor_years = models.PositiveSmallIntegerField(default=_default_floor_years)
    # For a client who was a minor at their last activity, the retention
    # clock starts no earlier than the birthday on which they reach this
    # age. VERIFY: whether the governing rule is age-based at all, and at
    # what age, is part of the same unconfirmed legal question. Null turns
    # the rule off.
    minor_clock_start_age = models.PositiveSmallIntegerField(null=True, blank=True, default=18)
    floor_verified = models.BooleanField(default=False)
    floor_source = models.TextField(
        blank=True,
        help_text="The legal instrument / DHA guidance the floor values were confirmed against.",
    )
    verified_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    # Days ahead of a record's retention end date at which Org Admins get a
    # "coming due" count notice.
    forecast_windows_days = models.JSONField(default=_default_forecast_windows, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        verbose_name_plural = "retention platform settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return "Retention platform settings"


class OrganizationRetentionPolicy(TenantScopedModel):
    """
    A tenant's own retention periods. A tenant may keep records *longer*
    than the platform floor, never shorter (enforced in the serializer and
    again in services.effective_years). Null means "use the floor".
    """

    clinical_years = models.PositiveSmallIntegerField(null=True, blank=True)
    mental_health_years = models.PositiveSmallIntegerField(null=True, blank=True)
    financial_years = models.PositiveSmallIntegerField(null=True, blank=True)
    scan_enabled = models.BooleanField(default=True)
    updated_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        verbose_name_plural = "organization retention policies"
        constraints = [
            models.UniqueConstraint(fields=["organization"], name="unique_retention_policy_per_org")
        ]

    def __str__(self):
        return f"Retention policy ({self.organization_id})"


class ArchiveBatch(TenantScopedModel):
    """
    A set of client records proposed for archiving, which an Org Admin must
    approve before anything is archived — no clinical record leaves the
    active registry without a named person's decision.
    """

    STATUS_PENDING = "PENDING_APPROVAL"
    STATUS_ARCHIVED = "ARCHIVED"
    STATUS_REJECTED = "REJECTED"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending approval"),
        (STATUS_ARCHIVED, "Archived"),
        (STATUS_REJECTED, "Rejected"),
    ]
    REASON_RETENTION = "RETENTION_EXPIRED"
    REASON_CHOICES = [(REASON_RETENTION, "Retention period ended")]

    reference = models.CharField(max_length=40, unique=True)
    reason = models.CharField(max_length=24, choices=REASON_CHOICES, default=REASON_RETENTION)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    item_count = models.PositiveIntegerField(default=0)
    archived_count = models.PositiveIntegerField(default=0)
    skipped_count = models.PositiveIntegerField(default=0)
    decided_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-created_at"]
        verbose_name_plural = "archive batches"

    def __str__(self):
        return f"{self.reference} ({self.get_status_display()})"


class ArchiveBatchItem(TenantScopedModel):
    """One client in a batch, with the retention arithmetic that put it there."""

    OUTCOME_PENDING = "PENDING"
    OUTCOME_ARCHIVED = "ARCHIVED"
    OUTCOME_SKIPPED = "SKIPPED"
    OUTCOME_CHOICES = [
        (OUTCOME_PENDING, "Pending"),
        (OUTCOME_ARCHIVED, "Archived"),
        (OUTCOME_SKIPPED, "Skipped"),
    ]

    batch = models.ForeignKey(ArchiveBatch, on_delete=models.PROTECT, related_name="items")
    patient = models.ForeignKey(
        "client_registry.Patient", on_delete=models.PROTECT, related_name="archive_batch_items"
    )
    last_activity_at = models.DateTimeField()
    retention_years = models.PositiveSmallIntegerField()
    retention_ends_on = models.DateField()
    outcome = models.CharField(max_length=10, choices=OUTCOME_CHOICES, default=OUTCOME_PENDING)
    skip_reason = models.CharField(max_length=120, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["retention_ends_on"]
        constraints = [
            models.UniqueConstraint(fields=["batch", "patient"], name="unique_patient_per_batch")
        ]

    def __str__(self):
        return f"{self.batch_id} / {self.patient_id}"


class RetentionScanRun(TenantScopedModel):
    """
    One execution of the retention scan for one organization — the evidence
    that the scan ran, what it found, and whether it could act, so a
    missing or failing scan is visible rather than silent.
    """

    OUTCOME_OK = "OK"
    OUTCOME_SKIPPED = "SKIPPED_DISABLED"
    OUTCOME_FAILED = "FAILED"
    OUTCOME_CHOICES = [
        (OUTCOME_OK, "Completed"),
        (OUTCOME_SKIPPED, "Skipped — scan disabled for this organization"),
        (OUTCOME_FAILED, "Failed"),
    ]

    outcome = models.CharField(max_length=20, choices=OUTCOME_CHOICES)
    due_count = models.PositiveIntegerField(default=0)
    forecast = models.JSONField(default=dict, blank=True)
    batch = models.ForeignKey(
        ArchiveBatch, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    floor_verified = models.BooleanField(default=False)
    error = models.TextField(blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-created_at"]

    def __str__(self):
        return f"Scan {self.organization_id} {self.created_at:%Y-%m-%d} {self.outcome}"
