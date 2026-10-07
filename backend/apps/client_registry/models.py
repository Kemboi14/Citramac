from django.db import models
from django.utils import timezone

from apps.tenancy.models import Branch, TenantScopedModel


class Patient(TenantScopedModel):
    """docs/06-DATA-MODEL.md §6.2 — Module 1."""

    GENDER_CHOICES = [
        ("MALE", "Male"),
        ("FEMALE", "Female"),
        ("OTHER", "Intersex / other"),
        ("NOT_STATED", "Not stated"),
    ]
    # docs/15-CLINICAL-WORKSPACE-V3.md §1.4 — the three registration tiers.
    IDENTITY_IDENTIFIED = "IDENTIFIED"
    IDENTITY_UNIDENTIFIED = "UNIDENTIFIED"
    IDENTITY_UNKNOWN = "UNKNOWN"
    IDENTITY_STATUS_CHOICES = [
        (IDENTITY_IDENTIFIED, "Identified"),
        (IDENTITY_UNIDENTIFIED, "Unidentified — provisional record"),
        (IDENTITY_UNKNOWN, "Unknown — minimum details only"),
    ]
    PRONOUN_CHOICES = [
        ("SHE_HER", "she/her"),
        ("HE_HIM", "he/him"),
        ("THEY_THEM", "they/them"),
        ("NOT_SAID", "Prefer not to say"),
        ("OTHER", "Other"),
    ]
    ID_DOCUMENT_CHOICES = [
        ("NATIONAL_ID", "National ID"),
        ("PASSPORT", "Passport (foreign national)"),
        ("REFUGEE_ID", "Refugee / asylum-seeker ID"),
        ("ALIEN_ID", "Alien ID"),
        ("BIRTH_CERTIFICATE", "Birth certificate (minor)"),
        ("NONE", "None / unknown"),
    ]
    INTERPRETER_CHOICES = [
        ("NO", "No"),
        ("KISWAHILI", "Yes — Kiswahili"),
        ("OTHER_LOCAL", "Yes — other local language"),
        ("SIGN", "Yes — sign language"),
    ]
    PAYER_CHOICES = [
        ("SHA", "SHA"),
        ("SHA_PRIVATE", "SHA + private insurer"),
        ("PRIVATE", "Private insurance"),
        ("EMPLOYER", "Employer scheme"),
        ("SELF_PAY", "Self-pay"),
        ("WAIVER", "Waiver / charity"),
        ("UNKNOWN", "Unknown"),
    ]
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
    # NOT `unique=True` here — that would apply even to blank values, and
    # `citramac_number` is `readonly_fields` in PatientAdmin (so an
    # admin-created Patient always gets one blank), which used to make the
    # *second* such admin-created Patient anywhere raise a raw
    # IntegrityError. The real uniqueness constraint below excludes blanks,
    # mirroring `unique_uhid_per_org`'s existing pattern.
    citramac_number = models.CharField(max_length=32, blank=True)

    # Blank only for unidentified / unknown-identity arrivals (identity_status).
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    middle_other_names = models.CharField(max_length=150, blank=True)
    # Client profile picture — shown in the registry table, the patient
    # header, and the registration/detail modals. Optional; falls back to
    # initials everywhere in the UI when unset.
    photo = models.ImageField(upload_to="avatars/patients/%Y/%m/", null=True, blank=True)
    gender = models.CharField(max_length=10, choices=GENDER_CHOICES, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    estimated_age = models.PositiveSmallIntegerField(null=True, blank=True)

    identity_status = models.CharField(
        max_length=16, choices=IDENTITY_STATUS_CHOICES, default=IDENTITY_IDENTIFIED
    )
    identity_description = models.CharField(
        "Observed description / temporary alias", max_length=255, blank=True
    )
    identity_confirmed_at = models.DateTimeField(null=True, blank=True)
    preferred_name = models.CharField(max_length=150, blank=True)
    pronouns = models.CharField(max_length=10, choices=PRONOUN_CHOICES, blank=True)
    id_document_type = models.CharField(max_length=20, choices=ID_DOCUMENT_CHOICES, blank=True)
    id_document_number = models.CharField(max_length=64, blank=True)
    preferred_language = models.CharField(max_length=64, blank=True)
    interpreter = models.CharField(max_length=12, choices=INTERPRETER_CHOICES, blank=True)
    payer = models.CharField(max_length=12, choices=PAYER_CHOICES, blank=True)
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

    # Archive state — apps.retention. An archived client record is kept in
    # full, never deleted: it drops out of default registry lists and the
    # whole chart becomes read-only (apps.retention.guards) until restored.
    # Only apps.retention.services writes these fields.
    ARCHIVE_REASON_RETENTION = "RETENTION_EXPIRED"
    ARCHIVE_REASON_CHOICES = [(ARCHIVE_REASON_RETENTION, "Retention period ended")]
    archived_at = models.DateTimeField(null=True, blank=True, db_index=True)
    archived_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    archive_reason = models.CharField(max_length=24, choices=ARCHIVE_REASON_CHOICES, blank=True)
    # A legal hold (litigation, a regulator's request, a disputed erasure)
    # keeps the record out of every archive scan until lifted.
    legal_hold = models.BooleanField(default=False)
    legal_hold_reason = models.TextField(blank=True)
    legal_hold_set_at = models.DateTimeField(null=True, blank=True)
    legal_hold_set_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    # The only fields a save() may touch while the record is archived.
    LIFECYCLE_FIELDS = frozenset(
        {
            "archived_at",
            "archived_by",
            "archive_reason",
            "legal_hold",
            "legal_hold_reason",
            "legal_hold_set_at",
            "legal_hold_set_by",
            "updated_at",
        }
    )

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "uhid_number"],
                name="unique_uhid_per_org",
                condition=~models.Q(uhid_number=""),
            ),
            models.UniqueConstraint(
                fields=["citramac_number"],
                name="unique_citramac_number_when_set",
                condition=~models.Q(citramac_number=""),
            ),
        ]

    def __str__(self):
        return f"{self.first_name} {self.last_name} ({self.uhid_number})"

    @property
    def is_archived(self):
        return self.archived_at is not None

    @property
    def age_years(self):
        if self.date_of_birth is None:
            return self.estimated_age
        today = timezone.localdate()
        years = today.year - self.date_of_birth.year
        if (today.month, today.day) < (self.date_of_birth.month, self.date_of_birth.day):
            years -= 1
        return years

    def get_full_name(self):
        name = f"{self.first_name} {self.middle_other_names} {self.last_name}".replace(
            "  ", " "
        ).strip()
        if name:
            return name
        if self.identity_status == self.IDENTITY_UNIDENTIFIED:
            return f"Unidentified person ({self.citramac_number or self.id})"
        return f"Unknown person ({self.citramac_number or self.id})"


class EmergencyContact(TenantScopedModel):
    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="emergency_contacts"
    )
    name = models.CharField(max_length=255)
    relationship = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)

    def __str__(self):
        return f"{self.name} ({self.relationship})"


class AllergyRecord(TenantScopedModel):
    # FHIR AllergyIntolerance.verificationStatus — a client-reported allergy at
    # registration stays unconfirmed until a clinician confirms it (doc 15 §1.4).
    VERIFICATION_CHOICES = [
        ("UNCONFIRMED", "Unconfirmed (client-reported)"),
        ("CONFIRMED", "Confirmed"),
        ("REFUTED", "Refuted"),
    ]
    SOURCE_CHOICES = [
        ("REGISTRATION", "Registration"),
        ("TRIAGE", "Triage"),
        ("CLINICIAN", "Clinician"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="allergy_records")
    substance = models.CharField(max_length=255)
    reaction = models.CharField(max_length=255, blank=True)
    severity = models.CharField(max_length=32, blank=True)
    noted_at = models.DateTimeField(default=timezone.now)
    verification_status = models.CharField(
        max_length=12, choices=VERIFICATION_CHOICES, default="CONFIRMED"
    )
    source = models.CharField(max_length=12, choices=SOURCE_CHOICES, default="CLINICIAN")
    recorded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

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
        Patient, on_delete=models.PROTECT, related_name="insurance_coverages"
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
    MODE_CHOICES = [
        ("IN_PERSON", "In Person"),
        ("PHONE", "Phone"),
        ("VIDEO", "Video"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="appointments")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, null=True, blank=True)
    provider = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    scheduled_for = models.DateTimeField()
    duration_minutes = models.PositiveSmallIntegerField(default=30)
    location = models.CharField(max_length=150, blank=True)
    mode = models.CharField(max_length=16, choices=MODE_CHOICES, default="IN_PERSON")
    appointment_type = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="SCHEDULED")
    notes = models.TextField(blank=True)
    # Set by apps.client_registry.tasks.send_appointment_reminders once a
    # reminder email has gone out for this appointment, so the periodic scan
    # never double-sends. Reset to null whenever `scheduled_for` moves (see
    # AppointmentViewSet.perform_update) so a rescheduled appointment gets a
    # fresh reminder for its new time.
    reminder_sent_at = models.DateTimeField(null=True, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["scheduled_for"]

    def __str__(self):
        return f"{self.patient} @ {self.scheduled_for:%Y-%m-%d %H:%M}"


class Attachment(TenantScopedModel):
    CLASSIFICATION_CHOICES = [
        ("HISTORICAL", "Historical File Scans"),
        ("CURRENT", "Current Clinical Records"),
    ]
    CATEGORY_CHOICES = [
        ("IDENTITY", "Identity Documents"),
        ("CLINICAL", "Clinical Documents"),
        ("ASSESSMENT", "Assessments"),
        ("REFERRAL", "Referrals"),
        ("LAB_RESULT", "Lab Results"),
        ("IMAGING", "Imaging"),
        ("CONSENT", "Consents"),
        ("CORRESPONDENCE", "Correspondence"),
        ("OTHER", "Other"),
    ]
    DOC_STATUS_CHOICES = [("ACTIVE", "Active"), ("ARCHIVED", "Archived")]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="attachments")
    # Optional link to the specific inpatient admission this file was
    # uploaded for (e.g. a signed consent form or legal order attached
    # during the Admission workflow's "Attachments & handover" step) —
    # docs/07-CLINICAL-MODULES-SPEC.md Module 7. Nullable/SET_NULL: an
    # attachment always belongs to the patient first and foremost, and must
    # not disappear if the admission record it was uploaded alongside is
    # ever deleted.
    admission = models.ForeignKey(
        "ipd_ward.Admission",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="attachments",
    )
    file = models.FileField(upload_to="attachments/%Y/%m/")
    classification = models.CharField(max_length=20, choices=CLASSIFICATION_CHOICES)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default="OTHER")
    document_type = models.CharField(max_length=100, blank=True)
    document_date = models.DateField(null=True, blank=True)
    tags = models.JSONField(default=list, blank=True)
    is_favorite = models.BooleanField(default=False)
    doc_status = models.CharField(max_length=16, choices=DOC_STATUS_CHOICES, default="ACTIVE")
    description = models.CharField(max_length=255, blank=True)
    uploaded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    uploaded_at = models.DateTimeField(default=timezone.now)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-uploaded_at"]

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

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="consent_records")
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

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="erasure_requests")
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
