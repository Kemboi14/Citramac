from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.billing.models import Invoice
from apps.client_registry.models import Patient
from apps.clinical_encounter.models import Encounter
from apps.tenancy.models import TenantScopedModel


class PreAuthorization(TenantScopedModel):
    """
    docs/07-CLINICAL-MODULES-SPEC.md §7.11. For SHA it is raised against a
    consented visit through the DHA HIE (apps.insurance_claims.sha_claims.create_preauth);
    for other payers finance records the request and the decision.
    """

    STATUS_CHOICES = [
        ("DRAFT", "Draft"),
        ("SUBMITTED", "Submitted"),
        ("APPROVED", "Approved"),
        ("PARTIALLY_APPROVED", "Partially Approved"),
        ("REJECTED", "Rejected"),
    ]

    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="pre_authorizations"
    )
    encounter = models.ForeignKey(
        Encounter,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pre_authorizations",
    )
    clinical_notes = models.TextField(blank=True)
    diagnostic_evidence = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")
    sha_reference = models.CharField(max_length=100, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    # Per-claim-line request from the client record's Billing stage: the
    # tariff service the payer is asked to authorise. Null on older,
    # encounter-level requests.
    service = models.ForeignKey(
        "care_pathway.BillingService",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    # The payer's own approval number, entered by finance from the payer's
    # response — never generated here.
    approval_reference = models.CharField(max_length=100, blank=True)
    decision_note = models.CharField(max_length=255, blank=True)
    requested_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    decided_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # SHA preauth (POST /preauths): it lives on the visit's consent token and
    # one intervention code; `sha_state` is the HIE's own preauth status
    # vocabulary (claims__guides__understandingPreauthStatuses.md), set from
    # the response and the "preauth" status callbacks.
    intervention_code = models.CharField(max_length=32, blank=True)
    sha_state = models.CharField(max_length=48, blank=True)
    sha_guid = models.CharField(max_length=64, blank=True)

    def __str__(self):
        return f"Pre-auth for {self.patient} ({self.status})"


class ShaIntervention(models.Model):
    """
    An SHA benefit intervention as last returned by
    GET /patients/benefits/interventions — cached by code so a claim line can
    show its name, payment mechanism, pre-authorisation flags and required
    documents. Never typed in: rows are written only from HIE responses, and
    tariffs are read live at claim time ("Resolve amounts at claim time from
    Intervention Coverage"). Global, not tenant-scoped — SHA's catalogue is
    national. `raw` is the full item as received.
    """

    code = models.CharField(max_length=32, primary_key=True)
    name = models.CharField(max_length=255, blank=True)
    benefit_code = models.CharField(max_length=32, blank=True)
    parent_benefit_code = models.CharField(max_length=32, blank=True)
    access_point = models.CharField(max_length=32, blank=True)
    payment_mechanism = models.CharField(max_length=64, blank=True)
    fund = models.CharField(max_length=64, blank=True)
    needs_preauth = models.BooleanField(default=False)
    needs_manual_preauth_approval = models.BooleanField(default=False)
    applicable_document_types = models.JSONField(default=list, blank=True)
    required_preauth_document_types = models.JSONField(default=list, blank=True)
    levels_applicable = models.JSONField(default=list, blank=True)
    raw = models.JSONField(default=dict, blank=True)
    fetched_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} {self.name}"


class ShaEligibilityCheck(TenantScopedModel):
    """
    One answer from GET /patients/eligibility, kept as received
    (claims__process__eligibility__eligibilityCheck.md). `found` is "the
    registry matched this person"; `active` is whether any scheme's
    coverage.status is one configured as active
    (settings.SHA_ACTIVE_COVERAGE_STATUSES — DHA publishes no vocabulary, so
    nothing is active until that is set from a confirmed UAT response).
    `is_alive` false blocks every SHA transaction for the patient.
    """

    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="sha_eligibility_checks"
    )
    branch = models.ForeignKey("tenancy.Branch", on_delete=models.PROTECT, related_name="+")
    identification_type = models.CharField(max_length=32)
    found = models.BooleanField(default=False)
    active = models.BooleanField(default=False)
    is_alive = models.BooleanField(null=True, blank=True)
    member_cr_number = models.CharField(max_length=64, blank=True)
    whitelisted_for_otp = models.BooleanField(null=True, blank=True)
    biometrics_enforced = models.BooleanField(null=True, blank=True)
    pomsf = models.BooleanField(default=False)
    schemes = models.JSONField(default=list, blank=True)
    status_code = models.CharField(max_length=16, blank=True)
    status_desc = models.CharField(max_length=255, blank=True)
    checked_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["-created_at"]


class ShaVisit(TenantScopedModel):
    """
    An SHA "virtual claim" visit (POST /claims/visit): opened only with the
    patient's consent — OTP, or a biometric authorisation — while they are at
    the facility, and identified from then on by the `consent_token` the
    HIE returns as `authorization_code` (claims__process__startVisitConsent__
    startVisitWorkflow.md). Billing lines, diagnoses, attachments and preauths
    all hang off that token. FHIR R4 has no analogue for SHA's consent
    authorisation; it is payer workflow state, not clinical data.
    """

    SERVICE_TYPE_CHOICES = [
        ("OUTPATIENT", "Outpatient"),
        ("INPATIENT", "Inpatient"),
        ("CAPITATION", "Capitation"),
        ("EMERGENCY", "Emergency"),
    ]
    CONSENT_METHOD_CHOICES = [("OTP", "One-time password"), ("BIOMETRIC", "Fingerprint")]
    STATUS_AWAITING_CONSENT = "AWAITING_CONSENT"
    STATUS_OPEN = "OPEN"
    STATUS_SUBMITTED = "SUBMITTED"
    STATUS_CLOSED = "CLOSED"
    STATUS_REJECTED = "REJECTED"
    STATUS_CHOICES = [
        (STATUS_AWAITING_CONSENT, "Awaiting the patient's consent"),
        (STATUS_OPEN, "Open"),
        (STATUS_SUBMITTED, "Claim submitted"),
        (STATUS_CLOSED, "Closed"),
        (STATUS_REJECTED, "Consent refused or expired"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="sha_visits")
    branch = models.ForeignKey("tenancy.Branch", on_delete=models.PROTECT, related_name="+")
    episode = models.ForeignKey(
        "care_pathway.EpisodeOfCare",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="sha_visits",
    )
    cr_id = models.CharField(max_length=64)
    service_type = models.CharField(max_length=12, choices=SERVICE_TYPE_CHOICES)
    intervention_codes = models.JSONField(default=list)
    consent_method = models.CharField(max_length=10, choices=CONSENT_METHOD_CHOICES)
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_AWAITING_CONSENT
    )
    # Biometric path: the PENDING authorisation, the token that rejects a
    # stuck one (POST /claims/authorizations/{consent_token}/reject) and its
    # capture iframe.
    authorization_guid = models.CharField(max_length=64, blank=True)
    authorization_token = models.CharField(max_length=64, blank=True)
    authorization_state = models.CharField(max_length=32, blank=True)
    authorization_reason = models.CharField(max_length=64, blank=True)
    biometric_capture_url = models.URLField(max_length=1000, blank=True)
    consent_token = models.CharField(max_length=64, blank=True, db_index=True)
    # HIE claim identity and its two status vocabularies
    # (claims__guides__understandingClaimStatuses.md).
    claim_guid = models.CharField(max_length=64, blank=True)
    workflow_state = models.CharField(max_length=48, blank=True)
    payer_workflow_state = models.CharField(max_length=48, blank=True)
    discharge_status = models.CharField(max_length=8, blank=True)
    opened_at = models.DateTimeField(null=True, blank=True)
    opened_by = models.ForeignKey(
        "accounts.User", on_delete=models.PROTECT, related_name="+"
    )
    closed_at = models.DateTimeField(null=True, blank=True)
    close_reason = models.CharField(max_length=40, blank=True)
    # Append-only [{state, at, by, note}].
    status_history = models.JSONField(default=list, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-created_at"]

    def __str__(self):
        return f"SHA visit {self.cr_id} {self.service_type} [{self.status}]"


class InsuranceClaim(TenantScopedModel):
    """E-claim — docs/07-CLINICAL-MODULES-SPEC.md §7.11, docs/08-DHA-SHA-INTEGRATION.md §8.3.3.

    FHIR R4: Claim (use=claim), payer response → ClaimResponse. Built from the
    client's documented ChargeItems (`lines`); `claim_number` is the local
    business identifier, assigned at creation before any network call so a
    retried submission is idempotent.
    """

    # Client-record timeline (v4 mockup): Draft → Submitted → With payer → Adjudicated.
    ADJUDICATED_STATUSES = ("APPROVED", "PARTIALLY_APPROVED", "REJECTED")

    STATUS_CHOICES = [
        ("DRAFT", "Draft"),
        ("SUBMITTED", "Submitted"),
        ("UNDER_REVIEW", "Under Review"),
        ("RETURNED", "Returned by payer — action needed"),
        ("APPROVED", "Approved"),
        ("PARTIALLY_APPROVED", "Partially Approved"),
        ("REJECTED", "Rejected"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="insurance_claims")
    # SHA claims are billed against one consented visit.
    sha_visit = models.OneToOneField(
        "insurance_claims.ShaVisit",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="claim",
    )
    # ICD-11 codes already added to the HIE claim (POST /claims/diagnoses).
    sha_diagnoses = models.JSONField(default=list, blank=True)
    encounter = models.ForeignKey(
        Encounter, on_delete=models.SET_NULL, null=True, blank=True, related_name="insurance_claims"
    )
    invoice = models.ForeignKey(
        Invoice, on_delete=models.SET_NULL, null=True, blank=True, related_name="insurance_claims"
    )
    diagnoses_snapshot = models.JSONField(default=list, blank=True)
    total_claimed_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")
    sha_reference = models.CharField(max_length=100, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    claim_number = models.CharField(max_length=40, blank=True)
    # Payer the claim is addressed to (ServicePayerCode.PAYER_CHOICES), snapshot at creation.
    payer = models.CharField(max_length=12, blank=True)
    # Responsible adult for any balance the payer does not cover.
    guarantor = models.CharField(max_length=255, blank=True)
    lines_checked_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    lines_checked_at = models.DateTimeField(null=True, blank=True)
    # The finance review checklist exactly as it stood when submitted.
    checklist_snapshot = models.JSONField(default=list, blank=True)
    # Append-only [{status, at, by, note}] — every state change.
    status_history = models.JSONField(default=list, blank=True)
    approved_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    adjudicated_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    submitted_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "claim_number"],
                condition=~Q(claim_number=""),
                name="unique_claim_number_per_org",
            )
        ]

    def __str__(self):
        return f"E-claim for {self.patient} ({self.status})"


class ServicePayerCode(TenantScopedModel):
    """A payer's own code for one facility tariff service, and whether that
    payer requires pre-authorisation for it. Configured by the facility from
    the payer's published tariff — never generated or guessed. A service with
    no row here is shown on a claim as "Payer code not configured — VERIFY".
    FHIR R4: ChargeItemDefinition.code / Claim.item.productOrService coding."""

    PAYER_CHOICES = [
        ("SHA", "SHA"),
        ("PRIVATE", "Private insurer"),
        ("EMPLOYER", "Employer scheme"),
    ]

    service = models.ForeignKey(
        "care_pathway.BillingService", on_delete=models.PROTECT, related_name="payer_codes"
    )
    payer = models.CharField(max_length=12, choices=PAYER_CHOICES)
    payer_code = models.CharField(max_length=64)
    requires_preauth = models.BooleanField(default=False)
    active = models.BooleanField(default=True)

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "service", "payer"],
                name="unique_payer_code_per_service",
            )
        ]

    def __str__(self):
        return f"{self.service} → {self.payer} {self.payer_code}"


class ClaimLine(TenantScopedModel):
    """One delivered, priced ChargeItem on a claim (FHIR Claim.item). Service,
    rate and payer code are snapshots so a submitted claim never changes when
    the tariff does."""

    claim = models.ForeignKey(InsuranceClaim, on_delete=models.PROTECT, related_name="lines")
    charge_item = models.ForeignKey(
        "care_pathway.ChargeItem", on_delete=models.PROTECT, related_name="+"
    )
    service_name = models.CharField(max_length=150)
    quantity = models.PositiveSmallIntegerField(default=1)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    # Blank when the payer has no code configured for this service (VERIFY).
    payer_code = models.CharField(max_length=64, blank=True)
    # None: payer code not configured, so whether pre-auth is needed is unknown.
    requires_preauth = models.BooleanField(null=True, blank=True)
    pre_authorization = models.ForeignKey(
        PreAuthorization,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="claim_lines",
    )
    # Set once the line is on the HIE claim (POST /claims/lines) — a line is
    # added once; a correction is an edit of that GUID, never a second add.
    sha_line_guid = models.CharField(max_length=64, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["created_at"]

    @property
    def amount(self):
        return self.unit_price * self.quantity


# Minimum-necessary claim attachments (CLAUDE.md §4 consent & sensitivity,
# DS4P). Psychotherapy/process notes and trauma history are never attached to
# a payer claim — enforced here, in the serializer, by a database CHECK
# constraint, and again when the gateway payload is built.
ATTACHMENT_EXCLUDED_CATEGORIES = ("PSYCHOTHERAPY_NOTES", "TRAUMA_HISTORY")
ATTACHMENT_DEFAULT_CATEGORIES = ("INVOICE", "FINAL_BILL")


class AttachmentNotPermitted(ValueError):
    pass


class ClaimAttachment(TenantScopedModel):
    CATEGORY_CHOICES = [
        ("INVOICE", "Invoice"),
        ("FINAL_BILL", "Final bill"),
        ("REFERRAL_NOTE", "Referral note"),
        ("LAB_RESULTS", "Lab results"),
        ("DISCHARGE_SUMMARY", "Discharge summary"),
        ("TREATMENT_PLAN_SUMMARY", "Treatment plan summary"),
        ("PREAUTH_FORM", "Pre-authorisation form"),
    ]

    claim = models.ForeignKey(InsuranceClaim, on_delete=models.PROTECT, related_name="attachments")
    category = models.CharField(max_length=32, choices=CATEGORY_CHOICES)
    added_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # SHA requires the document itself: the client's filed copy, labelled
    # with one of the intervention's applicable document types.
    file = models.ForeignKey(
        "client_registry.Attachment",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    sha_document_type = models.CharField(max_length=64, blank=True)
    intervention_code = models.CharField(max_length=32, blank=True)
    sha_attachment_id = models.CharField(max_length=64, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["created_at"]
        constraints = [
            models.CheckConstraint(
                condition=~Q(category__in=ATTACHMENT_EXCLUDED_CATEGORIES),
                name="claim_attachment_never_restricted",
            ),
            models.UniqueConstraint(
                fields=["claim", "category"], name="unique_claim_attachment_category"
            ),
        ]

    def save(self, *args, **kwargs):
        if self.category in ATTACHMENT_EXCLUDED_CATEGORIES:
            raise AttachmentNotPermitted(
                f"{self.category} is never attached to a payer claim (minimum necessary)."
            )
        super().save(*args, **kwargs)


class Remittance(TenantScopedModel):
    claim = models.ForeignKey(InsuranceClaim, on_delete=models.PROTECT, related_name="remittances")
    amount_paid = models.DecimalField(max_digits=14, decimal_places=2)
    remittance_date = models.DateField(default=timezone.now)
    reference = models.CharField(max_length=100, blank=True)
    # The receipt this remittance was posted as (billing is the one payment store).
    payment = models.OneToOneField(
        "billing.Payment",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="remittance",
    )

    def __str__(self):
        return f"Remittance {self.amount_paid} for {self.claim}"
