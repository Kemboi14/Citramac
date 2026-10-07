"""
Data protection & digital-health compliance — the system-side obligations in
the CAFRIC legal opinion of 2 October 2026 (Udalang' & Mwiti Associates),
docs/16-DATA-PROTECTION-COMPLIANCE.md:

- Breach notification tracks with statutory clocks (opinion §10).
- Data subject requests: access, portability, correction, objection,
  restriction, with a verified, approved export (opinion §11; DPA s.26, s.38;
  Digital Health Act s.36). Erasure keeps its own dual-approval flow
  (client_registry.ErasureRequest).
- Platform support access to tenant clinical data only on the tenant's
  authorisation (opinion §4.2, §6: processing outside the tenant's
  instructions makes CAFRIC a controller — DPA s.42(3)).
- Tenant compliance profile: ODPC registration evidence, processing-agreement
  status, compliance warranty, DPO contact (opinion §4.3, §5, §6).
"""

from datetime import timedelta

from django.db import models
from django.utils import timezone

from apps.client_registry.models import Patient
from apps.tenancy.models import TenantScopedModel, TimestampedModel

# Notification deadlines, in hours from becoming aware of the breach — legal
# opinion of 2 Oct 2026, §10 (DPA s.43; Digital Health (Health Information
# Management Procedures) Regulations, 2025). Data subjects: "without delay"
# (no fixed hours), so their track is due immediately.
BREACH_DEADLINE_HOURS = {
    "TENANT_CONTROLLER": 48,
    "ODPC": 72,
    "DHA": 48,
    "DATA_SUBJECTS": 0,
}


class PlatformComplianceSettings(TimestampedModel):
    """Platform-wide (CAFRIC) settings. Singleton (pk=1). Legal wording is
    entered by CAFRIC from its counsel — never written by the system."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    dpo_name = models.CharField(max_length=150, blank=True)
    dpo_email = models.EmailField(blank=True)
    dpo_phone = models.CharField(max_length=32, blank=True)
    warranty_version = models.CharField(max_length=32, blank=True)
    warranty_text = models.TextField(blank=True)
    updated_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class TenantComplianceProfile(TenantScopedModel):
    """One per tenant. Registration / agreement fields are recorded by platform
    staff once verified; DPO contact and the warranty are the tenant's own."""

    odpc_registration_number = models.CharField(max_length=64, blank=True)
    odpc_registration_expires_on = models.DateField(null=True, blank=True)
    odpc_evidence = models.FileField(upload_to="compliance/odpc/%Y/%m/", null=True, blank=True)
    odpc_verified_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    odpc_verified_at = models.DateTimeField(null=True, blank=True)
    dpa_version = models.CharField("Data processing agreement version", max_length=32, blank=True)
    dpa_signed_on = models.DateField(null=True, blank=True)
    warranty_version = models.CharField(max_length=32, blank=True)
    warranty_accepted_at = models.DateTimeField(null=True, blank=True)
    warranty_accepted_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    dpo_name = models.CharField(max_length=150, blank=True)
    dpo_email = models.EmailField(blank=True)
    dpo_phone = models.CharField(max_length=32, blank=True)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["organization"], name="one_compliance_profile_per_org")
        ]

    def gaps(self, platform_settings=None):
        """Plain-language list of what is still missing (empty = complete)."""
        platform_settings = platform_settings or PlatformComplianceSettings.get_solo()
        missing = []
        if not self.odpc_registration_number or not self.odpc_verified_at:
            missing.append("ODPC registration not verified")
        elif (
            self.odpc_registration_expires_on
            and self.odpc_registration_expires_on < timezone.localdate()
        ):
            missing.append("ODPC registration expired")
        if not self.dpa_signed_on:
            missing.append("Data processing agreement not signed")
        if not platform_settings.warranty_version:
            missing.append("Platform compliance warranty wording not published")
        elif self.warranty_version != platform_settings.warranty_version:
            missing.append("Compliance warranty not accepted (current version)")
        if not self.dpo_email and not self.dpo_phone:
            missing.append("Data Protection Officer contact not recorded")
        return missing


class SupportAccessGrant(TenantScopedModel):
    """A tenant's authorisation for named platform staff to reach its clinical
    data for a stated reason and a limited time."""

    STATUS_REQUESTED = "REQUESTED"
    STATUS_APPROVED = "APPROVED"
    STATUS_DECLINED = "DECLINED"
    STATUS_REVOKED = "REVOKED"
    STATUS_CHOICES = [
        (STATUS_REQUESTED, "Requested"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_DECLINED, "Declined"),
        (STATUS_REVOKED, "Revoked"),
    ]
    MAX_HOURS = 72

    requested_by = models.ForeignKey(
        "accounts.User", on_delete=models.PROTECT, related_name="support_access_requests"
    )
    reason = models.TextField()
    reference = models.CharField("Support ticket reference", max_length=64, blank=True)
    duration_hours = models.PositiveSmallIntegerField(default=4)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_REQUESTED)
    decided_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["-created_at"]

    @property
    def is_active(self):
        return (
            self.status == self.STATUS_APPROVED
            and self.expires_at is not None
            and self.expires_at > timezone.now()
        )

    @property
    def display_status(self):
        if self.status == self.STATUS_APPROVED and not self.is_active:
            return "EXPIRED"
        return self.status


class BreachIncident(TenantScopedModel):
    ROLE_CHOICES = [
        ("CONTROLLER", "Reported by the facility (data controller)"),
        ("PROCESSOR", "Reported by the platform (data processor)"),
    ]
    RISK_CHOICES = [
        ("UNLIKELY", "Unlikely to result in a risk to data subjects"),
        ("RISK", "Likely to result in a risk of harm"),
        ("HIGH_RISK", "Likely to result in a high risk"),
    ]
    STATUS_CHOICES = [("OPEN", "Open"), ("CONTAINED", "Contained"), ("CLOSED", "Closed")]

    reference = models.CharField(max_length=32)
    title = models.CharField(max_length=200)
    description = models.TextField()
    reported_role = models.CharField(max_length=10, choices=ROLE_CHOICES)
    became_aware_at = models.DateTimeField()
    occurred_at = models.DateTimeField(null=True, blank=True)
    involves_health_data = models.BooleanField(default=True)
    data_categories = models.TextField(blank=True)
    subjects_affected = models.PositiveIntegerField(null=True, blank=True)
    risk_level = models.CharField(max_length=10, choices=RISK_CHOICES)
    containment_actions = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="OPEN")
    reported_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-became_aware_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "reference"], name="unique_breach_reference_per_org"
            )
        ]


class BreachNotification(TenantScopedModel):
    TRACK_CHOICES = [
        ("TENANT_CONTROLLER", "Platform → facility (as data controller)"),
        ("ODPC", "Office of the Data Protection Commissioner"),
        ("DHA", "Digital Health Agency (Chief Executive Officer)"),
        ("DATA_SUBJECTS", "Affected data subjects"),
    ]

    incident = models.ForeignKey(
        BreachIncident, on_delete=models.CASCADE, related_name="notifications"
    )
    track = models.CharField(max_length=20, choices=TRACK_CHOICES)
    required = models.BooleanField(default=True)
    due_at = models.DateTimeField()
    notified_at = models.DateTimeField(null=True, blank=True)
    notified_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    method = models.CharField(max_length=100, blank=True)
    reference = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["due_at"]
        constraints = [
            models.UniqueConstraint(fields=["incident", "track"], name="one_track_per_incident")
        ]

    @property
    def is_overdue(self):
        return self.required and self.notified_at is None and self.due_at < timezone.now()


def breach_tracks(incident):
    """Which notification tracks an incident needs, and when each is due."""
    aware = incident.became_aware_at
    tracks = {
        "ODPC": incident.risk_level in ("RISK", "HIGH_RISK"),
        "DHA": incident.involves_health_data,
        "DATA_SUBJECTS": incident.risk_level == "HIGH_RISK",
    }
    if incident.reported_role == "PROCESSOR":
        tracks["TENANT_CONTROLLER"] = True
    return {
        track: (required, aware + timedelta(hours=BREACH_DEADLINE_HOURS[track]))
        for track, required in tracks.items()
    }


class DataSubjectRequest(TenantScopedModel):
    TYPE_CHOICES = [
        ("ACCESS", "Access / copy of health record"),
        ("PORTABILITY", "Data portability"),
        ("CORRECTION", "Correction of false or misleading data"),
        ("OBJECTION", "Objection to processing"),
        ("RESTRICTION", "Restriction of processing"),
    ]
    STATUS_CHOICES = [
        ("RECEIVED", "Received"),
        ("APPROVED", "Verified & approved"),
        ("FULFILLED", "Fulfilled"),
        ("DECLINED", "Declined"),
    ]
    REQUESTER_CHOICES = [("SELF", "Client"), ("REPRESENTATIVE", "Authorised representative")]
    EXPORTABLE = ("ACCESS", "PORTABILITY")

    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="data_subject_requests"
    )
    request_type = models.CharField(max_length=12, choices=TYPE_CHOICES)
    received_at = models.DateTimeField(default=timezone.now)
    received_in_writing = models.BooleanField(default=True)
    requester = models.CharField(max_length=16, choices=REQUESTER_CHOICES, default="SELF")
    requester_name = models.CharField(max_length=150, blank=True)
    details = models.TextField(blank=True)
    logged_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="RECEIVED")
    identity_verification = models.CharField(max_length=255, blank=True)
    decided_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_notes = models.TextField(blank=True)
    fulfilled_at = models.DateTimeField(null=True, blank=True)
    fulfilled_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["-received_at"]
