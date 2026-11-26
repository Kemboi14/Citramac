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
The episode link keeps every document on the EpisodeOfCare spine (guide.md §4).
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


# Exactly one of these is what a PartySignature signs.
SIGNATURE_TARGETS = (
    "visit_consent",
    "document",
    "legal_document",
    "safety_plan",
    "ama_acknowledgement",
)


def _one_target():
    """Q: exactly one target FK is set."""
    condition = None
    for chosen in SIGNATURE_TARGETS:
        clause = models.Q(**{f"{chosen}__isnull": False})
        for other in SIGNATURE_TARGETS:
            if other != chosen:
                clause &= models.Q(**{f"{other}__isnull": True})
        condition = clause if condition is None else condition | clause
    return condition


class PartySignature(_AppendOnly):
    """One person's electronic signature, drawn on screen and witnessed:

    - a decision consent (care_pathway.VisitConsent) or a consent document
      (GeneratedDocument) — owner decisions 2026-11-13;
    - a Mental Health Act application or written notice to leave
      (care_pathway.LegalDocument) — the applicant (client, parent / guardian, or
      the related person applying for an involuntary admission) and the staff
      witness, instead of the earlier "signed in my presence" tick-box;
    - a version of the client-held safety plan (care_pathway.SafetyPlan) — the
      client and the staff witness, when the clinician signs the version;
    - the client's acknowledgement of leaving against medical advice
      (care_pathway.AgainstAdviceAcknowledgement), against the facility's own
      wording — owner decisions 2026-11-26.

    The staff witness signs as themselves every time. Each row binds to the
    exact content signed (`content_sha256`): content changed after signing no
    longer matches, and its signatures stop counting. Append-only; nothing is
    ever re-signed in place.

    A party may instead be recorded as unable to sign (UNABLE) or — only where
    refusing is itself the event, a client leaving against advice — as refusing
    to sign (REFUSED); either way with the reason, and witnessed.

    FHIR R4: a `Provenance.signature` (type, when, who, onBehalfOf, sigFormat
    image/png, data) targeting what was signed (the `Consent`,
    documents/consent_fhir.py; the discharge `Encounter` for an against-advice
    acknowledgement, care_pathway/fhir.py). A party unable or refusing to sign
    is a Provenance agent with the stated reason, never a signature. Statutory
    forms and safety plans are not emitted yet (no DocumentReference /
    CarePlan export exists for them).
    """

    ROLE_CLIENT = "CLIENT"
    ROLE_GUARDIAN = "GUARDIAN"
    ROLE_SUBSTITUTE = "SUBSTITUTE"
    ROLE_RELATED_PERSON = "RELATED_PERSON"
    ROLE_APPLICANT = "APPLICANT"
    ROLE_WITNESS = "WITNESS"
    ROLE_CHOICES = [
        (ROLE_CLIENT, "Client"),
        (ROLE_GUARDIAN, "Parent / guardian"),
        (ROLE_SUBSTITUTE, "Substitute decision-maker"),
        (ROLE_RELATED_PERSON, "Family member / caregiver"),
        (ROLE_APPLICANT, "Applicant (related person)"),
        (ROLE_WITNESS, "Staff witness"),
    ]
    METHOD_DRAWN = "DRAWN"
    METHOD_UNABLE = "UNABLE"
    METHOD_REFUSED = "REFUSED"
    METHOD_CHOICES = [
        (METHOD_DRAWN, "Drawn on screen, witnessed"),
        (METHOD_UNABLE, "Unable to sign — reason recorded, witnessed"),
        (METHOD_REFUSED, "Refused to sign — reason recorded, witnessed"),
    ]

    patient = models.ForeignKey(
        "client_registry.Patient", on_delete=models.PROTECT, related_name="party_signatures"
    )
    visit_consent = models.ForeignKey(
        "care_pathway.VisitConsent",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="signatures",
    )
    document = models.ForeignKey(
        GeneratedDocument,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="party_signatures",
    )
    legal_document = models.ForeignKey(
        "care_pathway.LegalDocument",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="party_signatures",
    )
    safety_plan = models.ForeignKey(
        "care_pathway.SafetyPlan",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="signatures",
    )
    ama_acknowledgement = models.ForeignKey(
        "care_pathway.AgainstAdviceAcknowledgement",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="signatures",
    )
    role = models.CharField(max_length=16, choices=ROLE_CHOICES)
    signer_name = models.CharField(max_length=150)
    relationship = models.CharField(max_length=100, blank=True)
    related_person = models.ForeignKey(
        "client_registry.EmergencyContact",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
    )
    # The staff witness signing as themselves.
    signer_user = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    method = models.CharField(max_length=8, choices=METHOD_CHOICES)
    # Why the party could not, or would not, sign (UNABLE / REFUSED).
    unable_reason = models.TextField(blank=True)
    image_png = models.BinaryField(null=True, blank=True)
    image_sha256 = models.CharField(max_length=64, blank=True)
    content_sha256 = models.CharField(max_length=64)
    captured_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, related_name="+"
    )
    captured_at = models.DateTimeField(default=timezone.now)

    class Meta(TenantScopedModel.Meta):
        ordering = ["captured_at"]
        constraints = [
            models.CheckConstraint(condition=_one_target(), name="party_signature_one_target"),
            models.CheckConstraint(
                condition=(
                    models.Q(method="DRAWN", image_png__isnull=False)
                    | models.Q(method__in=("UNABLE", "REFUSED"), image_png__isnull=True)
                    & ~models.Q(unable_reason="")
                ),
                name="party_signature_image_or_reason",
            ),
        ]
