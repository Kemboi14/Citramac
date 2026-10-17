"""
Legal admission status — master prompt §7A (LGL-DATA, LGL-V, LGL-I, LGL-R, LGL-WF,
LGL-DOC). Imported by models.py so the classes register under `care_pathway`.

One `LegalStatus` per EpisodeOfCare is the single store of a client's admission
legal category, decision, notice and expiry (CLAUDE.md §4 "one shared resource
store"). `ipd_ward.Admission.legal_status_record` links an admission to it; the
admission's older free-text legal fields are legacy, kept read-only for records
made before this module (they cannot be rewritten — CLAUDE.md §3.7).

FHIR R4 mapping (no extension invented — CLAUDE.md §5):

| Model | FHIR R4 | Notes |
|---|---|---|
| LegalStatus | Consent — VERIFY | Base R4 has no element for an admission's statutory basis. The closest base fit is `Consent` with `policy.uri` → the statute, `provision.period` → effectiveFrom..maxExpiryAt, `status` active/inactive, `dateTime` = decisionAt, `performer` = applicant, `organization` = facility. For an involuntary admission "Consent" is a misnomer (the client did not consent); VERIFY with the national IG whether a profile or a `Basic` resource is intended. Consent.scope / category codes: VERIFY — none asserted here. |
| LegalStatus (on the admission) | none in base R4 — VERIFY | Encounter.hospitalization.admitSource is where the patient came from, not the legal basis; repurposing it is forbidden (CLAUDE.md §5). `Encounter.hospitalization` has no legal-status element in R4 — VERIFY national IG extension. |
| LegalDocument | DocumentReference (signed form, `docStatus` final/amended, `relatesTo.code` = replaces for an amendment) + Provenance (signature: who, when, on whose authority) | `type` code for each template: VERIFY (no LOINC asserted). |
| DischargeNotice | Communication (from patient to facility, `sent` = givenAt) — VERIFY | earliestDepartureAt is derived; no base element. |
| LegalStatusEvent | AuditEvent | Append-only. |
| Recommendation practitioner credential | Practitioner.qualification (identifier = registration number, period, issuer) | issuer and identifier `system` URI: VERIFY (CLAUDE.md §6). |
"""

from django.db import models
from django.utils import timezone

from apps.client_registry.models import Patient
from apps.tenancy.models import TenantScopedModel

VOLUNTARY_TEMPLATE = "DOC-LEG-STAT-VOL-KE"
INVOLUNTARY_APPLICATION_TEMPLATE = "DOC-LEG-STAT-INV-APP-KE"
RECOMMENDATION_TEMPLATE = "DOC-LEG-STAT-INV-REC-KE"
NOTICE_TEMPLATE = "LGL-NOTICE-KE"


class LegalStatus(TenantScopedModel):
    """LGL-DATA: the legal status object, one per episode, shared by every view."""

    CATEGORY_CHOICES = [("VOLUNTARY", "Voluntary"), ("INVOLUNTARY", "Involuntary")]
    DECISION_CHOICES = [("PENDING", "Pending"), ("ADMITTED", "Admitted"), ("REJECTED", "Rejected")]
    # LGL-DATA status, plus PENDING (application under way) and NOT_ADMITTED
    # (application rejected) — ASSUMPTION: the spec's list only covers a decided status.
    STATUS_CHOICES = [
        ("PENDING", "Pending decision"),
        ("NOT_ADMITTED", "Not admitted"),
        ("ACTIVE", "Active"),
        ("EXPIRED", "Expired"),
        ("DISCHARGED", "Discharged"),
        ("CONVERTED", "Converted"),
        ("REVOKED", "Revoked"),
    ]
    # LGL-WF state machine (voluntary applications use the same names).
    STATE_CHOICES = [
        ("APPLICATION_DRAFT", "Application draft"),
        ("APPLICATION_SIGNED", "Application signed"),
        ("RECOMMENDATION_SIGNED", "Recommendation signed"),
        ("ADMITTED", "Admitted"),
        ("REJECTED", "Rejected"),
        ("ACTIVE", "Active"),
        ("REVIEW_DUE", "Review due"),
        ("RENEWED", "Renewed"),
        ("DISCHARGED", "Discharged"),
        ("CONVERTED_TO_VOLUNTARY", "Converted to voluntary"),
        ("EXPIRED", "Expired"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="legal_statuses")
    episode = models.OneToOneField(
        "care_pathway.EpisodeOfCare", on_delete=models.PROTECT, related_name="legal_status"
    )
    jurisdiction = models.CharField(max_length=8, default="KE")
    config_version = models.CharField(max_length=40)
    category = models.CharField(max_length=12, choices=CATEGORY_CHOICES)
    # [{key, act, section, versionLabel}] copied from jurisdiction config — never free text.
    statutory_basis = models.JSONField(default=list, blank=True)
    application_document = models.ForeignKey(
        "care_pathway.LegalDocument", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    # An application awaiting the admitting officer's decision. While a status is
    # in force this is a conversion application (LGL-WF-04, OQ-16); the status in
    # force is unchanged until the decision.
    pending_application = models.ForeignKey(
        "care_pathway.LegalDocument", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    decision = models.CharField(max_length=10, choices=DECISION_CHOICES, default="PENDING")
    decision_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    decision_role = models.CharField(max_length=100, blank=True)
    decision_at = models.DateTimeField(null=True, blank=True)
    decision_reason = models.TextField(blank=True)
    effective_from = models.DateTimeField(null=True, blank=True)
    max_expiry_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=14, choices=STATUS_CHOICES, default="PENDING")
    workflow_state = models.CharField(max_length=24, choices=STATE_CHOICES, default="APPLICATION_DRAFT")
    created_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta(TenantScopedModel.Meta):
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_category_display()} — {self.get_status_display()} ({self.patient_id})"


class LegalStatusEvent(TenantScopedModel):
    """LGL-DATA-02 / LGL-WF-01: the append-only history of one LegalStatus."""

    legal_status = models.ForeignKey(LegalStatus, on_delete=models.PROTECT, related_name="history")
    event = models.CharField(max_length=40)
    from_state = models.CharField(max_length=24, blank=True)
    to_state = models.CharField(max_length=24, blank=True)
    actor = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    actor_role = models.CharField(max_length=100, blank=True)
    at = models.DateTimeField(default=timezone.now)
    detail = models.JSONField(default=dict, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["at", "created_at"]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise PermissionError("Legal status history is append-only.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PermissionError("Legal status history is append-only.")


class LegalDocument(TenantScopedModel):
    """One statutory form instance (LGL-DOC). A signed version is immutable
    (LGL-DOC-04); a correction is a new version whose `supersedes` names the one
    it replaces, with a reason. Superseded versions are kept."""

    TEMPLATE_CHOICES = [
        (VOLUNTARY_TEMPLATE, "Application for Voluntary Admission"),
        (INVOLUNTARY_APPLICATION_TEMPLATE, "Involuntary Admission Form"),
        (RECOMMENDATION_TEMPLATE, "Recommendation for Involuntary Treatment"),
        (NOTICE_TEMPLATE, "Written notice of intention to leave"),
    ]
    STATUS_CHOICES = [("DRAFT", "Draft"), ("SIGNED", "Signed")]
    SIGNER_CHOICES = [
        ("CLIENT", "Client"),
        ("GUARDIAN", "Parent / guardian"),
        ("RELATED_PERSON", "Applicant (related person)"),
        ("PRACTITIONER", "Medical practitioner"),
    ]
    METHOD_CHOICES = [
        ("ELECTRONIC", "Electronic signature (witnessed)"),
        ("WET_SCAN", "Captured wet signature (scan upload)"),
    ]

    legal_status = models.ForeignKey(LegalStatus, on_delete=models.PROTECT, related_name="documents")
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="+")
    template_id = models.CharField(max_length=32, choices=TEMPLATE_CHOICES)
    config_version = models.CharField(max_length=40)
    # A recommendation belongs to the application it supports.
    application = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="recommendations"
    )
    version = models.PositiveIntegerField(default=1)
    supersedes = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="superseded_by"
    )
    amendment_reason = models.TextField(blank=True)
    status = models.CharField(max_length=8, choices=STATUS_CHOICES, default="DRAFT")
    content = models.JSONField(default=dict, blank=True)
    # The form as it was signed: every text and resolved field, frozen.
    rendered = models.JSONField(default=dict, blank=True)
    signer_kind = models.CharField(max_length=16, choices=SIGNER_CHOICES, blank=True)
    signer_name = models.CharField(max_length=255, blank=True)
    signer_related_person = models.ForeignKey(
        "client_registry.EmergencyContact", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    signer_user = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    signature_method = models.CharField(max_length=12, choices=METHOD_CHOICES, blank=True)
    signature_attachment = models.ForeignKey(
        "client_registry.Attachment", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    signed_at = models.DateTimeField(null=True, blank=True)
    captured_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    examination_encounter = models.ForeignKey(
        "clinical_encounter.Encounter", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    created_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta(TenantScopedModel.Meta):
        ordering = ["created_at"]

    def save(self, *args, **kwargs):
        if self.pk and not self._state.adding:
            stored = type(self).all_objects.filter(pk=self.pk).values_list("status", flat=True)
            if stored and stored[0] == "SIGNED":
                raise PermissionError("This form is signed and cannot be changed. Amend it instead.")
        super().save(*args, **kwargs)

    @property
    def document_number(self):
        return f"{self.template_id}/{str(self.pk)[:8].upper()}"


class DischargeNotice(TenantScopedModel):
    """LGL-V-WF: a voluntary client's written notice of intention to leave."""

    legal_status = models.ForeignKey(LegalStatus, on_delete=models.PROTECT, related_name="discharge_notices")
    given_at = models.DateTimeField()
    given_to = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, related_name="+")
    written_notice_document = models.ForeignKey(LegalDocument, on_delete=models.PROTECT, related_name="+")
    notice_period_hours = models.PositiveIntegerField()
    earliest_departure_at = models.DateTimeField()
    withdrawn_at = models.DateTimeField(null=True, blank=True)
    withdrawn_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    # Departure before earliest_departure_at: routed to AMA discharge documentation.
    departed_at = models.DateTimeField(null=True, blank=True)
    departure_against_advice = models.BooleanField(default=False)
    risk_review_prompted_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta(TenantScopedModel.Meta):
        ordering = ["-given_at"]

    @property
    def is_active(self):
        return self.withdrawn_at is None and self.departed_at is None
