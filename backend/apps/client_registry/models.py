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
        ("NOT_SAID", "Prefer not to say"),
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
    # Registration "Social & personal details" (served value sets of the same
    # codes in apps.care_pathway.valuesets). Stored locally; employment,
    # occupation and disability are not emitted in FHIR (project owner decision).
    MARITAL_STATUS_CHOICES = [
        ("SINGLE", "Single"),
        ("MARRIED", "Married"),
        ("SEPARATED", "Separated"),
        ("DIVORCED", "Divorced"),
        ("WIDOWED", "Widowed"),
        ("PARTNERED", "Partnered"),
        ("NOT_STATED", "Not stated"),
        ("NOT_SAID", "Prefer not to say"),
    ]
    EMPLOYMENT_STATUS_CHOICES = [
        ("EMPLOYED", "Employed"),
        ("SELF_EMPLOYED", "Self-employed"),
        ("UNEMPLOYED", "Unemployed"),
        ("STUDENT", "Student"),
        ("RETIRED", "Retired"),
        ("UNABLE_TO_WORK", "Unable to work"),
        ("NOT_STATED", "Not stated"),
        ("NOT_SAID", "Prefer not to say"),
    ]
    DISABILITY_CHOICES = [
        ("NO", "No"),
        ("YES", "Yes"),
        ("NOT_SAID", "Prefer not to say"),
        ("NOT_KNOWN", "Not known"),
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
    employment_status = models.CharField(
        max_length=32, choices=EMPLOYMENT_STATUS_CHOICES, blank=True
    )
    # Was a Boolean before migration 0022 (True → YES, False → NO).
    living_with_disability = models.CharField(max_length=10, choices=DISABILITY_CHOICES, blank=True)
    disability_details = models.TextField("Disability / support needs", blank=True)

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
    # INT-06 / DATA-04: where the allergy record as a whole came from (a code of the
    # served `allergy-info-source` value set) and the last "Confirm — unchanged".
    allergy_info_source = models.CharField(max_length=48, blank=True)
    allergy_confirmed_at = models.DateTimeField(null=True, blank=True)
    allergy_confirmed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
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

    # Temporary → permanent merge (CLAUDE.md §4: identifiers are sliced, never
    # overwritten). The surviving record keeps every clinical row; the merged
    # record stays addressable and maps to FHIR `Patient.link` (replaced-by).
    merged_into = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="merged_from"
    )
    merged_at = models.DateTimeField(null=True, blank=True)

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
            "merged_into",
            "merged_at",
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
        return f"UNKNOWN CLIENT — {self.citramac_number or self.id}"


class EmergencyContact(TenantScopedModel):
    # BROUGHT_BY: the person who brought or referred an emergency arrival
    # (registration "Emergency — identity unknown"). Still a FHIR RelatedPerson,
    # but never coded as next of kin.
    ROLE_CONTACT = "CONTACT"
    ROLE_BROUGHT_BY = "BROUGHT_BY"
    ROLE_CHOICES = [
        (ROLE_CONTACT, "Next of kin / contact"),
        (ROLE_BROUGHT_BY, "Brought or referred the client"),
    ]

    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="emergency_contacts"
    )
    contact_role = models.CharField(max_length=12, choices=ROLE_CHOICES, default=ROLE_CONTACT)
    name = models.CharField(max_length=255)
    relationship = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    # Registration (HIE needs): guardian status and whether the client has
    # agreed family may be involved in their care. Maps to FHIR RelatedPerson.
    is_guardian = models.BooleanField(default=False)
    guardian_legal_status = models.CharField(max_length=100, blank=True)
    may_be_informed = models.BooleanField(
        default=False, help_text="Client agreed this person may be told about their care."
    )
    # Statutory applicant details (master prompt LGL-I-B-02/05): the person's
    # own National ID/Passport number — masked in the UI except for authorised
    # roles (LGL-DOC-06) — and free-text detail beside the coded relationship.
    id_number = models.CharField(max_length=64, blank=True)
    relationship_detail = models.CharField(max_length=150, blank=True)

    def __str__(self):
        return f"{self.name} ({self.relationship})"


class PatientIdentifier(TenantScopedModel):
    """
    One row per identifier a person carries — CLAUDE.md §4 "Identifiers are
    sliced, never overwritten". The FHIR `system` URI is *not* stored here: it
    is resolved from `settings.FHIR_IDENTIFIER_SYSTEMS` so a national system
    URI is configuration that can be set once the regulator's IG supplies it,
    never a value invented in code.
    """

    KIND_UHID = "UHID"
    KIND_CITRAMAC = "CITRAMAC"
    KIND_NATIONAL_ID = "NATIONAL_ID"
    KIND_PASSPORT = "PASSPORT"
    KIND_REFUGEE = "REFUGEE_ID"
    KIND_UNHCR = "UNHCR"
    KIND_ALIEN = "ALIEN_ID"
    KIND_BIRTH_CERT = "BIRTH_CERTIFICATE"
    KIND_IPRS = "IPRS_UPI"
    KIND_SHA = "SHA_MEMBER"
    KIND_CLIENT_REGISTRY = "CLIENT_REGISTRY_ID"
    KIND_TEMPORARY = "TEMPORARY"
    KIND_CHOICES = [
        (KIND_UHID, "UHID (facility)"),
        (KIND_CITRAMAC, "CITRAMAC number"),
        (KIND_NATIONAL_ID, "National ID"),
        (KIND_PASSPORT, "Passport"),
        (KIND_REFUGEE, "Refugee / asylum-seeker ID"),
        (KIND_UNHCR, "UNHCR number"),
        (KIND_ALIEN, "Alien ID"),
        (KIND_BIRTH_CERT, "Birth certificate"),
        (KIND_IPRS, "IPRS unique personal identifier"),
        (KIND_SHA, "SHA member number"),
        (KIND_CLIENT_REGISTRY, "National Client Registry ID"),
        (KIND_TEMPORARY, "Temporary (emergency) ID"),
    ]
    # Identifiers that must not belong to two people in one organisation.
    UNIQUE_KINDS = (
        KIND_NATIONAL_ID,
        KIND_PASSPORT,
        KIND_REFUGEE,
        KIND_UNHCR,
        KIND_ALIEN,
        KIND_BIRTH_CERT,
        KIND_IPRS,
        KIND_SHA,
        KIND_CLIENT_REGISTRY,
    )

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="identifiers")
    kind = models.CharField(max_length=24, choices=KIND_CHOICES)
    value = models.CharField(max_length=64)
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by_source = models.CharField(
        max_length=100, blank=True, help_text="Registry that verified it, e.g. IPRS (VERIFY)."
    )
    # An identifier replaced by a merge or correction is kept, flagged, never removed.
    superseded_at = models.DateTimeField(null=True, blank=True)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "kind", "value"],
                name="unique_active_identifier_per_org_kind",
                condition=models.Q(superseded_at__isnull=True),
            ),
        ]

    def __str__(self):
        return f"{self.kind}: {self.value}"


class IdentifierSequence(models.Model):
    """
    Running counter for a number series that must never be reused —
    `CIT-ER-000001` temporary (emergency) numbers. Deliberately not
    tenant-scoped: `citramac_number` is unique across the deployment and the
    TEMPORARY identifier system is one namespace, so the series is too. Holds a
    count only, never patient data. Allocated under `select_for_update`.
    """

    name = models.CharField(max_length=32, unique=True)
    last_value = models.PositiveBigIntegerField(default=0)

    def __str__(self):
        return f"{self.name}: {self.last_value}"


class AllergyRecord(TenantScopedModel):
    """One FHIR R4 AllergyIntolerance (INT-06, DATA-04).

    - `allergy_type` → AllergyIntolerance.type: ALLERGY = `allergy`, INTOLERANCE =
      `intolerance`. ADR (adverse drug reaction) has no code of its own in that
      required binding and is NOT mapped to an extension here. VERIFY: how the
      national IG represents an ADR (an intolerance with a category, a
      `reaction` manifestation, or an IG extension) before it is exported.
      Prescribing hard-stops only on ALLERGY; intolerance / ADR warn.
    - `clinical_status` → AllergyIntolerance.clinicalStatus (active | resolved).
    - `verification_status` → AllergyIntolerance.verificationStatus; "refuted" is
      how a record is removed — records are never deleted.
    - `severity` → a code of the served `allergy-severity` value set. MILD /
      MODERATE / SEVERE map to reaction.severity; ANAPHYLAXIS is a manifestation,
      not a severity — VERIFY its SNOMED CT code with the terminology server
      before export; UNKNOWN maps to no severity.
    """

    TYPE_CHOICES = [
        ("ALLERGY", "Allergy"),
        ("INTOLERANCE", "Intolerance"),
        ("ADR", "Adverse drug reaction (ADR)"),
    ]
    CLINICAL_STATUS_CHOICES = [("ACTIVE", "Active"), ("RESOLVED", "Resolved")]
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
    # Existing records default to ALLERGY: they were all treated as hard stops before.
    allergy_type = models.CharField(max_length=12, choices=TYPE_CHOICES, default="ALLERGY")
    clinical_status = models.CharField(
        max_length=10, choices=CLINICAL_STATUS_CHOICES, default="ACTIVE"
    )
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
    # Missed-appointment handling: coded reason (served value set `missed-appointment-reason`)
    # and when someone re-contacted the client.
    missed_reason = models.CharField(max_length=30, blank=True)
    dna_actioned_at = models.DateTimeField(null=True, blank=True)
    # Follow-up context (docs/17-DISCHARGE-AND-FOLLOW-UP.md). The episode is the
    # clinical spine (CLAUDE.md §4); `reason` is a code from the served
    # `follow-up-reason` value set. Manual appointments leave these blank.
    ORIGIN_CHOICES = [
        ("MANUAL", "Booked manually"),
        ("DISCHARGE", "Booked at discharge"),
        ("CARE_PLAN", "Booked from the care plan"),
    ]
    episode = models.ForeignKey(
        "care_pathway.EpisodeOfCare",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="appointments",
    )
    admission = models.ForeignKey(
        "ipd_ward.Admission",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="follow_up_appointments",
    )
    reason = models.CharField(max_length=64, blank=True)
    origin = models.CharField(max_length=16, choices=ORIGIN_CHOICES, default="MANUAL")
    booked_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Stable business identifier so a retried booking never double-books
    # (CLAUDE.md "fail safely": idempotent writes).
    client_request_id = models.CharField(max_length=64, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["scheduled_for"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "client_request_id"],
                condition=~models.Q(client_request_id=""),
                name="unique_appointment_client_request",
            )
        ]

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

    CONSENT_TYPE_CHOICES = [
        ("DATA_SHARING_HIE", "Data Sharing via National HIE"),
        ("MENTAL_HEALTH_HIE", "Sharing mental-health information on the HIE"),
        ("SUBSTANCE_USE_HIE", "Sharing substance-use information on the HIE"),
        ("FAMILY_INVOLVEMENT", "Involving family / next of kin in care"),
        # Release authorizations checked by apps.documents before any external
        # release (DOC-CI-06 / DOC-GOV-04). Same store, same FHIR Consent.
        ("EMPLOYER_COMMUNICATION", "Communicating with the client's employer"),
        ("SCHOOL_COMMUNICATION", "Communicating with the client's school / university"),
        ("RELEASE_OF_INFORMATION", "Releasing health information to a named third party"),
    ]
    DECISION_CHOICES = [
        ("NOT_ASKED", "Not yet asked"),
        ("YES", "Yes"),
        ("NO", "No"),
        ("RESTRICTED", "Restricted to the treating facility"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="consent_records")
    consent_type = models.CharField(
        max_length=32, choices=CONSENT_TYPE_CHOICES, default="DATA_SHARING_HIE"
    )
    granted = models.BooleanField()
    # `granted` stays the simple yes/no read by existing code; `decision` keeps
    # the nuance (restricted, not asked) and is the source of truth for new code.
    decision = models.CharField(max_length=12, choices=DECISION_CHOICES, default="YES")
    purpose = models.CharField(max_length=255, blank=True)
    valid_until = models.DateTimeField(null=True, blank=True)
    consent_text_version = models.CharField(max_length=32)
    consent_text_snapshot = models.TextField()
    captured_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    captured_at = models.DateTimeField(default=timezone.now)
    # Release authorizations only (FHIR Consent.provision.actor / .class):
    # who may receive the information (blank = any recipient of this consent
    # type) and which data classes it covers (apps.documents.catalogue
    # DATA_CLASSES). An empty scope authorizes no optional class.
    recipient = models.CharField(max_length=255, blank=True)
    disclosure_scope = models.JSONField(default=list, blank=True)

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
