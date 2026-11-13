from django.db import models
from django.utils import timezone

from apps.client_registry.models import Patient
from apps.dha_interop.models import IcdCodeIndex, NationalDrugIndex
from apps.tenancy.models import Branch, TenantScopedModel


class Encounter(TenantScopedModel):
    """
    Umbrella object every clinical touchpoint attaches to — docs/06-DATA-MODEL.md
    §6.3. VitalSigns/MentalStatusExam (apps.triage) and SoapNote/DiagnosisCode/
    ClinicalOrder/Prescription/ReferralPacket (below) all hang off this.
    """

    STATUS_CHOICES = [
        ("OPEN", "Open"),
        ("IN_PROGRESS", "In Progress"),
        ("CLOSED", "Closed"),
        # R4 entered-in-error: opened against the wrong client, or never happened.
        # Its subject and type cannot be edited, so this is the only correction.
        ("ENTERED_IN_ERROR", "Entered in error"),
    ]
    # Each type is set by the workflow that opens the encounter and never changes
    # afterwards: the SHR export decides what may leave the facility from it
    # (dha_interop.shr.SHR_ENCOUNTER_TYPES), and INPATIENT is the only one that
    # becomes Encounter.class IMP.
    TYPE_CHOICES = [
        ("TRIAGE", "Triage"),
        ("INTAKE", "Intake"),
        ("PSYCHIATRY", "Psychiatry review"),
        ("PSYCHOTHERAPY", "Psychotherapy"),
        ("INPATIENT", "Inpatient stay"),
        ("OUTPATIENT", "Outpatient visit"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="encounters")
    branch = models.ForeignKey(Branch, on_delete=models.PROTECT, null=True, blank=True)
    opened_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    encounter_type = models.CharField(max_length=100, blank=True, choices=TYPE_CHOICES)
    # CLAUDE.md §4 — every encounter hangs off an EpisodeOfCare.
    episode = models.ForeignKey(
        "care_pathway.EpisodeOfCare",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="encounters",
    )
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="OPEN")
    error_reason = models.TextField(blank=True)
    opened_at = models.DateTimeField(default=timezone.now)
    closed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Encounter {self.id} — {self.patient}"


class SoapNote(TenantScopedModel):
    """docs/07-CLINICAL-MODULES-SPEC.md §7.3 — S.O.A.P. structured documentation."""

    encounter = models.ForeignKey(Encounter, on_delete=models.PROTECT, related_name="soap_notes")
    subjective = models.TextField(blank=True)
    objective = models.TextField(blank=True)
    assessment = models.TextField(blank=True)
    plan = models.TextField(blank=True)
    author = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    signed_at = models.DateTimeField(null=True, blank=True)
    is_locked = models.BooleanField(default=False)

    def save(self, *args, **kwargs):
        if self.pk:
            previous = SoapNote.all_objects.filter(pk=self.pk, is_locked=True).exists()
            if previous:
                raise PermissionError("This SOAP note is signed and locked; it cannot be edited.")
        super().save(*args, **kwargs)

    def __str__(self):
        return f"SOAP note for {self.encounter}"


class DiagnosisCode(TenantScopedModel):
    """
    Mandatory ICD-11 mapping — docs/08-DHA-SHA-INTEGRATION.md §8.2: "diagnosis
    field is a required, validated FK — no free-text diagnosis without a code."
    `clinical_notes`/`diagnostic_criteria_met`/`status` are additive — the
    Diagnoses tab detail view from mockups/citramac_clinical_workspace.html.
    """

    STATUS_CHOICES = [("ACTIVE", "Active"), ("HISTORICAL", "Historical"), ("RESOLVED", "Resolved")]
    # Diagnostic certainty, separate from the clinical status above. Codes are those
    # of the served `intake-dx-status` value set; each maps to an R4
    # Condition.verificationStatus code (FHIR_VERIFICATION). Rows recorded before
    # this field existed stay blank — their certainty was never stated.
    VERIFICATION_CHOICES = [
        ("PROVISIONAL", "Provisional"),
        ("DIFFERENTIAL", "Differential"),
        ("CONFIRMED", "Confirmed"),
        ("RULED_OUT", "Ruled out"),
        # Not a certainty and not in `intake-dx-status`: set only by the
        # entered-in-error correction (wrong client or wrong code), with a reason.
        ("ENTERED_IN_ERROR", "Entered in error"),
    ]
    FHIR_VERIFICATION = {
        "PROVISIONAL": "provisional",
        "DIFFERENTIAL": "differential",
        "CONFIRMED": "confirmed",
        "RULED_OUT": "refuted",
        "ENTERED_IN_ERROR": "entered-in-error",
    }
    # Never treated as a diagnosis the client has: not shared, billed or counted.
    NOT_ASSERTED = ("RULED_OUT", "ENTERED_IN_ERROR")

    encounter = models.ForeignKey(Encounter, on_delete=models.PROTECT, related_name="diagnoses")
    icd11_code = models.ForeignKey(IcdCodeIndex, on_delete=models.PROTECT, related_name="+")
    # Condition.code.coding.display as the clinician chose it, and the WHO
    # release it was chosen from. Never rewritten, so a later release that
    # retitles the code doesn't change what a signed diagnosis says.
    icd11_display = models.CharField(max_length=500, blank=True, default="")
    icd11_release = models.CharField(max_length=7, blank=True, default="")
    # Set by the ICD-11 import when a diagnosis recorded from the old unverified
    # list carries a code that doesn't mean what the clinician saw (or isn't a
    # WHO code at all). It is then not shared, billed or emitted as coded until a
    # clinician marks it entered in error and records the correct code.
    code_review_reason = models.TextField(blank=True, default="")
    is_primary = models.BooleanField(default=False)
    noted_at = models.DateTimeField(default=timezone.now)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="ACTIVE")
    verification_status = models.CharField(
        max_length=16, choices=VERIFICATION_CHOICES, blank=True, default="PROVISIONAL"
    )
    clinical_notes = models.TextField(blank=True)
    diagnostic_criteria_met = models.TextField(blank=True)
    error_reason = models.TextField(blank=True)
    # Condition.recorder — who entered it. Blank only on rows from before it was kept.
    recorded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["-noted_at"]

    def save(self, *args, **kwargs):
        if not self.icd11_display and self.icd11_code_id:
            self.icd11_display = self.icd11_code.description
            self.icd11_release = self.icd11_code.release
        super().save(*args, **kwargs)

    @property
    def needs_recoding(self):
        return bool(self.code_review_reason) and self.verification_status != "ENTERED_IN_ERROR"

    # For screens and documents: a code flagged for re-coding is not shown, since
    # it means something other than what the clinician recorded.
    @property
    def shown_code(self):
        return "" if self.needs_recoding else self.icd11_code_id

    @property
    def shown_label(self):
        return self.icd11_display + (" (ICD-11 code under review)" if self.needs_recoding else "")

    @property
    def code_and_label(self):
        if self.needs_recoding:
            return self.shown_label
        return f"{self.icd11_code_id} — {self.icd11_display}"

    def __str__(self):
        return f"{self.icd11_code_id} ({'primary' if self.is_primary else 'secondary'})"


class ClinicalOrder(TenantScopedModel):
    """CPOE — docs/07-CLINICAL-MODULES-SPEC.md §7.3. RADIOLOGY intentionally
    omitted: this deployment has no Theatre/RIS-PACS modules (mental-health-only
    facility, not a general hospital)."""

    ORDER_TYPE_CHOICES = [
        ("LAB", "Laboratory"),
        ("PROCEDURE", "Procedure"),
        ("REFERRAL", "Referral"),
    ]
    STATUS_CHOICES = [
        ("ORDERED", "Ordered"),
        ("IN_PROGRESS", "In Progress"),
        ("COMPLETED", "Completed"),
        ("CANCELLED", "Cancelled"),
    ]

    encounter = models.ForeignKey(Encounter, on_delete=models.PROTECT, related_name="orders")
    order_type = models.CharField(max_length=16, choices=ORDER_TYPE_CHOICES)
    details = models.TextField(blank=True)
    ordered_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    ordered_at = models.DateTimeField(default=timezone.now)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="ORDERED")

    def __str__(self):
        return f"{self.get_order_type_display()} order for {self.encounter}"


class Prescription(TenantScopedModel):
    encounter = models.ForeignKey(Encounter, on_delete=models.PROTECT, related_name="prescriptions")
    prescribed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    prescribed_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"Prescription for {self.encounter}"


class PrescriptionItem(TenantScopedModel):
    """
    E-prescribing with allergy/interaction checks — docs/07-CLINICAL-MODULES-SPEC.md
    §7.3. The checks themselves are simple heuristics for now (real drug-interaction
    data isn't mirrored yet — see apps.dha_interop.models module docstring);
    they're stored so the workflow/UI is real even while the underlying data is thin.
    """

    prescription = models.ForeignKey(Prescription, on_delete=models.PROTECT, related_name="items")
    drug = models.ForeignKey(NationalDrugIndex, on_delete=models.PROTECT, related_name="+")
    dose = models.CharField(max_length=100)
    route = models.CharField(max_length=100, blank=True)
    frequency = models.CharField(max_length=100, blank=True)
    duration = models.CharField(max_length=100, blank=True)

    allergy_check_passed = models.BooleanField(default=True)
    interaction_check_passed = models.BooleanField(default=True)
    pediatric_dose_flag = models.BooleanField(default=False)

    # As-needed orders (R4 Dosage.asNeededBoolean / maxDosePerPeriod). The maximum
    # is what the prescriber wrote; nothing here suggests one.
    is_prn = models.BooleanField(default=False)
    prn_max_per_24h = models.PositiveSmallIntegerField(null=True, blank=True)
    indication = models.CharField(max_length=255, blank=True)
    # Order type: psychiatrist prescription, nurse PRN under protocol, or nurse
    # telephone order (pending co-signature until the prescriber countersigns).
    ORDER_TYPE_CHOICES = [
        ("PRESCRIPTION", "Prescription"),
        ("PRN", "PRN (as needed)"),
        ("TELEPHONE", "Telephone order"),
    ]
    order_type = models.CharField(max_length=16, choices=ORDER_TYPE_CHOICES, default="PRESCRIPTION")
    cosigned_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    cosigned_at = models.DateTimeField(null=True, blank=True)
    # A telephone order: the prescriber who gave it (on whose authority, CLAUDE.md
    # §3 item 4). Only that prescriber confirms it (owner decision 2026-11-13).
    authorised_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Set by the prescriber at order time so the MAR asks for a witness.
    # VERIFY: derive from the national controlled-drug schedule once it is mirrored.
    controlled_drug = models.BooleanField(default=False)
    # What the pre-order check found and the prescriber acknowledged, and the
    # reason when a true-allergy hard stop was overridden (with its co-sign request).
    check_findings = models.JSONField(default=list, blank=True)
    allergy_override_reason = models.TextField(blank=True)

    def __str__(self):
        return f"{self.drug.generic_name} {self.dose}"


class ReferralPacket(TenantScopedModel):
    """
    E-Referral — docs/07-CLINICAL-MODULES-SPEC.md §7.3. Real FHIR Bundle
    construction + HIE transmission is Phase 6 (docs/08-DHA-SHA-INTEGRATION.md
    §8.1); fhir_bundle_json is a placeholder structure until then.
    """

    STATUS_CHOICES = [("DRAFT", "Draft"), ("SENT", "Sent"), ("ACKNOWLEDGED", "Acknowledged")]

    encounter = models.ForeignKey(Encounter, on_delete=models.PROTECT, related_name="referrals")
    destination_facility = models.CharField(max_length=255)
    fhir_bundle_json = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="DRAFT")
    sent_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Referral to {self.destination_facility} for {self.encounter}"
