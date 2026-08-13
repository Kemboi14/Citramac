from django.db import models
from django.utils import timezone

from apps.tenancy.models import Branch, TenantScopedModel


class Patient(TenantScopedModel):
    """docs/06-DATA-MODEL.md §6.2 — Module 1."""

    GENDER_CHOICES = [("MALE", "Male"), ("FEMALE", "Female"), ("OTHER", "Other")]
    MARITAL_STATUS_CHOICES = [
        ("SINGLE", "Single"),
        ("MARRIED", "Married"),
        ("DIVORCED", "Divorced"),
        ("WIDOWED", "Widowed"),
    ]
    ALLERGY_STATUS_CHOICES = [
        ("NONE", "None"),
        ("ACTIVE_ALLERGIES", "Active Allergies"),
        ("UNKNOWN", "Unknown"),
    ]
    CARE_TYPE_CHOICES = [
        ("OUTPATIENT", "Outpatient"),
        ("INPATIENT", "Inpatient"),
        ("POSTTREATMENT_SUPPORT", "Posttreatment Support"),
    ]

    upi = models.CharField(
        "Unique Personal Identifier (IPRS)", max_length=64, blank=True, db_index=True
    )
    uhid_number = models.CharField("UHID Number", max_length=64, blank=True)
    citramac_number = models.CharField(max_length=32, blank=True, unique=True)

    first_name = models.CharField(max_length=150)
    last_name = models.CharField(max_length=150)
    middle_other_names = models.CharField(max_length=150, blank=True)
    gender = models.CharField(max_length=10, choices=GENDER_CHOICES)
    date_of_birth = models.DateField()
    marital_status = models.CharField(max_length=10, choices=MARITAL_STATUS_CHOICES, blank=True)
    nationality = models.CharField(max_length=100, blank=True)
    occupation = models.CharField(max_length=150, blank=True)
    employment_status = models.CharField(max_length=32, blank=True)
    living_with_disability = models.BooleanField(default=False)

    national_id = models.CharField(max_length=32, blank=True)
    passport_number = models.CharField(max_length=32, blank=True)

    contact_phone = models.CharField(max_length=32, blank=True)
    contact_email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    county = models.CharField(max_length=100, blank=True)

    next_of_kin = models.ForeignKey(
        "client_registry.EmergencyContact",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    allergy_status = models.CharField(
        max_length=20, choices=ALLERGY_STATUS_CHOICES, default="UNKNOWN"
    )

    doctor = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    registered_at = models.DateTimeField(default=timezone.now)
    registered_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    referral_source = models.CharField(max_length=255, blank=True)
    referral_mode = models.CharField(max_length=255, blank=True)
    referral_date = models.DateField(null=True, blank=True)

    patient_category = models.CharField(
        max_length=32, choices=CARE_TYPE_CHOICES, default="OUTPATIENT"
    )
    insurer_details = models.CharField(max_length=255, blank=True)

    consent_data_sharing = models.BooleanField(default=False)
    consent_captured_at = models.DateTimeField(null=True, blank=True)
    consent_document = models.ForeignKey(
        "client_registry.Attachment",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "uhid_number"],
                name="unique_uhid_per_org",
                condition=~models.Q(uhid_number=""),
            )
        ]

    def __str__(self):
        return f"{self.first_name} {self.last_name} ({self.uhid_number})"

    @property
    def age_years(self):
        today = timezone.localdate()
        years = today.year - self.date_of_birth.year
        if (today.month, today.day) < (self.date_of_birth.month, self.date_of_birth.day):
            years -= 1
        return years

    def get_full_name(self):
        return f"{self.first_name} {self.middle_other_names} {self.last_name}".replace(
            "  ", " "
        ).strip()


class EmergencyContact(TenantScopedModel):
    patient = models.ForeignKey(
        Patient, on_delete=models.CASCADE, related_name="emergency_contacts"
    )
    name = models.CharField(max_length=255)
    relationship = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)

    def __str__(self):
        return f"{self.name} ({self.relationship})"


class AllergyRecord(TenantScopedModel):
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="allergy_records")
    substance = models.CharField(max_length=255)
    reaction = models.CharField(max_length=255, blank=True)
    severity = models.CharField(max_length=32, blank=True)
    noted_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return self.substance


class InsuranceCoverage(TenantScopedModel):
    SCHEME_TYPE_CHOICES = [
        ("SHA_PRIMARY", "SHA Primary Healthcare Fund"),
        ("SHA_SHIF", "SHA Social Health Insurance Fund"),
        ("SHA_ECCIF", "SHA Emergency, Chronic & Critical Illness Fund"),
        ("PRIVATE", "Private"),
        ("CORPORATE", "Corporate"),
        ("CASH", "Cash"),
    ]

    patient = models.ForeignKey(
        Patient, on_delete=models.CASCADE, related_name="insurance_coverages"
    )
    scheme_type = models.CharField(max_length=20, choices=SCHEME_TYPE_CHOICES)
    policy_number = models.CharField(max_length=100, blank=True)
    corporate_account = models.CharField(max_length=255, blank=True)

    sha_verified = models.BooleanField(default=False)
    sha_member_status = models.CharField(max_length=100, blank=True)
    sha_premium_compliant = models.BooleanField(default=False)
    sha_last_checked_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.get_scheme_type_display()} — {self.patient}"


class Appointment(TenantScopedModel):
    STATUS_CHOICES = [
        ("SCHEDULED", "Scheduled"),
        ("CHECKED_IN", "Checked In"),
        ("COMPLETED", "Completed"),
        ("CANCELLED", "Cancelled"),
        ("NO_SHOW", "No Show"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="appointments")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, null=True, blank=True)
    provider = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    scheduled_for = models.DateTimeField()
    appointment_type = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="SCHEDULED")
    notes = models.TextField(blank=True)

    def __str__(self):
        return f"{self.patient} @ {self.scheduled_for:%Y-%m-%d %H:%M}"


class Attachment(TenantScopedModel):
    CLASSIFICATION_CHOICES = [
        ("HISTORICAL", "Historical File Scans"),
        ("CURRENT", "Current Clinical Records"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to="attachments/%Y/%m/")
    classification = models.CharField(max_length=20, choices=CLASSIFICATION_CHOICES)
    description = models.CharField(max_length=255, blank=True)
    uploaded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    uploaded_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return self.file.name


class ConsentRecord(TenantScopedModel):
    """
    Append-only consent history — docs/09-SECURITY-COMPLIANCE.md §9.5:
    "Explicit, timestamped, revocable consent capture ... stored with the
    exact consent text version shown at capture time (for legal
    defensibility if the consent language changes later)." `Patient.consent_data_sharing`/
    `consent_captured_at` remain a denormalized "current state" cache
    (updated by apps.client_registry.consent.capture_consent); this table
    is the full, immutable history a DHA/DPA audit would actually want —
    a single mutable boolean can't show what was consented to, when, or
    that it was later revoked and re-granted.
    """

    CONSENT_TYPE_CHOICES = [("DATA_SHARING_HIE", "Data Sharing via National HIE")]

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="consent_records")
    consent_type = models.CharField(
        max_length=32, choices=CONSENT_TYPE_CHOICES, default="DATA_SHARING_HIE"
    )
    granted = models.BooleanField()
    consent_text_version = models.CharField(max_length=32)
    consent_text_snapshot = models.TextField()
    captured_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    captured_at = models.DateTimeField(default=timezone.now)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-captured_at"]

    def __str__(self):
        verb = "Granted" if self.granted else "Revoked"
        consent_type = self.get_consent_type_display()
        return f"{verb} {consent_type} for {self.patient} ({self.consent_text_version})"


class ErasureRequest(TenantScopedModel):
    """
    Right-to-Erasure workflow — docs/09-SECURITY-COMPLIANCE.md §9.5:
    "distinct from routine soft-delete, requires Org Admin + a compliance
    officer sign-off, produces an audit record of the erasure itself, and
    enforces any legal retention minimums ... flag this conflict to the
    requester rather than silently refusing or silently complying."
    Execution (apps.client_registry.erasure.execute_erasure) anonymizes the
    Patient's identifying fields in place rather than deleting the row —
    the underlying clinical/financial records have their own statutory
    retention requirements independent of this request.
    """

    STATUS_PENDING = "PENDING"
    STATUS_RETENTION_CONFLICT = "RETENTION_CONFLICT"
    STATUS_REJECTED = "REJECTED"
    STATUS_COMPLETED = "COMPLETED"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_RETENTION_CONFLICT, "Retention Conflict"),
        (STATUS_REJECTED, "Rejected"),
        (STATUS_COMPLETED, "Completed"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="erasure_requests")
    requested_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)

    org_admin_approved_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    org_admin_approved_at = models.DateTimeField(null=True, blank=True)
    compliance_officer_approved_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    compliance_officer_approved_at = models.DateTimeField(null=True, blank=True)

    rejection_reason = models.TextField(blank=True)
    retention_conflict_detail = models.TextField(blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-created_at"]

    @property
    def is_fully_approved(self):
        return bool(self.org_admin_approved_at and self.compliance_officer_approved_at)

    def __str__(self):
        return f"Erasure request for {self.patient} ({self.get_status_display()})"
