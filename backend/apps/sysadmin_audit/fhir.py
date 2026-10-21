"""
FHIR R4 AuditEvent — CLAUDE.md §4 "AuditEvent on every access to a
psychiatric record".

One store, many views: the append-only AuditLogEntry trail stays the only
record of who touched what. AuditEvent is built from it on read and never
stored a second time. Only entries about a client's record are mapped
(apps.retention.registry decides what the record is); log-ins and other
platform events have no patient to hang off.

Codes come from the R4 4.0.1 value sets at hl7.org/fhir/R4: type DICOM 110110
"Patient Record" (audit-event-type), action (audit-event-action, required),
outcome 0 "Success" (audit-event-outcome, required — every row in the trail
is a write or read that happened), entity.type audit-entity-type, entity.role
object-role 1 "Patient", agent.network.type network-type 2 "IP Address".
The internal action rides in `subtype` under a local code system, following
care_pathway/fhir.py's `urn:citramac:codesystem:<id>` convention.
VERIFY: our canonical base URL for local CodeSystems (the same open item as
care_pathway/fhir.py).

`field_diff` is never emitted: it can hold clinical content, and an audit
view must not become a back door to the record.

Built with fhir.resources.R4B per the 2026-09-18 exception; validated against
the vendored R4 4.0.1 schema in tests.
"""

import json

from django.conf import settings
from django.db.models import CharField, Q
from django.db.models.functions import Cast
from fhir.resources.R4B.auditevent import (
    AuditEvent,
    AuditEventAgent,
    AuditEventAgentNetwork,
    AuditEventEntity,
    AuditEventSource,
)
from fhir.resources.R4B.bundle import Bundle, BundleEntry, BundleEntrySearch
from fhir.resources.R4B.codeableconcept import CodeableConcept
from fhir.resources.R4B.coding import Coding
from fhir.resources.R4B.reference import Reference

from apps.dha_interop.fhir_mapper import _urn
from apps.dha_interop.fhir_patient import CONFIDENTIALITY_SYSTEM
from apps.retention.registry import MENTAL_HEALTH_MODELS, PATIENT_PATHS, patient_models

from .models import AuditLogEntry

DICOM_SYSTEM = "http://dicom.nema.org/resources/ontology/DCM"
AUDIT_ENTITY_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/audit-entity-type"
OBJECT_ROLE_SYSTEM = "http://terminology.hl7.org/CodeSystem/object-role"
LOCAL_ACTION_SYSTEM = "urn:citramac:codesystem:audit-action"

# audit-event-action: C Create, R Read/View/Print, U Update, D Delete, E Execute.
_ACTION = {
    AuditLogEntry.ACTION_CREATE: "C",
    AuditLogEntry.ACTION_VIEW: "R",
    AuditLogEntry.ACTION_EXPORT: "R",
    AuditLogEntry.ACTION_UPDATE: "U",
    AuditLogEntry.ACTION_ARCHIVE: "U",
    AuditLogEntry.ACTION_RESTORE: "U",
    AuditLogEntry.ACTION_LEGAL_HOLD: "U",
    AuditLogEntry.ACTION_DELETE: "D",
    AuditLogEntry.ACTION_ERASURE: "D",
}

_LABELS = {label.lower(): label for label in PATIENT_PATHS}
_SENSITIVE = {label.lower() for label in MENTAL_HEALTH_MODELS}


def patient_audit_entries(patient):
    """Every trail row about any part of this client's record, newest first.

    Rows are matched by (model, object_id) against each registered model's
    rows for the patient, including soft-deleted ones — a deleted note's
    audit history is still the patient's.
    """
    match = Q(pk__in=[])
    for model, path in patient_models():
        label = model._meta.label_lower
        if not path:
            match |= Q(model=label, object_id=str(patient.pk))
            continue
        keys = (
            model._base_manager.filter(**{path: patient})
            .annotate(audit_key=Cast("pk", output_field=CharField()))
            .values("audit_key")
        )
        match |= Q(model=label, object_id__in=keys)
    return AuditLogEntry.objects.filter(match, organization_id=patient.organization_id)


def build_audit_event(entry, patient, actor_name=None, organization_name=None):
    """One AuditEvent for one trail row about `patient`'s record."""
    patient_ref = Reference(reference=_urn("Patient", patient.pk))
    patient_entity = AuditEventEntity(
        what=patient_ref,
        type=Coding(system=AUDIT_ENTITY_TYPE_SYSTEM, code="1", display="Person"),
        role=Coding(system=OBJECT_ROLE_SYSTEM, code="1", display="Patient"),
    )
    entities = [patient_entity]
    if entry.model != "client_registry.patient":
        label = _LABELS.get(entry.model, entry.model)
        security = None
        if entry.model in _SENSITIVE:
            security = [
                Coding(system=CONFIDENTIALITY_SYSTEM, code=settings.FHIR_PSYCH_CONFIDENTIALITY_CODE)
            ]
        entities.append(
            AuditEventEntity(
                what=Reference(display=f"{label} {entry.object_id}"),
                type=Coding(system=AUDIT_ENTITY_TYPE_SYSTEM, code="2", display="System Object"),
                securityLabel=security,
            )
        )
    elif entry.model in _SENSITIVE:
        patient_entity.securityLabel = [
            Coding(system=CONFIDENTIALITY_SYSTEM, code=settings.FHIR_PSYCH_CONFIDENTIALITY_CODE)
        ]

    agent = AuditEventAgent(
        who=(
            Reference(reference=_urn("Practitioner", entry.actor_user_id), display=actor_name)
            if entry.actor_user_id
            else Reference(display="System")
        ),
        role=[CodeableConcept(text=entry.actor_role)] if entry.actor_role else None,
        requestor=entry.actor_user_id is not None,
        network=(
            AuditEventAgentNetwork(address=entry.source_ip, type="2") if entry.source_ip else None
        ),
    )
    event = AuditEvent(
        id=str(entry.pk),
        type=Coding(system=DICOM_SYSTEM, code="110110", display="Patient Record"),
        subtype=[
            Coding(
                system=LOCAL_ACTION_SYSTEM,
                code=entry.action,
                display=entry.get_action_display(),
            )
        ],
        action=_ACTION.get(entry.action, "E"),
        recorded=entry.timestamp.isoformat(),
        outcome="0",
        agent=[agent],
        source=AuditEventSource(
            site=organization_name or None,
            observer=Reference(display="CITRAMAC HMIS"),
        ),
        entity=entities,
    )
    return event


def build_audit_event_bundle(patient, entries, total, actor_names, organization_name):
    """A searchset Bundle of AuditEvents for one page of a patient's trail."""
    bundle = Bundle(
        type="searchset",
        total=total,
        entry=[
            BundleEntry(
                fullUrl=_urn("AuditEvent", entry.pk),
                resource=build_audit_event(
                    entry,
                    patient,
                    actor_names.get(str(entry.actor_user_id)),
                    organization_name,
                ),
                search=BundleEntrySearch(mode="match"),
            )
            for entry in entries
        ]
        or None,
    )
    return json.loads(bundle.json())
