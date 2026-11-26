from django.db import models
from django.utils import timezone

from apps.client_registry.models import Patient
from apps.clinical_encounter.models import Encounter, PrescriptionItem
from apps.tenancy.models import Branch, TenantScopedModel


class Ward(TenantScopedModel):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.7 — ADT ward/bed allocation."""

    name = models.CharField(max_length=150)
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, null=True, blank=True)
    ward_type = models.CharField(max_length=100, blank=True)

    def __str__(self):
        return self.name


class AccommodationType(TenantScopedModel):
    """A kind of bed the facility prices separately (shared bed, shared room,
    private room, …; guide.md 2026-11-24). The Org Admin names them; each has
    its own tariff line (`billing_service`, "Bed-day — <name>") whose rate is
    set on the Service Tariff page and never invented. Retired, never deleted.
    FHIR: a local code on the bed's Location.type (not emitted yet)."""

    # How CITRAMAC's own subscription counts a room of this type (owner
    # decision 2026-11-26; apps.tenancy.subscription_billing). Set by the Org
    # Admin; blank = Unclassified (never guessed from the name). A room is
    # counted by its own type; "ward bay" is a type for beds that are not in
    # a room of their own, and is never charged as a room.
    CLASS_UNCLASSIFIED = ""
    CLASS_PRIVATE_ROOM = "PRIVATE_ROOM"
    CLASS_SHARED_ROOM = "SHARED_ROOM"
    CLASS_WARD_BAY = "WARD_BAY"
    ROOM_CLASS_CHOICES = [
        (CLASS_UNCLASSIFIED, "Unclassified"),
        (CLASS_PRIVATE_ROOM, "Private room"),
        (CLASS_SHARED_ROOM, "Shared room"),
        (CLASS_WARD_BAY, "Shared bed / ward bay — not a room"),
    ]

    name = models.CharField(max_length=100)
    billing_service = models.OneToOneField(
        "care_pathway.BillingService", on_delete=models.PROTECT, related_name="accommodation_type"
    )
    room_class = models.CharField(
        max_length=12, choices=ROOM_CLASS_CHOICES, blank=True, default=CLASS_UNCLASSIFIED
    )
    active = models.BooleanField(default=True)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta(TenantScopedModel.Meta):
        ordering = ["order", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "name"], name="unique_accommodation_type_per_org"
            )
        ]

    def __str__(self):
        return self.name


class Room(TenantScopedModel):
    """A room in a ward (FHIR Location physicalType `ro`). Optional: a bed may
    sit directly in its ward. Its accommodation type is the default for its beds."""

    ward = models.ForeignKey(Ward, on_delete=models.PROTECT, related_name="rooms")
    name = models.CharField(max_length=100)
    accommodation_type = models.ForeignKey(
        AccommodationType, on_delete=models.PROTECT, null=True, blank=True, related_name="rooms"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(fields=["ward", "name"], name="unique_room_name_per_ward")
        ]

    def __str__(self):
        return f"{self.ward.name} / {self.name}"


class Bed(TenantScopedModel):
    STATUS_CHOICES = [
        ("AVAILABLE", "Available"),
        ("OCCUPIED", "Occupied"),
        ("RESERVED", "Reserved"),
        ("MAINTENANCE", "Maintenance"),
    ]

    ward = models.ForeignKey(Ward, on_delete=models.PROTECT, related_name="beds")
    bed_number = models.CharField(max_length=50)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="AVAILABLE")
    room = models.ForeignKey(
        Room, on_delete=models.PROTECT, null=True, blank=True, related_name="beds"
    )
    # Set on the bed, or taken from its room when blank (`effective_type`).
    accommodation_type = models.ForeignKey(
        AccommodationType, on_delete=models.PROTECT, null=True, blank=True, related_name="beds"
    )

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["ward", "bed_number"], name="unique_bed_number_per_ward"
            )
        ]

    @property
    def effective_type(self):
        if self.accommodation_type_id:
            return self.accommodation_type
        return self.room.accommodation_type if self.room_id else None

    def __str__(self):
        return f"{self.ward.name} / Bed {self.bed_number}"


class Admission(TenantScopedModel):
    """
    ADT (Admission, Discharge, Transfer) — docs/07-CLINICAL-MODULES-SPEC.md §7.7.
    Voluntary/involuntary distinction and Mental Health Act (Cap. 248) legal-
    status tracking, admission-time consent/risk capture, and structured
    discharge planning are net-new here — nothing analogous existed before
    (see mockups/citramac_clinical_workspace.html's Admission screen).
    """

    STATUS_CHOICES = [
        ("ADMITTED", "Admitted"),
        ("DISCHARGED", "Discharged"),
        ("TRANSFERRED", "Transferred"),
    ]
    ADMISSION_TYPE_CHOICES = [
        ("VOLUNTARY", "Voluntary Admission"),
        ("INVOLUNTARY", "Involuntary Admission"),
    ]
    PRIORITY_CHOICES = [
        ("ROUTINE", "Routine"),
        ("URGENT", "Urgent"),
        ("EMERGENCY", "Emergency"),
    ]
    OBSERVATION_LEVEL_CHOICES = [
        ("ROUTINE", "Routine Observation"),
        ("ENHANCED", "Enhanced Observation"),
        ("CLOSE", "Close Observation"),
        ("CONTINUOUS", "Continuous Observation"),
    ]
    CONSENT_STATUS_CHOICES = [
        ("PENDING", "Consent Pending"),
        ("OBTAINED", "Consent Obtained"),
        ("DECLINED", "Consent Declined"),
    ]
    NOK_NOTIFICATION_CHOICES = [
        ("NOT_NOTIFIED", "Not Yet Notified"),
        ("NOTIFIED", "Notified"),
        ("NOT_APPLICABLE", "Notification Not Applicable"),
        ("UNABLE_TO_REACH", "Unable to Reach"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="admissions")
    encounter = models.ForeignKey(
        Encounter, on_delete=models.SET_NULL, null=True, blank=True, related_name="admissions"
    )
    bed = models.ForeignKey(Bed, on_delete=models.PROTECT, related_name="admissions")
    admitted_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    admitted_at = models.DateTimeField(default=timezone.now)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="ADMITTED")
    discharged_at = models.DateTimeField(null=True, blank=True)
    discharge_summary = models.TextField(blank=True)
    follow_up_date = models.DateField(null=True, blank=True)

    # Admission classification
    admission_type = models.CharField(
        max_length=16, choices=ADMISSION_TYPE_CHOICES, default="VOLUNTARY"
    )
    admission_source = models.CharField(max_length=100, blank=True)
    priority = models.CharField(max_length=16, choices=PRIORITY_CHOICES, default="ROUTINE")
    # docs/15-CLINICAL-WORKSPACE-V3.md §1.10 — triage-scale clinical priority
    # and the EpisodeOfCare this inpatient Encounter (class IMP) sits inside.
    clinical_priority = models.CharField(
        max_length=8,
        choices=[("RED", "RED"), ("ORANGE", "ORANGE"), ("YELLOW", "YELLOW"), ("GREEN", "GREEN")],
        blank=True,
    )
    episode = models.ForeignKey(
        "care_pathway.EpisodeOfCare",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="admissions",
    )

    # Clinical reason for admission
    reason_for_admission = models.TextField(blank=True)
    clinical_summary = models.TextField(blank=True)
    primary_diagnosis = models.CharField(max_length=255, blank=True)
    associated_conditions = models.TextField(blank=True)

    # Risk and immediate safety
    risk_self_harm = models.BooleanField(default=False)
    risk_to_others = models.BooleanField(default=False)
    risk_absconding = models.BooleanField(default=False)
    risk_medical = models.BooleanField(default=False)
    observation_level = models.CharField(
        max_length=16, choices=OBSERVATION_LEVEL_CHOICES, default="ROUTINE"
    )
    safety_actions = models.TextField(blank=True)
    risk_summary = models.TextField(blank=True)

    # Ward/bed/care team already covered by `bed`; care team is free text —
    # a formal link to apps.mhp_program.CareTeamMembership would couple two
    # otherwise-independent apps for a field that's informational here.
    primary_care_team = models.CharField(max_length=150, blank=True)
    consultant = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    initial_care_priorities = models.TextField(blank=True)

    # Voluntary path — treatment consent (distinct from Patient-level HIE
    # data-sharing consent in apps.client_registry.ConsentRecord).
    consent_status = models.CharField(max_length=16, choices=CONSENT_STATUS_CHOICES, blank=True)
    consent_at = models.DateTimeField(null=True, blank=True)
    consent_obtained_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    capacity_assessed = models.BooleanField(null=True, blank=True)
    consent_notes = models.TextField(blank=True)

    # Legal admission status (master prompt §7A): the episode's LegalStatus is
    # the single store. When linked, `admission_type` mirrors its category and
    # the legacy free-text legal fields below are read-only (kept for
    # admissions recorded before the module existed).
    legal_status_record = models.ForeignKey(
        "care_pathway.LegalStatus",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="admissions",
    )

    # Involuntary path — Mental Health Act (Cap. 248) legal status (legacy).
    legal_status = models.CharField(max_length=150, blank=True)
    legal_order_reference = models.CharField(max_length=100, blank=True)
    legal_order_date = models.DateField(null=True, blank=True)
    legal_review_due_date = models.DateField(null=True, blank=True)
    authorizing_professional = models.CharField(max_length=255, blank=True)
    legal_rationale = models.TextField(blank=True)
    oversight_notes = models.TextField(blank=True)

    # Next of kin notification (distinct from Patient.next_of_kin identity record).
    next_of_kin_notification = models.CharField(
        max_length=20, choices=NOK_NOTIFICATION_CHOICES, default="NOT_NOTIFIED"
    )
    next_of_kin_notes = models.TextField(blank=True)

    handover_note = models.TextField(blank=True)

    def __str__(self):
        return f"Admission of {self.patient} to {self.bed}"


class MedicationAdministration(TenantScopedModel):
    """
    Electronic MAR — docs/07-CLINICAL-MODULES-SPEC.md §7.7: digital checklist
    ensuring correct dose/patient/time.
    """

    STATUS_CHOICES = [
        ("SCHEDULED", "Scheduled"),
        ("ADMINISTERED", "Administered"),
        ("MISSED", "Missed"),
        ("REFUSED", "Refused"),
        ("WITHHELD", "Withheld"),
    ]

    admission = models.ForeignKey(Admission, on_delete=models.PROTECT, related_name="mar_entries")
    prescription_item = models.ForeignKey(
        PrescriptionItem, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    scheduled_time = models.DateTimeField()
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="SCHEDULED")
    administered_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    administered_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    # PRN and controlled-drug documentation. The witness's name is recorded;
    # no controlled-drug register number is generated here — that belongs to the
    # facility's own register (VERIFY).
    is_prn = models.BooleanField(default=False)
    prn_indication = models.CharField(max_length=255, blank=True)
    controlled_drug = models.BooleanField(default=False)
    witness_name = models.CharField(max_length=150, blank=True)
    own_supply = models.BooleanField(default=False)
    effect = models.CharField(max_length=400, blank=True)
    effect_recorded_at = models.DateTimeField(null=True, blank=True)
    # Why a PRN dose was given although the order's maximum per 24 h had been reached.
    prn_max_override_reason = models.CharField(max_length=400, blank=True)

    def __str__(self):
        return f"MAR entry for {self.admission} @ {self.scheduled_time}"


class NursingNote(TenantScopedModel):
    """Nursing notes / shift reports — docs/07-CLINICAL-MODULES-SPEC.md §7.7."""

    SHIFT_CHOICES = [("DAY", "Day"), ("NIGHT", "Night")]

    admission = models.ForeignKey(Admission, on_delete=models.PROTECT, related_name="nursing_notes")
    author = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    shift = models.CharField(max_length=10, choices=SHIFT_CHOICES)
    note = models.TextField()
    recorded_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"Nursing note for {self.admission} ({self.get_shift_display()})"


class BedStay(TenantScopedModel):
    """Where an admitted client slept, and from when to when (FHIR
    Encounter.location with its period). Admission opens the first stay; a
    transfer closes it and opens the next; discharge closes the last. At most
    one open stay per admission and per bed — one client per bed, held by the
    database. Each night is priced by the bed's type at that night's midnight."""

    admission = models.ForeignKey(Admission, on_delete=models.PROTECT, related_name="bed_stays")
    bed = models.ForeignKey(Bed, on_delete=models.PROTECT, related_name="stays")
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["started_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["admission"],
                condition=models.Q(ended_at__isnull=True),
                name="one_open_bed_stay_per_admission",
            ),
            models.UniqueConstraint(
                fields=["bed"],
                condition=models.Q(ended_at__isnull=True),
                name="one_open_bed_stay_per_bed",
            ),
        ]


class BedNight(TenantScopedModel):
    """One night of an inpatient stay, counted at the facility's midnight: the
    client was in `stay`'s bed at the start of the day after `night`. Its
    bed-day charge is priced from the bed's accommodation type (recorded here)
    and that type's tariff line at that
    moment (`charge`; unpriced, like any charge, when the type has no rate).
    A bed with no accommodation type has nothing to charge: the night is kept
    with no charge, so it can be shown as missing. Never counted twice
    (unique admission + night)."""

    admission = models.ForeignKey(Admission, on_delete=models.PROTECT, related_name="bed_nights")
    stay = models.ForeignKey(BedStay, on_delete=models.PROTECT, related_name="nights")
    night = models.DateField()
    accommodation_type = models.ForeignKey(
        AccommodationType, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    charge = models.OneToOneField(
        "care_pathway.ChargeItem",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="bed_night",
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["night"]
        constraints = [
            models.UniqueConstraint(
                fields=["admission", "night"], name="one_bed_night_per_admission_night"
            )
        ]
