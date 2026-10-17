"""
Generated clinical documents (master prompt §6 DOC-WF / DOC-GOV).

FHIR R4 mapping (documented, not yet serialized — see the app README note in
apps/documents/catalogue.py and the VERIFY list in the build report):
  GeneratedDocument  → Composition (status preliminary/final/amended, subject,
                       author, attester, encounter→episode) inside a document
                       Bundle, indexed by a DocumentReference with
                       meta.security confidentiality / sensitivity labels.
                       Composition.type needs a LOINC document code per
                       template — VERIFY, none is invented here.
  DocumentEvent      → Provenance (activity = the transition) per version.
  DisclosureRecord   → AuditEvent (disclosure) citing the Consent relied on.
The episode link keeps every document on the EpisodeOfCare spine (CLAUDE.md §4).
"""

import uuid

from django.db import models
from django.utils import timezone

from apps.tenancy.models import TenantScopedModel

STATUS_DRAFT = "DRAFT"
STATUS_IN_REVIEW = "IN_REVIEW"
STATUS_SIGNED = "SIGNED"
STATUS_RELEASED = "RELEASED"
STATUS_FILED = "FILED"
STATUS_BLOCKED_CONSENT = "BLOCKED_CONSENT"
STATUS_CHOICES = [
    (STATUS_DRAFT, "Draft"),
    (STATUS_IN_REVIEW, "In review"),
    (STATUS_SIGNED, "Authorized / signed"),
    (STATUS_RELEASED, "Released"),
    (STATUS_FILED, "Filed in chart"),
    (STATUS_BLOCKED_CONSENT, "Blocked — consent required"),
]
# Once signed, the content of a version never changes (DOC-WF, LGL-DOC-04).
SIGNED_STATES = {STATUS_SIGNED, STATUS_RELEASED, STATUS_FILED}

FROZEN_FIELDS = [
    "patient_id",
    "episode_id",
    "template_id",
    "catalogue_version",
    "series_id",
    "version",
    "supersedes_id",
    "recipient_type",
    "recipient_name",
    "recipient_organization",
    "purpose",
    "inputs",
    "content",
    "rule_trace",
    "included_classes",
    "excluded_classes",
    "security_labels",
    "author_id",
    "signed_by_id",
    "signed_at",
    "signer_credentials",
    "content_hash",
    "correction_reason",
    "legal_document_id",
]


class GeneratedDocument(TenantScopedModel):
    """One version of one generated document. A correction is a new row in the
    same series with version + 1, `supersedes` and a reason; the signed
    original is never edited."""

    patient = models.ForeignKey(
        "client_registry.Patient", on_delete=models.PROTECT, related_name="generated_documents"
    )
    episode = models.ForeignKey(
        "care_pathway.EpisodeOfCare",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    template_id = models.CharField(max_length=24, db_index=True)
    catalogue_version = models.CharField(max_length=32)
    series_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    version = models.PositiveIntegerField(default=1)
    supersedes = models.ForeignKey(
        "self", on_delete=models.PROTECT, null=True, blank=True, related_name="superseded_by"
    )
    correction_reason = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    # The status a BLOCKED_CONSENT document returns to once consent is on record.
    blocked_from = models.CharField(max_length=16, blank=True)
    block_detail = models.JSONField(default=dict, blank=True)

    recipient_type = models.CharField(max_length=24)
    recipient_name = models.CharField(max_length=255, blank=True)
    recipient_organization = models.CharField(max_length=255, blank=True)
    purpose = models.CharField(max_length=255, blank=True)
    inputs = models.JSONField(default=dict, blank=True)

    content = models.JSONField(default=dict, blank=True)
    rule_trace = models.JSONField(default=list, blank=True)
    included_classes = models.JSONField(default=list, blank=True)
    excluded_classes = models.JSONField(default=list, blank=True)
    security_labels = models.JSONField(default=dict, blank=True)
    consent_record = models.ForeignKey(
        "client_registry.ConsentRecord",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )

    author = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, related_name="+"
    )
    generated_at = models.DateTimeField(default=timezone.now)
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    signed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    signed_at = models.DateTimeField(null=True, blank=True)
    signer_credentials = models.CharField(max_length=255, blank=True)
    content_hash = models.CharField(max_length=64, blank=True)
    filed_at = models.DateTimeField(null=True, blank=True)
    filed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # LGL-DOC-05: a release of a statutory form points at the signed form in
    # the legal module's store; the form itself is never copied here.
    legal_document = models.ForeignKey(
        "care_pathway.LegalDocument",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="release_documents",
    )

    class Meta(TenantScopedModel.Meta):
        ordering = ["-generated_at"]
        constraints = [
            models.UniqueConstraint(fields=["series_id", "version"], name="uniq_document_version")
        ]

    @property
    def document_number(self):
        return f"{self.template_id}/{str(self.series_id)[:8].upper()}"

    def save(self, *args, **kwargs):
        if self.pk:
            stored = (
                type(self).all_objects.filter(pk=self.pk).values(*FROZEN_FIELDS, "status").first()
            )
            if stored and (
                stored["status"] in SIGNED_STATES
                or (
                    stored["status"] == STATUS_BLOCKED_CONSENT
                    and self.blocked_from in SIGNED_STATES
                )
            ):
                changed = [f for f in FROZEN_FIELDS if stored[f] != getattr(self, f)]
                if changed:
                    raise PermissionError(
                        "This document version is signed and cannot be changed; "
                        "amend it as a new version."
                    )
        super().save(*args, **kwargs)


class _AppendOnly(TenantScopedModel):
    class Meta(TenantScopedModel.Meta):
        abstract = True

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise PermissionError(f"{type(self).__name__} rows are append-only.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PermissionError(f"{type(self).__name__} rows are append-only.")


class DocumentEvent(_AppendOnly):
    """Every workflow transition (DOC-WF: 'every transition is audited';
    X-03 per-document history)."""

    document = models.ForeignKey(GeneratedDocument, on_delete=models.PROTECT, related_name="events")
    patient = models.ForeignKey(
        "client_registry.Patient", on_delete=models.PROTECT, related_name="+"
    )
    action = models.CharField(max_length=24)
    from_status = models.CharField(max_length=16, blank=True)
    to_status = models.CharField(max_length=16, blank=True)
    actor = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, related_name="+"
    )
    actor_roles = models.CharField(max_length=255, blank=True)
    at = models.DateTimeField(default=timezone.now)
    reason = models.TextField(blank=True)
    detail = models.JSONField(default=dict, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["at"]


class DisclosureRecord(_AppendOnly):
    """The chart's disclosure log (DOC-GOV-06, AT-13). 'Send' is recorded here —
    CITRAMAC transmits nothing externally."""

    CHANNEL_CHOICES = [
        ("PRINT", "Printed"),
        ("PDF", "PDF handed over"),
        ("RECORDED_RELEASE", "Recorded release (sent outside CITRAMAC)"),
        ("FILE_IN_CHART", "Filed in chart only"),
    ]

    document = models.ForeignKey(
        GeneratedDocument, on_delete=models.PROTECT, related_name="disclosures"
    )
    patient = models.ForeignKey(
        "client_registry.Patient", on_delete=models.PROTECT, related_name="document_disclosures"
    )
    document_number = models.CharField(max_length=64)
    template_id = models.CharField(max_length=24)
    document_version = models.PositiveIntegerField()
    content_hash = models.CharField(max_length=64)
    recipient_type = models.CharField(max_length=24)
    recipient_name = models.CharField(max_length=255, blank=True)
    recipient_organization = models.CharField(max_length=255, blank=True)
    purpose = models.CharField(max_length=255)
    channel = models.CharField(max_length=20, choices=CHANNEL_CHOICES)
    legal_basis = models.CharField(max_length=20)
    legal_basis_reference = models.CharField(max_length=255, blank=True)
    consent_record = models.ForeignKey(
        "client_registry.ConsentRecord",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    classes_disclosed = models.JSONField(default=list)
    released_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, related_name="+"
    )
    released_by_roles = models.CharField(max_length=255, blank=True)
    released_at = models.DateTimeField(default=timezone.now)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-released_at"]
