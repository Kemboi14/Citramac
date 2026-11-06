"""
FHIR R4 4.0.1 resources built from our models.

Constructed with `fhir.resources.R4B` classes — the documented construction-only
exception (CLAUDE.md, 2026-09-18). R4B is not R4: conformance is checked against
HL7's R4 4.0.1 schema (fhir_validation), never against the library.
"""

import json
import logging

from fhir.resources.R4B.annotation import Annotation
from fhir.resources.R4B.bundle import Bundle, BundleEntry
from fhir.resources.R4B.codeableconcept import CodeableConcept
from fhir.resources.R4B.coding import Coding
from fhir.resources.R4B.composition import Composition, CompositionSection
from fhir.resources.R4B.condition import Condition
from fhir.resources.R4B.dosage import Dosage
from fhir.resources.R4B.encounter import Encounter
from fhir.resources.R4B.identifier import Identifier
from fhir.resources.R4B.medicationrequest import MedicationRequest
from fhir.resources.R4B.observation import Observation
from fhir.resources.R4B.reference import Reference
from fhir.resources.R4B.riskassessment import RiskAssessment

from .fhir_patient import build_patient_resource as _build_patient

logger = logging.getLogger(__name__)

_GENDER_MAP = {"MALE": "male", "FEMALE": "female", "OTHER": "other"}


def _urn(resource_type, internal_id):
    """Bundle-local reference urn — resolved to real HIE identifiers on ingest."""
    return f"urn:citramac:{resource_type.lower()}:{internal_id}"


def build_patient_resource(patient):
    """Patient with sliced identifiers — see fhir_patient. Identifiers with no
    configured `system` are withheld and logged, never sent under an invented URI."""
    resource, omitted = _build_patient(patient)
    for reason in omitted:
        logger.warning("Patient %s: identifier withheld from FHIR — %s", patient.id, reason)
    return resource


CONDITION_CLINICAL_SYSTEM = "http://terminology.hl7.org/CodeSystem/condition-clinical"
CONDITION_VER_STATUS_SYSTEM = "http://terminology.hl7.org/CodeSystem/condition-ver-status"
_CLINICAL_STATUS = {"ACTIVE": "active", "HISTORICAL": "inactive", "RESOLVED": "resolved"}


def build_condition_resource(diagnosis, patient_ref):
    """Both statuses are modifier elements in R4: without verificationStatus a
    ruled-out diagnosis reads as an asserted one. A row whose certainty was
    never stated carries none rather than a guessed one, and a refuted
    diagnosis carries no clinical status (it is not active, it never was)."""
    verification = diagnosis.FHIR_VERIFICATION.get(diagnosis.verification_status)
    # R4 con-3/con-5: no clinicalStatus on a refuted or entered-in-error Condition.
    clinical = (
        None
        if verification in ("refuted", "entered-in-error")
        else _CLINICAL_STATUS.get(diagnosis.status)
    )
    return Condition(
        id=str(diagnosis.id),
        subject=Reference(reference=patient_ref),
        clinicalStatus=(
            CodeableConcept(coding=[Coding(system=CONDITION_CLINICAL_SYSTEM, code=clinical)])
            if clinical
            else None
        ),
        verificationStatus=(
            CodeableConcept(coding=[Coding(system=CONDITION_VER_STATUS_SYSTEM, code=verification)])
            if verification
            else None
        ),
        code=CodeableConcept(
            coding=[
                Coding(
                    system="http://id.who.int/icd/release/11/mms",
                    code=diagnosis.icd11_code_id,
                    display=diagnosis.icd11_code.description,
                )
            ]
        ),
    )


def build_medication_request_resource(item, patient_ref):
    return MedicationRequest(
        id=str(item.id),
        status="active",
        intent="order",
        subject=Reference(reference=patient_ref),
        medicationCodeableConcept=CodeableConcept(
            coding=[
                Coding(
                    system="urn:citramac:national-drug-index",
                    code=item.drug_id,
                    display=item.drug.generic_name,
                )
            ]
        ),
        dosageInstruction=[
            Dosage(
                text=" ".join(filter(None, [item.dose, item.route, item.frequency, item.duration]))
                or None
            )
        ],
    )


def build_observation_resource(substance_use_entry, patient_ref):
    """
    Substance-use finding from a Client History intake's `SubstanceUseEntry`.
    `code` is text only: no LOINC code for it has been verified (CLAUDE.md §6 —
    VERIFY: the LOINC code for substance use, from loinc.org), and a plausible
    wrong code is worse than none.
    """
    effective_date = substance_use_entry.last_use or substance_use_entry.first_use
    note_text = " · ".join(filter(None, [substance_use_entry.frequency, substance_use_entry.route]))
    return Observation(
        id=str(substance_use_entry.id),
        status="final",
        category=[
            CodeableConcept(
                coding=[
                    Coding(
                        # hl7.terminology.r4 7.4.0 (a Kenya Core dependency).
                        system="http://terminology.hl7.org/CodeSystem/observation-category",
                        code="social-history",
                        display="Social History",
                    )
                ]
            )
        ],
        code=CodeableConcept(text="Substance use"),
        subject=Reference(reference=patient_ref),
        effectiveDateTime=effective_date.isoformat() if effective_date else None,
        valueCodeableConcept=CodeableConcept(text=substance_use_entry.substance),
        note=[Annotation(text=note_text)] if note_text else None,
    )


_ENCOUNTER_STATUS_MAP = {
    "ADMITTED": "in-progress",
    "TRANSFERRED": "in-progress",
    "DISCHARGED": "finished",
}


def build_encounter_resource(admission, patient_ref, episode_ref=None):
    """The inpatient stay: R4 Encounter class IMP, inside its EpisodeOfCare
    (CLAUDE.md §4). Its id is the clinical Encounter the admission opened, the
    same id the SHR uses, so one stay is one Encounter everywhere."""
    from fhir.resources.R4B.period import Period

    period_kwargs = {"start": admission.admitted_at.isoformat()}
    if admission.discharged_at:
        period_kwargs["end"] = admission.discharged_at.isoformat()

    return Encounter(
        id=str(admission.encounter_id or admission.id),
        status=_ENCOUNTER_STATUS_MAP.get(admission.status, "unknown"),
        class_fhir=Coding(
            system="http://terminology.hl7.org/CodeSystem/v3-ActCode",
            code="IMP",
            display="inpatient encounter",
        ),
        subject=Reference(reference=patient_ref),
        episodeOfCare=[Reference(reference=episode_ref)] if episode_ref else None,
        period=Period(**period_kwargs),
        reasonCode=(
            [CodeableConcept(text=admission.reason_for_admission)]
            if admission.reason_for_admission
            else None
        ),
    )


_RISK_LABELS = {
    "risk_self_harm": "Self-harm / suicide risk",
    "risk_to_others": "Risk to others",
    "risk_absconding": "Absconding / wandering risk",
    "risk_medical": "Medical / physical risk",
}


def _has_admission_risk(admission):
    # ROUTINE is the default level every admission starts with — not a recorded risk.
    return bool(
        any(getattr(admission, field) for field in _RISK_LABELS)
        or admission.observation_level not in ("", "ROUTINE")
        or admission.risk_summary
    )


def build_risk_assessment_resource(admission, patient_ref, encounter_ref=None):
    """The risk recorded at admission. Built from what was recorded, whatever the
    admission's legal basis — which resource is present must not reveal it."""
    active_risks = [label for field, label in _RISK_LABELS.items() if getattr(admission, field)]
    note_lines = []
    if active_risks:
        note_lines.append("Identified risks: " + ", ".join(active_risks))
    if admission.observation_level:
        note_lines.append(f"Observation level: {admission.get_observation_level_display()}")
    if admission.risk_summary:
        note_lines.append(admission.risk_summary)

    return RiskAssessment(
        id=str(admission.id),
        status="final",
        subject=Reference(reference=patient_ref),
        encounter=Reference(reference=encounter_ref) if encounter_ref else None,
        occurrenceDateTime=admission.admitted_at.isoformat(),
        note=[Annotation(text="\n".join(note_lines))] if note_lines else None,
    )


def build_admission_bundle(admission):
    """Encounter (class IMP, in its episode) + the admission RiskAssessment when
    any risk was recorded. Served by AdmissionViewSet.fhir for review; never
    transmitted. Legal status has no R4 home and is not in it (legal_models.py);
    treatment consent is the admission's VisitConsent, not a field here."""
    patient = admission.patient
    patient_ref = _urn("Patient", patient.id)
    encounter_ref = _urn("Encounter", admission.encounter_id or admission.id)
    episode_ref = _urn("EpisodeOfCare", admission.episode_id) if admission.episode_id else None

    entries = [
        BundleEntry(fullUrl=patient_ref, resource=build_patient_resource(patient)),
        BundleEntry(
            fullUrl=encounter_ref,
            resource=build_encounter_resource(admission, patient_ref, episode_ref),
        ),
    ]
    if _has_admission_risk(admission):
        entries.append(
            BundleEntry(
                fullUrl=_urn("RiskAssessment", admission.id),
                resource=build_risk_assessment_resource(admission, patient_ref, encounter_ref),
            )
        )

    bundle = Bundle(type="collection", entry=entries)
    return json.loads(bundle.model_dump_json(exclude_none=True))


def build_client_history_bundle(assessment):
    """
    Composition + Patient + Condition (presenting problem) +
    Observation(s) (substance-use screening), for a Client History intake
    (`BiopsychosocialAssessment`) — docs/07-CLINICAL-MODULES-SPEC.md
    §7.14.1. No FHIR representation of a Client History submission existed
    before this. Deliberately does not construct `CarePlan` or
    `FamilyMemberHistory` — neither is named anywhere in
    docs/08-DHA-SHA-INTEGRATION.md's target resource list, unlike
    `Observation`, which this closes a real gap for. Mirrors
    `build_admission_bundle`'s pattern: surfaced for review, not
    auto-transmitted (no submission pipeline exists for this bundle type
    yet).
    """
    patient = assessment.patient
    patient_ref = _urn("Patient", patient.id)

    entries = [BundleEntry(fullUrl=patient_ref, resource=build_patient_resource(patient))]
    section_references = []

    if assessment.presenting_problem:
        condition_ref = _urn("Condition", assessment.id)
        entries.append(
            BundleEntry(
                fullUrl=condition_ref,
                resource=Condition(
                    id=str(assessment.id),
                    subject=Reference(reference=patient_ref),
                    code=CodeableConcept(text=assessment.presenting_problem),
                    onsetDateTime=(
                        assessment.hpi_onset_date.isoformat() if assessment.hpi_onset_date else None
                    ),
                ),
            )
        )
        section_references.append(Reference(reference=condition_ref))

    for entry in assessment.substance_use_entries.all():
        obs_ref = _urn("Observation", entry.id)
        entries.append(
            BundleEntry(fullUrl=obs_ref, resource=build_observation_resource(entry, patient_ref))
        )
        section_references.append(Reference(reference=obs_ref))

    author_name = "CITRAMAC System"
    if assessment.author_id:
        full_name = f"{assessment.author.first_name} {assessment.author.last_name}".strip()
        if full_name:
            author_name = full_name

    composition = Composition(
        id=str(assessment.id),
        status="final" if assessment.status == "SUBMITTED" else "preliminary",
        type=CodeableConcept(text="Client Intake History Form"),
        subject=Reference(reference=patient_ref),
        date=assessment.created_at.isoformat(),
        author=[Reference(display=author_name)],
        title="Client Intake History Form",
        section=(
            [
                CompositionSection(
                    title="Presenting Problem & Substance Use", entry=section_references
                )
            ]
            if section_references
            else None
        ),
    )
    composition_ref = _urn("Composition", assessment.id)
    entries.insert(0, BundleEntry(fullUrl=composition_ref, resource=composition))

    # bdl-9 / bdl-10: a document carries its own identity and assembly time.
    # urn:ietf:rfc:3986 is the base-spec system for a value that is itself a URI.
    bundle = Bundle(
        type="document",
        identifier=Identifier(system="urn:ietf:rfc:3986", value=f"urn:uuid:{assessment.id}"),
        timestamp=assessment.updated_at.isoformat(),
        entry=entries,
    )
    return json.loads(bundle.model_dump_json(exclude_none=True))
