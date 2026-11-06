"""v3 SOAP notes → the one progress-note store (owner decision, 2026-11-06).

The v3 encounter screen wrote `clinical_encounter.SoapNote`; everything since
writes `ProgressNote`. Each SOAP note is copied once into a ProgressNote of type
SOAP_V3 — same patient, encounter, episode, author and times, signed stays
signed — with `source_soap_note` pointing back at it. The SoapNote row is not
touched: it stays as the archive the copy was made from, so the copy can always
be checked against it, and reversing removes only the copies.

Takes the model classes as arguments so the data migration can pass its
historical models (`apps.get_model`) and tests the real ones.
"""

NOTE_TYPE = "SOAP_V3"
NOTE_TYPE_DISPLAY = "SOAP note (earlier encounter screen)"
SECTIONS = (
    ("Subjective", "subjective"),
    ("Objective", "objective"),
    ("Assessment", "assessment"),
    ("Plan", "plan"),
)


def _rows(model):
    """The unfiltered manager: `all_objects` on the real model; a migration's
    historical model only has the plain default manager."""
    return getattr(model, "all_objects", None) or model._default_manager


def note_text(soap):
    """The four sections in order, each under its heading; empty ones left out."""
    parts = []
    for heading, field in SECTIONS:
        value = (getattr(soap, field) or "").strip()
        if value:
            parts.append(f"{heading}:\n{value}")
    return "\n\n".join(parts)


def ensure_note_type(LocalValueSet, LocalConcept):
    """SOAP_V3 in the note-type value set, inactive: it labels the copies but is
    never offered (or accepted) for a new note."""
    valueset, _ = LocalValueSet.objects.get_or_create(
        id="note-type", defaults={"title": "Progress note type"}
    )
    order = valueset.concepts.count()
    LocalConcept.objects.get_or_create(
        valueset=valueset,
        code=NOTE_TYPE,
        defaults={"display": NOTE_TYPE_DISPLAY, "order": order, "active": False},
    )


def copy_soap_notes(SoapNote, ProgressNote):
    """Copies every SOAP note not yet copied. Idempotent. Returns how many."""
    copied = 0
    pending = (
        _rows(SoapNote)
        .filter(progress_note_copy__isnull=True)
        .select_related("encounter")
        .order_by("created_at")
    )
    for soap in pending.iterator():
        encounter = soap.encounter
        signed = bool(soap.is_locked or soap.signed_at)
        note = _rows(ProgressNote).create(
            organization_id=soap.organization_id,
            patient_id=encounter.patient_id,
            episode_id=encounter.episode_id,
            encounter_id=encounter.id,
            note_type=NOTE_TYPE,
            text=note_text(soap),
            status="SIGNED" if signed else "DRAFT",
            author_id=soap.author_id,
            # A locked note with no recorded time is still signed; its creation
            # time is the closest record of when.
            signed_at=(soap.signed_at or soap.created_at) if signed else None,
            source_soap_note_id=soap.id,
        )
        # auto_now_add/auto_now overwrite on create; keep the original times.
        _rows(ProgressNote).filter(pk=note.pk).update(
            created_at=soap.created_at, updated_at=soap.updated_at
        )
        copied += 1
    return copied


def remove_copies(ProgressNote):
    """Reverse: delete copies nobody has written an addendum to. A copy with an
    addendum is a clinical record in its own right now and is kept."""
    copies = _rows(ProgressNote).filter(source_soap_note__isnull=False, addenda__isnull=True)
    return copies.delete()[0]
