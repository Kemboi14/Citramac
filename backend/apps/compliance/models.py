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

# Notification deadlines, in hours. Sources read from the gazetted texts
# (2026-10-26; copies of the research notes are not kept in the repo):
# - TENANT_CONTROLLER: processor → controller "without delay and where
#   reasonably practicable, within forty-eight hours" — DPA 2019 s.43(3).
# - ODPC: "within seventy-two hours of becoming aware" — DPA s.43(1)(a);
#   a late notice must give reasons for the delay — s.43(2).
# - DHA: Form HMIS 1 to the Digital Health Agency CEO "within forty-eight
#   hours of becoming aware" — Digital Health (Health Information Management
#   Procedures) Regulations 2025 (LN 76/2025), reg. 11(2)(a).
# - DHA_FOLLOWUP: corrective measures, mitigation and rectification timeline
#   "within seventy-two hours of the notification" — reg. 11(2)(b); counted
#   from when the DHA notice was actually made.
# - DATA_SUBJECTS: "in writing within a reasonably practical period" —
#   DPA s.43(1)(b): no fixed hours, so never shown as overdue.
# VERIFY: whether s.43 has been amended since the 2019 text; DHA has not
# published a submission channel for Form HMIS 1; whether reg. 11(2)'s
# "health data controller of a digital health solution" means each facility,
# CITRAMAC, or both — owner to confirm with DHA / counsel.
BREACH_DEADLINE_HOURS = {
    "TENANT_CONTROLLER": 48,
    "ODPC": 72,
    "DHA": 48,
    "DHA_FOLLOWUP": 72,
    "DATA_SUBJECTS": 0,
}
NO_FIXED_DEADLINE = {"DATA_SUBJECTS"}

# Data Protection (General) Regulations 2021 (LN 263/2021), reg. 37 and the
# Second Schedule: a breach of a data subject's name or identification number
# together with any of these classes "amounts to notifiable data breach under
# section 43". Only the items relevant to a mental-health and addiction
# service are listed by name; OTHER covers the rest of the Schedule.
SECOND_SCHEDULE_CATEGORIES = [
    ("MENTAL_DISORDER", "Assessment, diagnosis or treatment of a mental disorder (item 16(c))"),
    ("SUBSTANCE_ABUSE", "Assessment, diagnosis or treatment of substance abuse and addiction (item 16(d))"),
    ("STI", "Assessment, diagnosis or treatment of a sexually transmitted disease (item 16(a))"),
    ("HIV", "Assessment, diagnosis or treatment of HIV infection (item 16(b))"),
    ("SUICIDE", "Suicide or attempted suicide of the individual (item 19)"),
    ("ABUSE", "Domestic abuse, child abuse or sexual abuse (item 20)"),
    ("CHILD_PROTECTION", "A child in conflict with the law or in need of care and protection (item 5)"),
    ("OTHER", "Another class of personal data in the Second Schedule"),
]


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
    # Form HMIS 1 asks for the digital health solution's "DHS Certification
    # of Compliance No." — recorded as issued by DHA, never derived.
    dhs_certification_number = models.CharField(max_length=64, blank=True)

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
    # The four causes both the ODPC online form and DHA Form HMIS 1 offer.
    CAUSE_CHOICES = [
        ("MALICIOUS", "Malicious or criminal attack"),
        ("SYSTEM_FAULT", "System fault"),
        ("HUMAN_ERROR", "Human error"),
        ("OTHER", "Other"),
    ]
    SUBJECTS_EXEMPTION_CHOICES = [
        ("SAFEGUARDS", "Appropriate security safeguards (e.g. encryption) protect the data — DPA s.43(6)"),
        ("IDENTITY_UNKNOWN", "The data subjects' identity cannot be established — DPA s.43(1)(b)"),
        ("INVESTIGATION", "Delayed for the prevention, detection or investigation of an offence — DPA s.43(4)"),
    ]

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
    # Measures to mitigate the harm — reg. 38(1)(g)(i).
    containment_actions = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="OPEN")

    # How it happened — reg. 38(1)(c); cause as the ODPC form / HMIS 1 ask it.
    cause = models.CharField(max_length=16, choices=CAUSE_CHOICES, blank=True)
    how_it_occurred = models.TextField(blank=True)
    # Notifiability test — reg. 37. The controller's own reasoning is part of
    # the notice to the Data Commissioner — reg. 38(1)(b).
    identifies_subjects = models.BooleanField(
        "Names or identification numbers were involved", default=False
    )
    schedule_categories = models.JSONField(default=list, blank=True)
    credentials_exposed = models.BooleanField(
        "Account identifiers with passwords, access codes or biometrics", default=False
    )
    publicly_available_only = models.BooleanField(
        "Only publicly available data, or data disclosed as written law requires", default=False
    )
    notifiability_reasoning = models.TextField(blank=True)
    # Risk scored as the ODPC DPIA guidance's risk register does: likelihood
    # and impact on a 1–5 scale (optional; the statutory test is reg. 37).
    likelihood = models.PositiveSmallIntegerField(null=True, blank=True)
    impact = models.PositiveSmallIntegerField(null=True, blank=True)
    # Effects / potential harm — DPA s.43(8)(b), reg. 38(1)(f).
    likely_harm = models.TextField(blank=True)
    # Remedying the cause and preventing recurrence — reg. 38(1)(g)(ii).
    remedy_actions = models.TextField(blank=True)
    # What the data subjects should do to protect themselves — s.43(5)(c).
    subject_guidance = models.TextField(blank=True)
    # Identity of the unauthorised person, where known — s.43(5)(d).
    unauthorised_party = models.TextField(blank=True)
    other_entities_affected = models.TextField(blank=True)
    other_reports = models.TextField("Police or other regulators told", blank=True)
    # Timelines for rectifying the breach — reg. 11(2)(b)(iii).
    rectification_timeline = models.TextField(blank=True)
    # Not telling the data subjects needs a lawful ground, and the ground goes
    # into the notice to the Data Commissioner — reg. 38(2).
    subjects_exemption = models.CharField(
        max_length=16, choices=SUBJECTS_EXEMPTION_CHOICES, blank=True
    )
    subjects_exemption_grounds = models.TextField(blank=True)
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


    @property
    def is_notifiable(self):
        """Reg. 37: notifiable by the kind of data involved, before any risk judgement."""
        if self.publicly_available_only:
            return False
        return bool(self.identifies_subjects and self.schedule_categories) or self.credentials_exposed

    @property
    def real_risk_of_harm(self):
        """DPA s.43(1)'s trigger: notifiable under reg. 37, or assessed as a risk of harm."""
        return self.is_notifiable or self.risk_level in ("RISK", "HIGH_RISK")

    @property
    def risk_score(self):
        if self.likelihood and self.impact:
            return self.likelihood * self.impact
        return None


class BreachIncidentEvent(TenantScopedModel):
    """
    The incident's chronology, append-only — the "chronological account of
    the steps taken" the notice to the Data Commissioner must give
    (reg. 38(1)(b)), and the facts/effects/remedial-action record s.43(8)
    requires for every breach, notifiable or not.
    """

    incident = models.ForeignKey(BreachIncident, on_delete=models.CASCADE, related_name="events")
    occurred_at = models.DateTimeField(default=timezone.now)
    note = models.TextField()
    recorded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["occurred_at", "created_at"]


class BreachNotification(TenantScopedModel):
    TRACK_CHOICES = [
        ("TENANT_CONTROLLER", "Platform → facility (as data controller)"),
        ("ODPC", "Office of the Data Protection Commissioner"),
        ("DHA", "Digital Health Agency (Chief Executive Officer) — Form HMIS 1"),
        ("DHA_FOLLOWUP", "Digital Health Agency — corrective measures follow-up"),
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
    # Required when made after the deadline — DPA s.43(2); HMIS 1 asks too.
    late_reason = models.TextField(blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["due_at"]
        constraints = [
            models.UniqueConstraint(fields=["incident", "track"], name="one_track_per_incident")
        ]

    @property
    def has_deadline(self):
        return self.track not in NO_FIXED_DEADLINE

    @property
    def is_overdue(self):
        return (
            self.has_deadline
            and self.required
            and self.notified_at is None
            and self.due_at < timezone.now()
        )


def breach_tracks(incident, dha_notified_at=None):
    """Which notification tracks an incident needs, and when each is due."""
    aware = incident.became_aware_at
    harm = incident.real_risk_of_harm
    tracks = {
        "ODPC": harm,
        "DHA": incident.involves_health_data,
        "DHA_FOLLOWUP": incident.involves_health_data,
        "DATA_SUBJECTS": harm
        and incident.subjects_exemption not in ("SAFEGUARDS", "IDENTITY_UNKNOWN"),
    }
    if incident.reported_role == "PROCESSOR":
        tracks["TENANT_CONTROLLER"] = True
    due = {track: aware + timedelta(hours=BREACH_DEADLINE_HOURS[track]) for track in tracks}
    # The follow-up runs from the DHA notice itself; until it is made, from its deadline.
    due["DHA_FOLLOWUP"] = (dha_notified_at or due["DHA"]) + timedelta(
        hours=BREACH_DEADLINE_HOURS["DHA_FOLLOWUP"]
    )
    return {track: (required, due[track]) for track, required in tracks.items()}


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
