import uuid

from django.db import models

from apps.tenancy.models import TenantScopedModel

# docs/06-DATA-MODEL.md §6.6 — global terminology catalogs, not tenant-scoped
# (every org searches the same ICD-11/LOINC/drug index). Phase 3-5 seed a
# small illustrative set via data migration; docs/11-ROADMAP-AND-PHASES.md
# Phase 6 replaces that with a real nightly sync job against the WHO/LOINC/
# national drug registry APIs (docs/08-DHA-SHA-INTEGRATION.md §8.2) — do not
# treat the seeded codes here as a certified, complete mirror.


class IcdCodeIndex(models.Model):
    # code IS the primary key — the natural, human-meaningful lookup key
    # (diagnoses reference "6A70", not an opaque internal id).
    code = models.CharField(max_length=16, primary_key=True)
    description = models.CharField(max_length=500)

    class Meta:
        ordering = ["code"]
        verbose_name = "ICD-11 code"
        verbose_name_plural = "ICD-11 codes"

    def __str__(self):
        return f"{self.code} — {self.description}"


class LoincCodeIndex(models.Model):
    code = models.CharField(max_length=16, primary_key=True)
    description = models.CharField(max_length=500)

    class Meta:
        ordering = ["code"]
        verbose_name = "LOINC code"
        verbose_name_plural = "LOINC codes"

    def __str__(self):
        return f"{self.code} — {self.description}"


class NationalDrugIndex(models.Model):
    code = models.CharField(max_length=32, primary_key=True)
    generic_name = models.CharField(max_length=255)
    form = models.CharField(max_length=100, blank=True)
    strength = models.CharField(max_length=100, blank=True)

    class Meta:
        ordering = ["generic_name"]
        verbose_name = "national drug index entry"

    def __str__(self):
        return f"{self.generic_name} {self.strength} ({self.form})".strip()


class ShaTransactionLog(models.Model):
    """
    Every call to the DHA HIE middleware (apps.dha_interop.hie_api.call),
    logged whatever the outcome — SHA and SHR transactions are financial or
    medical, never fire-and-forget. Request bodies are stored with OTPs,
    secrets and file contents redacted. Not tenant-scoped via
    TenantScopedModel (kept simple like AuditLogEntry) but carries
    organization_id for filtering; platform-level calls (the Super Admin
    connection test) carry no organisation.
    """

    TRANSACTION_TYPE_CHOICES = [
        ("CONNECTION_TEST", "Connection test"),
        ("FACILITY_LOOKUP", "Facility Registry lookup"),
        ("CLIENT_LOOKUP", "Client Registry lookup"),
        ("PRACTITIONER_LOOKUP", "Health Worker Registry lookup"),
        ("MEMBER_VERIFICATION", "SHA eligibility check"),
        ("BENEFITS_LOOKUP", "SHA benefits / interventions lookup"),
        ("CLAIM_CONSENT", "Claim consent (OTP / biometrics)"),
        ("CLAIM_VISIT", "Claim visit"),
        ("E_CLAIM", "E-claim"),
        ("PRE_AUTHORIZATION", "Pre-authorisation"),
        ("CALLBACK_REGISTRATION", "Status callback registration"),
        ("REMITTANCE", "Remittance"),
        ("SHR_CONSENT", "Shared Health Record consent"),
        ("SHR_BUNDLE", "Shared Health Record bundle"),
        ("SHR_LABELS", "Shared Health Record security labels"),
    ]
    STATUS_CHOICES = [
        ("PENDING", "Pending"),
        ("SUCCESS", "Success"),
        ("FAILED", "Failed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization_id = models.UUIDField(db_index=True, null=True, blank=True)
    branch_id = models.UUIDField(null=True, blank=True)
    transaction_type = models.CharField(max_length=32, choices=TRANSACTION_TYPE_CHOICES)
    method = models.CharField(max_length=8, blank=True)
    endpoint = models.CharField(max_length=255, blank=True)
    request_payload = models.JSONField(default=dict, blank=True)
    response_payload = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="PENDING")
    http_status = models.PositiveSmallIntegerField(null=True, blank=True)
    # The middleware's trace id — "quote it when reporting an issue".
    trace_id = models.CharField(max_length=64, blank=True)
    error_detail = models.TextField(blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    retry_count = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.transaction_type} [{self.status}] {self.created_at:%Y-%m-%d %H:%M}"


class ShaCallbackEvent(models.Model):
    """
    A status callback POSTed by the HIE (claims__guides__status-callbacks.md).
    Written durably before the 2xx acknowledgement and applied afterwards
    ("acknowledge as soon as you have durably accepted the payload"). Two
    deliveries are the same event when they share subject_guid + to_state
    (+ entity_type, whose state vocabularies differ) — the unique constraint
    makes a redelivery a no-op. Not tenant-scoped: the organisation is only
    known once facility_fr_code resolves to a branch.
    """

    ENTITY_CHOICES = [
        ("claim", "Claim"),
        ("preauth", "Pre-authorisation"),
        ("authorization", "Authorisation"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    entity_type = models.CharField(max_length=16, choices=ENTITY_CHOICES)
    subject_guid = models.CharField(max_length=64)
    from_state = models.CharField(max_length=64, blank=True)
    to_state = models.CharField(max_length=64)
    facility_fr_code = models.CharField(max_length=64, blank=True)
    consent_token = models.CharField(max_length=64, blank=True)
    provider_claim_no = models.CharField(max_length=64, blank=True)
    payload = models.JSONField(default=dict)
    occurred_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(auto_now_add=True)
    organization_id = models.UUIDField(null=True, blank=True, db_index=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    # Why it could not be applied (unknown visit, from_state mismatch, …).
    outcome = models.TextField(blank=True)

    class Meta:
        ordering = ["-received_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["entity_type", "subject_guid", "to_state"],
                name="unique_sha_callback_event",
            )
        ]

    def __str__(self):
        return f"{self.entity_type} {self.subject_guid}: {self.from_state} → {self.to_state}"


class ShaRemittanceStatement(models.Model):
    """
    A remittance list (or one remittance's paid claims) fetched from the HIE,
    kept verbatim. VERIFY: the response fields are unpublished
    (hie_spec/SOURCE.md gap 2), so statements are shown to finance as
    received and NOT auto-matched to claims; finance posts each remittance
    against its claim as before.
    """

    KIND_CHOICES = [("REMITTANCES", "Remittances"), ("PAID_CLAIMS", "Claims paid by remittance")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization_id = models.UUIDField(db_index=True)
    branch_id = models.UUIDField()
    kind = models.CharField(max_length=12, choices=KIND_CHOICES)
    bank_reference = models.CharField(max_length=100, blank=True)
    body = models.JSONField(default=dict)
    fetched_at = models.DateTimeField(auto_now_add=True)
    fetched_by_id = models.UUIDField(null=True, blank=True)

    class Meta:
        ordering = ["-fetched_at"]


class FhirResourceCache(models.Model):
    """
    Locally cached FHIR resources fetched/pushed to the HIE — docs/06-DATA-MODEL.md
    §6.6, docs/08-DHA-SHA-INTEGRATION.md §8.1's offline-resilience + audit
    requirement. Not tenant-scoped via TenantScopedModel (kept simple like
    ShaTransactionLog) but carries organization_id for filtering.
    """

    DIRECTION_CHOICES = [("OUTBOUND", "Outbound"), ("INBOUND", "Inbound")]
    STATUS_CHOICES = [
        ("CACHED", "Cached (not yet transmitted)"),
        ("SENT", "Sent"),
        ("RECEIVED", "Received"),
        ("RETRY", "Failed temporarily — will retry"),
        ("REJECTED", "Rejected by the HIE — needs correction"),
        ("FAILED", "Failed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization_id = models.UUIDField(db_index=True)
    resource_type = models.CharField(max_length=64, help_text="e.g. Bundle, Composition")
    direction = models.CharField(max_length=16, choices=DIRECTION_CHOICES)
    fhir_json = models.JSONField()
    related_object_type = models.CharField(max_length=100, blank=True)
    related_object_id = models.UUIDField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="CACHED")
    transmission_detail = models.TextField(blank=True)
    # Outbox behaviour (CLAUDE.md §4 "Fail safely"). `idempotency_key` is the
    # stable business identifier that makes enqueue and retry safe;
    # `retry_safe` is true only when a repeat send cannot create a duplicate
    # (an update-as-create PUT by id) — otherwise a timeout is never retried blind.
    idempotency_key = models.CharField(max_length=200, blank=True)
    retry_safe = models.BooleanField(default=False)
    attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField(null=True, blank=True, db_index=True)
    http_status = models.PositiveSmallIntegerField(null=True, blank=True)
    # OperationOutcome issues, as [{severity, code, expression, diagnostics}],
    # so whoever can fix the data sees which field to correct.
    issues = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization_id", "idempotency_key"],
                name="unique_fhir_outbox_idempotency_key",
                condition=~models.Q(idempotency_key=""),
            ),
        ]

    def __str__(self):
        timestamp = self.created_at.strftime("%Y-%m-%d %H:%M")
        return f"{self.resource_type} [{self.direction}/{self.status}] {timestamp}"


class TerminologySyncRun(models.Model):
    """
    Audit trail of terminology mirror sync attempts — docs/08-DHA-SHA-INTEGRATION.md
    §8.2's "generic TerminologySyncJob Celery task pattern reused for all
    three mirrors." No live WHO/LOINC/national-drug-registry source is
    configured in this environment, so runs honestly record a SKIPPED status
    with the reason rather than fabricating a successful sync.
    """

    SOURCE_CHOICES = [
        ("ICD11", "ICD-11 (WHO)"),
        ("LOINC", "LOINC"),
        ("NATIONAL_DRUG_INDEX", "National Drug Index"),
    ]
    STATUS_CHOICES = [
        ("SUCCESS", "Success"),
        ("FAILED", "Failed"),
        ("SKIPPED_NOT_CONFIGURED", "Skipped — source not configured"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source = models.CharField(max_length=32, choices=SOURCE_CHOICES)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES)
    records_synced = models.PositiveIntegerField(default=0)
    detail = models.TextField(blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at"]

    def __str__(self):
        return f"{self.get_source_display()} sync [{self.status}] {self.started_at:%Y-%m-%d %H:%M}"


class ShrConsent(TenantScopedModel):
    """
    One patient-consent visit on the national Shared Health Record
    (hie_spec/guides/sharedHealthRecord__gettingStarted__intro.md): requested,
    then approved or refused by the patient's OTP, then closed. The consent
    token is per visit and per patient; it is stored encrypted and never
    reused across visits. A refusal is recorded upstream, not dropped.
    """

    STATUS_PENDING = "PENDING"
    STATUS_APPROVED = "APPROVED"
    STATUS_REJECTED = "REJECTED"
    STATUS_CLOSING = "CLOSING"
    STATUS_CLOSED = "CLOSED"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Awaiting the patient's OTP"),
        (STATUS_APPROVED, "Approved — visit open"),
        (STATUS_REJECTED, "Refused by the patient"),
        (STATUS_CLOSING, "Closing — awaiting the closure OTP"),
        (STATUS_CLOSED, "Closed"),
    ]
    VISIT_TYPE_CHOICES = [("OP", "Outpatient"), ("IP", "Inpatient")]
    # The enum published on POST /shr/consents representative_relationship.
    RELATIONSHIP_CHOICES = [
        ("Healthcare Proxy", "Healthcare proxy"),
        ("Sibling", "Sibling"),
        ("Principal", "Principal"),
        ("Other", "Other"),
    ]

    patient = models.ForeignKey(
        "client_registry.Patient", on_delete=models.PROTECT, related_name="shr_consents"
    )
    branch = models.ForeignKey("tenancy.Branch", on_delete=models.PROTECT, related_name="+")
    episode = models.ForeignKey(
        "care_pathway.EpisodeOfCare", on_delete=models.PROTECT, related_name="shr_consents"
    )
    cr_id = models.CharField(max_length=64)
    visit_type = models.CharField(max_length=2, choices=VISIT_TYPE_CHOICES)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_PENDING)
    consent_id = models.CharField(max_length=64, blank=True)
    otp_record = models.CharField(max_length=128, blank=True)
    visit_id = models.CharField(max_length=64, blank=True)
    consent_token_encrypted = models.TextField(blank=True)
    emergency = models.BooleanField(default=False)
    incapacity_reason = models.CharField(max_length=255, blank=True)
    representative_cr_id = models.CharField(max_length=64, blank=True)
    representative_relationship = models.CharField(
        max_length=20, choices=RELATIONSHIP_CHOICES, blank=True
    )
    rejection_reason = models.CharField(max_length=255, blank=True)
    requested_by = models.ForeignKey(
        "accounts.User", on_delete=models.PROTECT, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    detail = models.CharField(max_length=255, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-created_at"]

    def __str__(self):
        return f"SHR consent {self.cr_id} [{self.status}]"
