"""
FHIR R4 document for one SIGNED psychotherapy progress note — read-time, built
from the note (no second store). Built with the fhir.resources R4B models, as
everywhere else (guide.md 2026-09-18 amendment). Checked against the vendored
R4 4.0.1 schema and our profiles in tests, and by HL7's validator in CI.

Mapping (owner, 2026-11-12):

| Source | R4 resource | Profile |
|---|---|---|
| PsychotherapyNote | Composition | citramac-psychotherapy-note |
| PsychotherapyNote.safety_answer | Observation | citramac-psychotherapy-safety-screen |
| PSYCHOTHERAPY clinical Encounter | Encounter, in its EpisodeOfCare | base R4 |
| Selected family-session attendees | Encounter.participant, Practitioner / RelatedPerson actors | base R4 |
| signature, each amendment | Provenance | base R4 |

- Composition: subject = the client, encounter = the session's Encounter (which
  hangs off the EpisodeOfCare, guide.md §4), author and legal attester = the
  signer, one section per output section (local section codes, in order). The
  Risk & Safety section's entry is the safety Observation. An amended note is
  `status=amended` with each section as it now stands; each amendment is a
  Provenance naming who, when and why. A signed text is never rewritten.
- Observation: the mandatory safety question's answer (local value set
  `psy-safety-answer`), one component per concern ticked on a YES, the
  clinician's description or the not-assessed reason as a note.
- Practitioners are not emitted (workforce data, not yet profiled): the signer
  is named, not linked, as on the discharge summary. Family-session attendees
  selected on the note are the exception: the Bundle carries only a minimal
  name snapshot for each selected actor, without workforce credentials or
  family contact details.

Sensitivity (§3 item 6): every resource carries `R` (HL7 v3-Confidentiality,
settings.FHIR_PSYCH_CONFIDENTIALITY_CODE) and `PSY` (HL7 v3-ActCode) — the two
codes DHA's Shared Health Record label catalogue offers for mental-health
content (hie_spec/guides/sharedHealthRecord__gettingStarted__intro.md: "N and
R for confidentiality, plus the sensitivity codes such as HIV, PSY and SUD";
its catalogue example carries the sensitivity codes under v3-ActCode).
Composition.confidentiality is R. Psychotherapy notes are never sent to the
SHR (2026-10-23 amendment); this document is for the client's own record
requests and our archive only.

VERIFY (guide.md §6), carried as text until confirmed:
- the LOINC document type for a psychotherapy progress note (Composition.type);
- a LOINC or SNOMED CT code for the session safety screen (Observation.code);
- the HL7 v3-ActCode psychotherapy-note sensitivity code, from
  hl7.org/fhir/uv/security-label-ds4p/ — not emitted until confirmed;
- the Encounter.class code for an outpatient / virtual session (display only,
  as on the triage Encounter);
- our canonical base for local profiles and code systems (urn:citramac: until
  then — settings.FHIR_LOCAL_SYSTEM_BASE is the same open item).
"""

import json
import uuid
from datetime import timedelta
from html import escape

from django.conf import settings
from fhir.resources.R4B.annotation import Annotation
from fhir.resources.R4B.bundle import Bundle, BundleEntry
from fhir.resources.R4B.codeableconcept import CodeableConcept
from fhir.resources.R4B.coding import Coding
from fhir.resources.R4B.composition import Composition, CompositionAttester, CompositionSection
from fhir.resources.R4B.encounter import Encounter, EncounterParticipant
from fhir.resources.R4B.humanname import HumanName
from fhir.resources.R4B.identifier import Identifier
from fhir.resources.R4B.meta import Meta
from fhir.resources.R4B.narrative import Narrative
from fhir.resources.R4B.observation import Observation, ObservationComponent
from fhir.resources.R4B.period import Period
from fhir.resources.R4B.practitioner import Practitioner
from fhir.resources.R4B.provenance import Provenance, ProvenanceAgent
from fhir.resources.R4B.reference import Reference
from fhir.resources.R4B.relatedperson import RelatedPerson

from apps.dha_interop.fhir_mapper import build_patient_resource
from apps.dha_interop.fhir_patient import CONFIDENTIALITY_SYSTEM

from . import psy_organizer as org

ACT_CODE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ActCode"
PROFILE_BASE = "urn:citramac:StructureDefinition"
NOTE_PROFILE = f"{PROFILE_BASE}:psychotherapy-note"
SAFETY_PROFILE = f"{PROFILE_BASE}:psychotherapy-safety-screen"
CODESYSTEM_BASE = "urn:citramac:codesystem"
SECTION_SYSTEM = f"{CODESYSTEM_BASE}:psy-note-section"
SAFETY_ANSWER_SYSTEM = f"{CODESYSTEM_BASE}:psy-safety-answer"
SAFETY_SCREEN_SYSTEM = f"{CODESYSTEM_BASE}:psy-session-safety"
SAFETY_SCREEN_CODE = "session-safety-question"
DOCUMENT_TYPE_TEXT = "Psychotherapy progress note"
# Stable ids for the resources derived from a note (a re-export is the same document).
_NAMESPACE = uuid.UUID("0b6f3c52-5d5e-4f43-9e4e-1f6d2b7a9c10")


def _ref(pk):
    # Every id here is one of our UUIDs, so urn:uuid is its identity in the document.
    return f"urn:uuid:{pk}"


def _derived_id(kind, pk):
    return uuid.uuid5(_NAMESPACE, f"{kind}:{pk}")


def security_labels():
    return [
        Coding(system=CONFIDENTIALITY_SYSTEM, code=settings.FHIR_PSYCH_CONFIDENTIALITY_CODE),
        Coding(system=ACT_CODE_SYSTEM, code="PSY"),
    ]


def _meta(profile=None):
    return Meta(profile=[profile] if profile else None, security=security_labels())


def _local(valueset, code, display=None):
    return CodeableConcept(
        coding=[Coding(system=f"{CODESYSTEM_BASE}:{valueset}", code=code, display=display)]
    )


def _narrative(text):
    body = "<br/>".join(escape(line) for line in (text or org.NOT_RECORDED).split("\n"))
    return Narrative(
        status="additional", div=f'<div xmlns="http://www.w3.org/1999/xhtml">{body}</div>'
    )


def _signer(note):
    from .services import user_display

    return Reference(display=user_display(note.signed_by))


def episode_resource(episode, patient_ref):
    """The EpisodeOfCare a clinical record hangs off: status, statusHistory, period,
    and its programme as `type` (local `care-programme` codes)."""
    from fhir.resources.R4B.episodeofcare import EpisodeOfCare, EpisodeOfCareStatusHistory

    from .fhir import _episode_period

    return EpisodeOfCare(
        id=str(episode.id),
        meta=_meta(),
        status=episode.status,
        statusHistory=[
            EpisodeOfCareStatusHistory(
                status=h.status,
                period=Period(
                    start=h.period_start.isoformat(),
                    end=h.period_end.isoformat() if h.period_end else None,
                ),
            )
            for h in episode.status_history.all()
        ]
        or None,
        type=(
            [_local("care-programme", episode.programme.code, episode.programme.display)]
            if episode.programme_id
            else None
        ),
        patient=Reference(reference=patient_ref),
        period=_episode_period(episode),
    )


def _encounter(note, patient_ref, episode_ref):
    from .psychotherapy import ATTENDANCE_VALUESET
    from .services import concept_labels

    session = note.session
    labels = concept_labels()
    start = session.session_date
    end = start + timedelta(minutes=session.duration_minutes) if session.duration_minutes else None
    types = [
        _local(
            "psychotherapy-session-type", session.session_type, session.get_session_type_display()
        )
    ]
    mode = (session.extra or {}).get("attendance_mode")
    if mode:
        types.append(_local(ATTENDANCE_VALUESET, mode, labels.get((ATTENDANCE_VALUESET, mode))))
    attendees, _ = _participant_resources(note, patient_ref)
    return Encounter(
        id=str(note.encounter_id),
        meta=_meta(),
        status="finished",
        class_fhir=Coding(display="psychotherapy session"),
        type=types,
        subject=Reference(reference=patient_ref),
        episodeOfCare=[Reference(reference=episode_ref)],
        participant=attendees or None,
        period=Period(start=start.isoformat(), end=end.isoformat() if end else None),
    )


def _participant_resources(note, patient_ref):
    """FHIR actor snapshots for the selected attendees; no contact data is exported."""
    attendees = []
    resources = []
    for key in ("family_clinicians", "family_present"):
        answer = (note.answers or {}).get(key) or {}
        for person in answer.get("participants") or []:
            resource_type = person.get("resource_type")
            if resource_type not in ("Practitioner", "RelatedPerson"):
                continue
            name = str(person.get("name") or "").strip()
            local_id = person.get("id")
            if not name or not local_id:
                continue
            resource_id = str(_derived_id(f"participant-{resource_type}", local_id))
            resource_ref = f"urn:uuid:{resource_id}"
            if resource_type == "Practitioner":
                resource = Practitioner(
                    id=resource_id,
                    meta=_meta(),
                    name=[HumanName(text=name)],
                )
            else:
                resource = RelatedPerson(
                    id=resource_id,
                    meta=_meta(),
                    patient=Reference(reference=patient_ref),
                    name=[HumanName(text=name)],
                )
            resources.append(BundleEntry(fullUrl=resource_ref, resource=resource))
            attendees.append(
                EncounterParticipant(individual=Reference(reference=resource_ref, display=name))
            )
    return attendees, resources


def _concern_components(note):
    from . import intake_schema
    from .psychotherapy import CONCERN_VALUESET, OTHER_CONCERN_VALUESET, concern_options

    options = concern_options()
    categories = {c["code"]: c["label"] for c in options["categories"]}
    others = {c["code"]: c["label"] for c in options["other"]}
    rows = {r["key"]: r["label"] for r in intake_schema.RISK_ROWS}
    out = []
    for c in (note.safety_detail or {}).get("concerns") or []:
        if "category" in c:
            code = _local(CONCERN_VALUESET, c["category"], categories.get(c["category"]))
            value = "; ".join(c.get("options") or []) or None
        elif "other" in c:
            code = _local(OTHER_CONCERN_VALUESET, c["other"], others.get(c["other"]))
            value = None
        else:
            code = _local("intake-risk-row", c["row"], rows.get(c["row"]))
            value = c.get("option")
        out.append(
            ObservationComponent(code=code, valueString=value)
            if value
            else ObservationComponent(code=code, valueBoolean=True)
        )
    return out or None


def _safety_observation(note, patient_ref, encounter_ref):
    answer = note.safety_answer
    labels = dict(org.SAFETY_OPTIONS)
    detail = note.safety_detail or {}
    notes = []
    if answer == org.SAFETY_YES and detail.get("description"):
        notes.append(Annotation(text=detail["description"]))
    if answer == org.SAFETY_NOT_ASSESSED and note.safety_ack_reason:
        notes.append(Annotation(text=f"Not assessed: {note.safety_ack_reason}"))
    return Observation(
        id=str(_derived_id("safety", note.pk)),
        meta=_meta(SAFETY_PROFILE),
        status="final",
        code=CodeableConcept(
            coding=[
                Coding(
                    system=SAFETY_SCREEN_SYSTEM,
                    code=SAFETY_SCREEN_CODE,
                    display="Psychotherapy session safety question",
                )
            ],
            text=org.SAFETY_QUESTION,
        ),
        subject=Reference(reference=patient_ref),
        encounter=Reference(reference=encounter_ref),
        effectiveDateTime=note.session.session_date.isoformat(),
        performer=[_signer(note)],
        valueCodeableConcept=CodeableConcept(
            coding=[Coding(system=SAFETY_ANSWER_SYSTEM, code=answer, display=labels[answer])]
        ),
        component=_concern_components(note) if answer == org.SAFETY_YES else None,
        note=notes or None,
    )


def build_psychotherapy_bundle(note):
    """FHIR document Bundle for one SIGNED psychotherapy note: Composition,
    Patient, EpisodeOfCare, Encounter, the safety Observation, and a Provenance
    for the signature plus one per amendment. Raises ValueError for a draft."""
    from .psychotherapy import effective_sections

    if note.status != "SIGNED" or not note.signed_at:
        raise ValueError("Only a signed psychotherapy note is a clinical document.")
    patient_ref = _ref(note.patient_id)
    episode_ref = _ref(note.episode_id)
    encounter_ref = _ref(note.encounter_id)
    composition_ref = _ref(note.pk)
    observation = _safety_observation(note, patient_ref, encounter_ref)
    observation_ref = f"urn:uuid:{observation.id}"
    _, participant_entries = _participant_resources(note, patient_ref)

    amendments = list(note.amendments.select_related("amended_by").order_by("amended_at"))
    sections = effective_sections(note)
    author = _signer(note)
    composition_sections = []
    for key, title in org.SECTIONS:
        composition_sections.append(
            CompositionSection(
                title=title,
                code=CodeableConcept(
                    coding=[Coding(system=SECTION_SYSTEM, code=key, display=title)]
                ),
                text=_narrative(sections.get(key)),
                entry=[Reference(reference=observation_ref)] if key == "risk_safety" else None,
            )
        )
    last_change = amendments[-1].amended_at if amendments else note.signed_at
    patient = build_patient_resource(note.patient)
    composition = Composition(
        id=str(note.pk),
        meta=_meta(NOTE_PROFILE),
        identifier=Identifier(system="urn:ietf:rfc:3986", value=f"urn:uuid:{note.pk}"),
        status="amended" if amendments else "final",
        type=CodeableConcept(text=DOCUMENT_TYPE_TEXT),
        subject=Reference(reference=patient_ref),
        encounter=Reference(reference=encounter_ref),
        date=last_change.isoformat(),
        author=[author],
        title=DOCUMENT_TYPE_TEXT,
        confidentiality=settings.FHIR_PSYCH_CONFIDENTIALITY_CODE,
        attester=[CompositionAttester(mode="legal", time=note.signed_at.isoformat(), party=author)],
        section=composition_sections,
    )
    provenances = [
        Provenance(
            id=str(_derived_id("sign", note.pk)),
            meta=_meta(),
            target=[Reference(reference=composition_ref), Reference(reference=observation_ref)],
            recorded=note.signed_at.isoformat(),
            activity=CodeableConcept(text="Signed by the treating clinician"),
            agent=[ProvenanceAgent(who=author)],
        )
    ]
    from .services import user_display

    for a in amendments:
        title = dict(org.SECTIONS).get(a.section, a.section)
        provenances.append(
            Provenance(
                id=str(_derived_id("amend", a.pk)),
                meta=_meta(),
                target=[Reference(reference=composition_ref)],
                recorded=a.amended_at.isoformat(),
                activity=CodeableConcept(text=f"Amendment to {title}"),
                reason=[CodeableConcept(text=a.reason)],
                agent=[ProvenanceAgent(who=Reference(display=user_display(a.amended_by)))],
            )
        )
    entries = [
        BundleEntry(fullUrl=composition_ref, resource=composition),
        BundleEntry(fullUrl=patient_ref, resource=patient),
        BundleEntry(fullUrl=episode_ref, resource=episode_resource(note.episode, patient_ref)),
        BundleEntry(fullUrl=encounter_ref, resource=_encounter(note, patient_ref, episode_ref)),
        BundleEntry(fullUrl=observation_ref, resource=observation),
    ]
    entries.extend(participant_entries)
    entries += [BundleEntry(fullUrl=f"urn:uuid:{p.id}", resource=p) for p in provenances]
    bundle = Bundle(
        meta=Meta(security=security_labels()),
        type="document",
        # bdl-9 / bdl-10: a document carries its own identity and assembly time.
        identifier=Identifier(
            system="urn:ietf:rfc:3986", value=f"urn:uuid:{_derived_id('bundle', note.pk)}"
        ),
        timestamp=last_change.isoformat(),
        entry=entries,
    )
    return json.loads(bundle.json())
