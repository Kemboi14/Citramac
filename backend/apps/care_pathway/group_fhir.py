"""
FHIR R4 view of one client's group-session entry — read-time, built from the
entry and the shared session facts (no second store). fhir.resources R4B models
(guide.md 2026-09-18 amendment), checked against base R4 4.0.1 and our profiles
in `fhir_profiles/` in tests, and by HL7's validator in CI.

Mapping (approved in group_programme.py; per-client export, owner 2026-11-12):

| Source | R4 resource | Profile |
|---|---|---|
| GroupSessionEntry | Encounter (subject = this client, appointment → the session, episodeOfCare) | citramac-group-session-entry |
| entry attendance + observation | Observation (value = `group-attendance` code, note = the observation) | citramac-group-session-attendance |
| GroupSession (shared facts) | Appointment — facilitator only as participant | base R4 |
| linked InterventionRecord (present only) | Procedure | base R4 |
| follow-up CareTask | Task | base R4 |
| risk disclosure alert | Flag | base R4 |
| confirmation, each correction | Provenance | base R4 |

Per-subject separation (guide.md §4): a client's export never names another
attendee. The cohort (FHIR Group) and the other participants' Encounters are not
in it, and the Appointment lists only the facilitator. Attendance is not mapped
to Appointment.participant.status, because R4 binds that to participationstatus
and "absent / excused" has no verified mapping (VERIFY, as in the model). It is
the Observation's coded value instead, and the Encounter is `finished` when the
client was present and `cancelled` otherwise.

Sensitivity: R + PSY on every resource except Patient (as the psychotherapy note,
psychotherapy_fhir.security_labels). Group entries are never sent to the SHR
(2026-10-23 amendment).

VERIFY: an Encounter.class code for a group session (display only); LOINC /
SNOMED CT codes for the attendance observation and the follow-up task (local
codes until confirmed); our canonical base (urn:citramac:).
"""

import json
import uuid
from datetime import datetime

from fhir.resources.R4B.annotation import Annotation
from fhir.resources.R4B.appointment import Appointment, AppointmentParticipant
from fhir.resources.R4B.bundle import Bundle, BundleEntry
from fhir.resources.R4B.codeableconcept import CodeableConcept
from fhir.resources.R4B.coding import Coding
from fhir.resources.R4B.encounter import Encounter, EncounterParticipant
from fhir.resources.R4B.flag import Flag
from fhir.resources.R4B.meta import Meta
from fhir.resources.R4B.observation import Observation
from fhir.resources.R4B.period import Period
from fhir.resources.R4B.procedure import Procedure, ProcedurePerformer
from fhir.resources.R4B.provenance import Provenance, ProvenanceAgent
from fhir.resources.R4B.reference import Reference
from fhir.resources.R4B.task import Task

from apps.dha_interop.fhir_mapper import build_patient_resource

from . import facility_time
from . import group_programme as gp
from .psychotherapy_fhir import CODESYSTEM_BASE, PROFILE_BASE, episode_resource, security_labels

ENTRY_PROFILE = f"{PROFILE_BASE}:group-session-entry"
ATTENDANCE_PROFILE = f"{PROFILE_BASE}:group-session-attendance"
ATTENDANCE_SYSTEM = f"{CODESYSTEM_BASE}:{gp.ATTENDANCE_VALUESET}"
ATTENDANCE_OBSERVATION_SYSTEM = f"{CODESYSTEM_BASE}:group-session-observation"
ATTENDANCE_OBSERVATION_CODE = "group-session-attendance"
_NAMESPACE = uuid.UUID("5c3a1f0e-2b7d-4c8e-9a61-7d0e4b2f8a35")
# CareTask.status → R4 Task.status (as the triage bundle, fhir._TASK_STATUS).
_TASK_STATUS = {"INITIATED": "requested", "PENDING": "in-progress", "COMPLETED": "completed"}


def _id(kind, pk):
    return str(uuid.uuid5(_NAMESPACE, f"{kind}:{pk}"))


def _ref(pk):
    return f"urn:uuid:{pk}"


def _meta(profile=None):
    return Meta(profile=[profile] if profile else None, security=security_labels())


def _local(system, code, display=None):
    return CodeableConcept(
        coding=[Coding(system=f"{CODESYSTEM_BASE}:{system}", code=code, display=display)]
    )


def _at(session, time):
    return facility_time.make_local_aware(datetime.combine(session.session_date, time)).isoformat()


def _period(session):
    return Period(start=_at(session, session.start_time), end=_at(session, session.end_time))


def _named(user, fallback):
    from .services import user_display

    return Reference(display=user_display(user) or fallback)


def build_group_entry_bundle(entry):
    """Collection Bundle for one client's entry in one confirmed group session."""
    from .services import concept_labels

    session = entry.session
    labels = concept_labels()
    patient_ref = _ref(entry.patient_id)
    episode_ref = _ref(entry.episode_id)
    encounter_ref = _ref(entry.pk)
    appointment_id = _id("appointment", session.pk)
    appointment_ref = _ref(appointment_id)
    facilitator = Reference(display=gp.facilitator_label(session))
    documented_by = _named(session.documented_by, "Staff member")
    category = _local("group-programme-category", session.category.code, gp.category_label(session))
    present = entry.attendance == gp.PRESENT

    resources = [
        (patient_ref, build_patient_resource(entry.patient)),
        (episode_ref, episode_resource(entry.episode, patient_ref)),
        (
            appointment_ref,
            Appointment(
                id=appointment_id,
                meta=_meta(),
                status="fulfilled",
                serviceType=[category],
                description=session.topic,
                start=_at(session, session.start_time),
                end=_at(session, session.end_time),
                comment=session.description,
                participant=[
                    AppointmentParticipant(
                        type=[CodeableConcept(text="Facilitator")],
                        actor=facilitator,
                        required="required",
                        status="accepted",
                    )
                ],
            ),
        ),
        (
            encounter_ref,
            Encounter(
                id=str(entry.pk),
                meta=_meta(ENTRY_PROFILE),
                status="finished" if present else "cancelled",
                class_fhir=Coding(display="group session"),
                type=[category],
                subject=Reference(reference=patient_ref),
                episodeOfCare=[Reference(reference=episode_ref)],
                appointment=[Reference(reference=appointment_ref)],
                participant=[
                    EncounterParticipant(
                        type=[CodeableConcept(text="Facilitator")], individual=facilitator
                    )
                ],
                period=_period(session),
            ),
        ),
    ]
    observation_id = _id("attendance", entry.pk)
    resources.append(
        (
            _ref(observation_id),
            Observation(
                id=observation_id,
                meta=_meta(ATTENDANCE_PROFILE),
                status="amended" if entry.version > 1 else "final",
                code=CodeableConcept(
                    coding=[
                        Coding(
                            system=ATTENDANCE_OBSERVATION_SYSTEM,
                            code=ATTENDANCE_OBSERVATION_CODE,
                            display="Group session attendance",
                        )
                    ]
                ),
                subject=Reference(reference=patient_ref),
                encounter=Reference(reference=encounter_ref),
                effectiveDateTime=_at(session, session.start_time),
                performer=[documented_by],
                valueCodeableConcept=CodeableConcept(
                    coding=[
                        Coding(
                            system=ATTENDANCE_SYSTEM,
                            code=entry.attendance,
                            display=labels.get((gp.ATTENDANCE_VALUESET, entry.attendance)),
                        )
                    ]
                ),
                # Only this client's own observation, and only when one was made.
                note=[Annotation(text=entry.observation)] if entry.observation.strip() else None,
            ),
        )
    )
    record = entry.intervention_record
    if present and record and not record.voided_at:
        resources.append(
            (
                _ref(_id("procedure", record.pk)),
                Procedure(
                    id=_id("procedure", record.pk),
                    meta=_meta(),
                    status="completed",
                    code=_local(
                        "intervention-module", gp.INTERVENTION_MODULE, gp.INTERVENTION_NAME
                    ),
                    subject=Reference(reference=patient_ref),
                    encounter=Reference(reference=encounter_ref),
                    performedDateTime=_at(session, session.start_time),
                    performer=[ProcedurePerformer(actor=facilitator)],
                ),
            )
        )
    task = entry.follow_up_task
    if task:
        resources.append(
            (
                _ref(_id("task", task.pk)),
                Task(
                    id=_id("task", task.pk),
                    meta=_meta(),
                    status=_TASK_STATUS.get(task.status, "requested"),
                    intent="order",
                    code=_local("care-task", gp.FOLLOW_UP_CODE, gp.FOLLOW_UP_LABEL),
                    for_fhir=Reference(reference=patient_ref),
                    encounter=Reference(reference=encounter_ref),
                    authoredOn=task.created_at.isoformat(),
                    requester=documented_by,
                    owner=Reference(display=task.owner) if task.owner else None,
                ),
            )
        )
    alert = entry.risk_alert
    if alert:
        resources.append(
            (
                _ref(_id("flag", alert.pk)),
                Flag(
                    id=_id("flag", alert.pk),
                    meta=_meta(),
                    status="active" if alert.status == "ACTIVE" else "inactive",
                    code=_local("clinical-alert", alert.alert_code, alert.label),
                    subject=Reference(reference=patient_ref),
                    encounter=Reference(reference=encounter_ref),
                    period=Period(
                        start=alert.raised_at.isoformat(),
                        end=alert.resolved_at.isoformat() if alert.resolved_at else None,
                    ),
                ),
            )
        )
    targets = [Reference(reference=url) for url, r in resources[3:]]
    provenances = [
        Provenance(
            id=_id("confirm", entry.pk),
            meta=_meta(),
            target=targets,
            recorded=session.confirmed_at.isoformat(),
            activity=CodeableConcept(text="Group session confirmed"),
            agent=[ProvenanceAgent(who=documented_by)],
        )
    ]
    for index, item in enumerate(entry.audit or []):
        provenances.append(
            Provenance(
                id=_id(f"correct-{index}", entry.pk),
                meta=_meta(),
                target=[
                    Reference(reference=encounter_ref),
                    Reference(reference=_ref(observation_id)),
                ],
                recorded=item["at"],
                activity=CodeableConcept(text="Group session entry corrected"),
                reason=[CodeableConcept(text=item.get("reason") or "Correction")],
                agent=[ProvenanceAgent(who=Reference(display=item.get("by") or "Staff member"))],
            )
        )
    entries = [BundleEntry(fullUrl=url, resource=r) for url, r in resources]
    entries += [BundleEntry(fullUrl=_ref(p.id), resource=p) for p in provenances]
    bundle = Bundle(
        id=_id("bundle", entry.pk),
        meta=Meta(security=security_labels()),
        type="collection",
        entry=entries,
    )
    return json.loads(bundle.json())
