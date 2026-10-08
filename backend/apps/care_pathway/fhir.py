"""
FHIR R4 bundle for one triage encounter — docs/15-CLINICAL-WORKSPACE-V3.md §3
(M1–M3). Built with the fhir.resources R4B models, as everywhere else
(CLAUDE.md 2026-09-18 amendment), and validated against the vendored R4 4.0.1
schema in tests.

Local code systems use `urn:citramac:codesystem:<value set id>`.
VERIFY: our canonical base URL for local CodeSystems once the national IG
publishes one. VERIFY: Encounter.class code for an outpatient triage
encounter (v3 ActCode) — carried as display text only until confirmed.
No LOINC codes are emitted for vital signs or instruments until verified.
"""

import json
from html import escape

from fhir.resources.R4B.annotation import Annotation
from fhir.resources.R4B.bundle import Bundle, BundleEntry
from fhir.resources.R4B.codeableconcept import CodeableConcept
from fhir.resources.R4B.coding import Coding
from fhir.resources.R4B.composition import (
    Composition,
    CompositionAttester,
    CompositionRelatesTo,
    CompositionSection,
)
from fhir.resources.R4B.encounter import Encounter, EncounterHospitalization
from fhir.resources.R4B.episodeofcare import EpisodeOfCare, EpisodeOfCareStatusHistory
from fhir.resources.R4B.flag import Flag
from fhir.resources.R4B.narrative import Narrative
from fhir.resources.R4B.period import Period
from fhir.resources.R4B.provenance import Provenance, ProvenanceAgent
from fhir.resources.R4B.questionnaireresponse import (
    QuestionnaireResponse,
    QuestionnaireResponseItem,
    QuestionnaireResponseItemAnswer,
)
from fhir.resources.R4B.reference import Reference
from fhir.resources.R4B.riskassessment import RiskAssessment
from fhir.resources.R4B.task import Task

from apps.dha_interop.fhir_mapper import (
    _urn,
    build_condition_resource,
    build_encounter_resource,
    build_medication_request_resource,
    build_patient_resource,
)

_ENCOUNTER_STATUS = {
    "AWAITING": "arrived",
    "IN_TRIAGE": "triaged",
    "COMPLETED": "finished",
    "RECHECK_COMPLETED": "finished",
}
_TASK_STATUS = {"INITIATED": "requested", "PENDING": "ready", "COMPLETED": "completed"}


def _local(valueset, code, display=None):
    return CodeableConcept(
        coding=[Coding(system=f"urn:citramac:codesystem:{valueset}", code=code, display=display)]
    )


def _answers(answers):
    items = []
    for link_id, value in sorted((answers or {}).items()):
        values = value if isinstance(value, list) else [value]
        values = [str(v) for v in values if v not in (None, "")]
        if not values:
            continue
        items.append(
            QuestionnaireResponseItem(
                linkId=link_id,
                answer=[QuestionnaireResponseItemAnswer(valueString=v) for v in values],
            )
        )
    return items or None


def _actor(user):
    name = f"{user.first_name} {user.last_name}".strip() or user.email
    return Reference(reference=_urn("Practitioner", user.id), display=name)


def build_triage_bundle(triage_encounter):
    te = triage_encounter
    patient = te.patient
    patient_ref = _urn("Patient", patient.id)
    episode_ref = _urn("EpisodeOfCare", te.episode_id)
    encounter_ref = _urn("Encounter", te.encounter_id)
    resources = [(patient_ref, build_patient_resource(patient))]

    history = [
        EpisodeOfCareStatusHistory(
            status=h.status,
            period=Period(
                start=h.period_start.isoformat(),
                end=h.period_end.isoformat() if h.period_end else None,
            ),
        )
        for h in te.episode.status_history.all()
    ]
    resources.append(
        (
            episode_ref,
            EpisodeOfCare(
                id=str(te.episode_id),
                status=te.episode.status,
                statusHistory=history or None,
                patient=Reference(reference=patient_ref),
                period=Period(start=te.episode.period_start.isoformat()),
            ),
        )
    )
    resources.append(
        (
            encounter_ref,
            Encounter(
                id=str(te.encounter_id),
                status=_ENCOUNTER_STATUS.get(te.status, "unknown"),
                class_fhir=Coding(display="triage"),
                priority=_local("triage-priority", te.priority) if te.priority else None,
                subject=Reference(reference=patient_ref),
                episodeOfCare=[Reference(reference=episode_ref)],
                period=Period(start=te.arrival_at.isoformat()),
                reasonCode=(
                    [CodeableConcept(text=te.presenting_concern)] if te.presenting_concern else None
                ),
            ),
        )
    )

    for assessment in te.assessments.filter(status="COMPLETED"):
        qr_ref = _urn("QuestionnaireResponse", assessment.id)
        resources.append(
            (
                qr_ref,
                QuestionnaireResponse(
                    id=str(assessment.id),
                    status="completed",
                    subject=Reference(reference=patient_ref),
                    encounter=Reference(reference=encounter_ref),
                    authored=assessment.signed_at.isoformat(),
                    item=_answers(assessment.answers),
                ),
            )
        )
        notes = [assessment.recommendation_reasons]
        if assessment.decision == "OVERRIDE":
            notes.append(f"Override reason: {assessment.override_reason}")
        resources.append(
            (
                _urn("RiskAssessment", assessment.id),
                RiskAssessment(
                    id=str(assessment.id),
                    status="final",
                    subject=Reference(reference=patient_ref),
                    encounter=Reference(reference=encounter_ref),
                    occurrenceDateTime=assessment.signed_at.isoformat(),
                    basis=[Reference(reference=qr_ref)],
                    note=[Annotation(text=n) for n in notes if n],
                ),
            )
        )
        if assessment.signed_by:
            resources.append(
                (
                    _urn("Provenance", assessment.id),
                    Provenance(
                        id=f"prov-{assessment.id}",
                        target=[Reference(reference=qr_ref)],
                        recorded=assessment.signed_at.isoformat(),
                        agent=[ProvenanceAgent(who=_actor(assessment.signed_by))],
                    ),
                )
            )

    for alert in patient.clinical_alerts.filter(source_assessment__triage_encounter=te):
        resources.append(
            (
                _urn("Flag", alert.id),
                Flag(
                    id=str(alert.id),
                    status="active" if alert.status == "ACTIVE" else "inactive",
                    code=_local("clinical-alert", alert.alert_code, alert.label),
                    subject=Reference(reference=patient_ref),
                    encounter=Reference(reference=encounter_ref),
                    period=Period(start=alert.raised_at.isoformat()),
                ),
            )
        )
    for task in te.tasks.all():
        resources.append(
            (
                _urn("Task", task.id),
                Task(
                    id=str(task.id),
                    status=_TASK_STATUS[task.status],
                    intent="order",
                    code=_local("triage-action", task.action_code, task.action_label),
                    for_fhir=Reference(reference=patient_ref),
                    encounter=Reference(reference=encounter_ref),
                    authoredOn=task.created_at.isoformat(),
                    owner=Reference(display=task.owner),
                ),
            )
        )

    bundle = Bundle(
        type="collection",
        entry=[BundleEntry(fullUrl=url, resource=resource) for url, resource in resources],
    )
    return json.loads(bundle.json())


def _narrative(text):
    return Narrative(
        status="additional", div=f'<div xmlns="http://www.w3.org/1999/xhtml">{escape(text)}</div>'
    )


def _discharge_med_request(line, patient_ref, summary):
    from .services import concept_labels

    resource = build_medication_request_resource(line, patient_ref)
    # CONTINUE / CHANGE / NEW are live orders after discharge; STOP is not.
    resource.status = "stopped" if line.action == "STOP" else "active"
    resource.category = [
        _local(
            "discharge-medication-action",
            line.action,
            concept_labels().get(("discharge-medication-action", line.action)),
        )
    ]
    resource.authoredOn = summary.signed_at.isoformat()
    if line.note:
        resource.note = [Annotation(text=line.note)]
    return resource


def build_discharge_bundle(summary):
    """FHIR document Bundle for one SIGNED discharge summary (docs/17).

    Composition (discharge summary) + Patient + EpisodeOfCare + the IMP Encounter
    (`hospitalization.dischargeDisposition`, `period.end`) + coded Conditions +
    discharge MedicationRequests + Provenance. An amendment's Composition
    `relatesTo` (replaces) the version it supersedes; the original is untouched.

    VERIFY: Composition.type needs the LOINC discharge-summary document code
    (loinc.org) — carried as text only until confirmed; 57133-1 is the *referral
    note* code and must not be reused. VERIFY: national IG / profile and the
    disposition code system; the disposition is a local code until then.
    """
    from .services import concept_labels

    admission = summary.admission
    patient = summary.patient
    labels = concept_labels()
    patient_ref = _urn("Patient", patient.id)
    encounter_ref = _urn("Encounter", admission.id)
    composition_ref = _urn("Composition", summary.id)
    resources = [(patient_ref, build_patient_resource(patient))]

    episode = summary.episode
    episode_ref = None
    if episode:
        episode_ref = _urn("EpisodeOfCare", episode.id)
        resources.append(
            (
                episode_ref,
                EpisodeOfCare(
                    id=str(episode.id),
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
                    patient=Reference(reference=patient_ref),
                    period=Period(start=episode.period_start.isoformat()),
                ),
            )
        )

    encounter = build_encounter_resource(admission, patient_ref)
    encounter.status = "finished"
    encounter.period = Period(
        start=admission.admitted_at.isoformat(), end=summary.discharged_at.isoformat()
    )
    encounter.hospitalization = EncounterHospitalization(
        dischargeDisposition=_local(
            "discharge-disposition",
            summary.disposition,
            labels.get(("discharge-disposition", summary.disposition)),
        )
    )
    if episode_ref:
        encounter.episodeOfCare = [Reference(reference=episode_ref)]
    resources.append((encounter_ref, encounter))

    diagnosis_refs = []
    for diagnosis in summary.diagnoses.select_related("icd11_code"):
        ref = _urn("Condition", diagnosis.id)
        condition = build_condition_resource(diagnosis, patient_ref)
        condition.encounter = Reference(reference=encounter_ref)
        resources.append((ref, condition))
        diagnosis_refs.append(Reference(reference=ref))

    medication_refs = []
    for line in summary.medications.select_related("drug"):
        ref = _urn("MedicationRequest", line.id)
        resources.append((ref, _discharge_med_request(line, patient_ref, summary)))
        medication_refs.append(Reference(reference=ref))

    sections = [
        CompositionSection(
            title="Clinical status at discharge", text=_narrative(summary.clinical_status)
        ),
        CompositionSection(title="Treatment summary", text=_narrative(summary.treatment_summary)),
    ]
    if summary.legal_status_at_discharge:
        sections.append(
            CompositionSection(
                title="Legal status at discharge",
                text=_narrative(summary.legal_status_at_discharge),
            )
        )
    if diagnosis_refs:
        sections.append(CompositionSection(title="Diagnoses", entry=diagnosis_refs))
    if medication_refs:
        sections.append(CompositionSection(title="Discharge medications", entry=medication_refs))
    if summary.education:
        sections.append(
            CompositionSection(
                title="Education provided",
                text=_narrative(
                    "; ".join(labels.get(("discharge-education", c), c) for c in summary.education)
                ),
            )
        )

    author = _actor(summary.signed_by)
    composition = Composition(
        id=str(summary.id),
        status="amended" if summary.supersedes_id else "final",
        type=CodeableConcept(text="Discharge summary"),
        subject=Reference(reference=patient_ref),
        encounter=Reference(reference=encounter_ref),
        date=summary.signed_at.isoformat(),
        author=[author],
        title=f"Discharge summary (version {summary.version})",
        attester=[
            CompositionAttester(mode="legal", time=summary.signed_at.isoformat(), party=author)
        ],
        relatesTo=(
            [
                CompositionRelatesTo(
                    code="replaces",
                    targetReference=Reference(reference=_urn("Composition", summary.supersedes_id)),
                )
            ]
            if summary.supersedes_id
            else None
        ),
        section=sections,
    )
    provenance = Provenance(
        id=f"prov-{summary.id}",
        target=[Reference(reference=composition_ref)],
        recorded=summary.signed_at.isoformat(),
        agent=[
            ProvenanceAgent(
                who=author,
                role=[CodeableConcept(text=summary.signed_role)] if summary.signed_role else None,
            )
        ],
    )
    entries = [BundleEntry(fullUrl=composition_ref, resource=composition)]
    entries += [BundleEntry(fullUrl=url, resource=resource) for url, resource in resources]
    entries.append(BundleEntry(fullUrl=_urn("Provenance", summary.id), resource=provenance))
    bundle = Bundle(type="document", entry=entries)
    return json.loads(bundle.json())
