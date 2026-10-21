"""
Psychotherapy Session note (master prompt §7 PSY-*). Imported by models.py so
Django registers these under the care_pathway app.

FHIR R4 mapping (VERIFY with the project owner before export is built —
CLAUDE.md §7 asks for confirmation before a clinical feature is implemented):

| Model | FHIR R4 resource |
|---|---|
| PsychotherapyNote | Composition (psychotherapy progress note): subject = Patient, encounter = the PSYCHOTHERAPY Encounter in the EpisodeOfCare, author = therapist, attester(legal) on sign, one Composition.section per PSY-OUT section. VERIFY: the LOINC document type code for a psychotherapy note — not invented here (CLAUDE.md §6). Sensitivity: DS4P confidentiality label — VERIFY the code system URL and code against hl7.org/fhir/uv/security-label-ds4p/ |
| PsychotherapyNote.safety_answer | Observation (session safety screen), value from a local value set |
| PsychotherapyNoteAmendment | Composition.relatesTo (appends) + Provenance (who/when/why) |
| TherapyModel | local CodeSystem (served, tenant-configurable registry) |
| ClinicalLexiconTerm | local configuration — not clinical data, no FHIR analogue |

The note is stored once: the session itself is the existing
mhp_program.PsychotherapySession row (date, duration, type, therapist, modality),
and this note is its one structured note (OneToOne). No second store.
"""

from django.db import models
from django.utils import timezone

from apps.client_registry.models import Patient
from apps.tenancy.models import TenantScopedModel, TimestampedModel


class ClinicalLexiconTerm(TimestampedModel):
    """A served, configurable lexicon entry (PSY-RD risk-language prompts,
    PSY-GEN-11 stigmatizing-language flags, PSY-GEN-3 client-report cues).
    Platform-wide like LocalValueSet: editing a phrase is a data change, not a
    release. Seeded by migration with demo terms — VERIFY: clinical governance
    sign-off of every list before go-live."""

    LEXICON_CHOICES = [
        ("PSY_RISK", "Psychotherapy risk-language prompt"),
        ("PSY_STIGMA", "Stigmatizing language"),
        ("PSY_REPORT_CUE", "Client-report attribution cue"),
    ]
    lexicon = models.CharField(max_length=16, choices=LEXICON_CHOICES)
    category = models.CharField(max_length=40, blank=True)
    phrase = models.CharField(max_length=120)
    suggestion = models.TextField(blank=True)
    active = models.BooleanField(default=True)
    version = models.CharField(max_length=16, default="1")

    class Meta:
        ordering = ["lexicon", "category", "phrase"]
        constraints = [
            models.UniqueConstraint(fields=["lexicon", "phrase"], name="unique_lexicon_phrase")
        ]

    def __str__(self):
        return f"{self.lexicon}:{self.phrase}"


class TherapyModel(TenantScopedModel):
    """PSY-TM-03: a therapy model in the organisation's registry — id, name,
    concepts, version, enabled. Adding one (or a concept) needs no code change:
    the workflow and the five questions read the registry (AT-17)."""

    code = models.SlugField(max_length=64)
    name = models.CharField(max_length=120)
    # Words a clinician may use to name the model (abbreviations, spellings).
    aliases = models.JSONField(default=list, blank=True)
    concepts = models.JSONField(default=list, blank=True)
    version = models.CharField(max_length=16, default="1")
    enabled = models.BooleanField(default=True)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta(TenantScopedModel.Meta):
        ordering = ["order", "name"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "code"], name="unique_therapy_model_per_org")
        ]

    def __str__(self):
        return self.name


class PsychotherapyNote(TenantScopedModel):
    """The structured note of one psychotherapy session: the clinician's answers
    to the five questions, the mandatory safety answer, the generated (then
    edited) PSY-OUT sections and the signature. A signed note is immutable —
    later changes are PsychotherapyNoteAmendment rows (PSY-SIGN, AT-18)."""

    STATUS_CHOICES = [("DRAFT", "Draft"), ("SIGNED", "Signed")]
    SAFETY_CHOICES = [("YES", "Yes"), ("NO", "No"), ("NOT_ASSESSED", "Not assessed")]

    session = models.OneToOneField(
        "mhp_program.PsychotherapySession", on_delete=models.PROTECT, related_name="psy_note"
    )
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="psychotherapy_notes")
    therapy_episode = models.ForeignKey(
        "TherapyEpisode", on_delete=models.PROTECT, null=True, blank=True, related_name="notes"
    )
    episode = models.ForeignKey("EpisodeOfCare", on_delete=models.PROTECT, related_name="+")
    encounter = models.ForeignKey(
        "clinical_encounter.Encounter", on_delete=models.PROTECT, related_name="+"
    )
    author = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, related_name="+")
    status = models.CharField(max_length=6, choices=STATUS_CHOICES, default="DRAFT")
    # {"q1".."q5": {"text", "mode": "TYPED" | "DICTATED", "answered_at", "language",
    #  "translation": {"status": pending|done|error|unavailable, "text", "model", "at", ...}}}
    # `text` is always the clinician's own words; a translation is kept beside it
    # with its provenance, never in place of it. (Earlier drafts: mode SPEAK | TYPE.)
    answers = models.JSONField(default=dict, blank=True)
    # Therapy models the clinician ticked in Q3 (TherapyModel codes).
    selected_models = models.JSONField(default=list, blank=True)
    # {model code: "INCLUDE" | "EXCLUDE"} — the clinician's decision on each
    # detected model (named → included unless excluded; suggested → excluded
    # unless included).
    model_decisions = models.JSONField(default=dict, blank=True)
    safety_answer = models.CharField(max_length=12, choices=SAFETY_CHOICES, blank=True)
    # YES: {"concerns": [{"row", "option"} | {"other": code}], "description", "actions"}
    safety_detail = models.JSONField(default=dict, blank=True)
    safety_ack_reason = models.TextField(blank=True)
    safety_ack_at = models.DateTimeField(null=True, blank=True)
    safety_ack_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    safety_alert = models.ForeignKey(
        "ClinicalAlert", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    not_assessed_alert = models.ForeignKey(
        "ClinicalAlert", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    # {"<question>:<term id>": {"reason", "by", "at"}} — PSY-RD mismatch resolutions.
    detection_resolutions = models.JSONField(default=dict, blank=True)
    # [{"goal_index", "goal", "evidence", "statement",
    #   "status": PROGRESS|NO_CHANGE|BARRIER|NOT_RELEVANT (earlier: CONFIRMED|DISMISSED), "by", "at"}]
    goal_links = models.JSONField(default=list, blank=True)
    # PSY-OUT sections ({key: text}) as they stand: the generated text, with the
    # clinician's own edit in place of it for an edited section.
    sections = models.JSONField(default=dict, blank=True)
    # The system-generated text of each section (rule-based or reworded) — what
    # "Revert" restores — and the clinician's edits, kept apart so organising
    # again never overwrites an edited section.
    generated_sections = models.JSONField(default=dict, blank=True)
    section_edits = models.JSONField(default=dict, blank=True)  # {key: {"text", "by", "at"}}
    # How the sections were produced: {"engine": "rules" | "ai", "status":
    # done | pending | error | disabled, "model", "requested_at", "at", "token",
    # "sections": {key: {"source": "ai" | "rules", "model", "at"}}, "error"}.
    processing = models.JSONField(default=dict, blank=True)
    models_applied = models.JSONField(default=list, blank=True)
    generated_at = models.DateTimeField(null=True, blank=True)
    sections_edited = models.BooleanField(default=False)
    accuracy_confirmed = models.BooleanField(default=False)
    draft_saved_at = models.DateTimeField(default=timezone.now)
    signed_at = models.DateTimeField(null=True, blank=True)
    signed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Append-only audit entries for the draft (DATA-02 AuditEntry shape).
    history = models.JSONField(default=list, blank=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["-created_at"]


class PsychotherapyNoteAmendment(TenantScopedModel):
    """An audited change to one section of a signed note. The signed text is
    never edited; the effective section is the latest amendment (AT-18)."""

    note = models.ForeignKey(PsychotherapyNote, on_delete=models.PROTECT, related_name="amendments")
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name="+")
    section = models.CharField(max_length=24)
    previous_text = models.TextField()
    new_text = models.TextField()
    reason = models.TextField()
    amended_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True, related_name="+")
    amended_at = models.DateTimeField(default=timezone.now)

    class Meta(TenantScopedModel.Meta):
        ordering = ["amended_at"]
