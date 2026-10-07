"""
Business logic for the care pathway — docs/15-CLINICAL-WORKSPACE-V3.md.
Views stay thin; every state change on a clinical record happens here,
inside a transaction.
"""

import re
from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.client_registry.models import AllergyRecord, Appointment, EmergencyContact, Patient
from apps.clinical_encounter.models import DiagnosisCode, Encounter
from apps.ipd_ward.models import Admission, MedicationAdministration
from apps.triage.models import VitalSigns

from . import triage_rules
from .models import (
    PRIORITY_ORDER,
    CarePlan,
    CareTask,
    ChargeItem,
    ClinicalAlert,
    EpisodeOfCare,
    EpisodeStatusHistory,
    IntakeAssessment,
    InterventionRecord,
    LocalConcept,
    TriageAssessment,
    TriageEncounter,
    TriageRecheck,
)

CURRENT_ADMISSION_STATUSES = ("ADMITTED", "TRANSFERRED")
PRIORITY_LABELS = {"RED": "Emergency", "ORANGE": "Urgent", "YELLOW": "Priority", "GREEN": "Routine"}
EFFECTIVE_STATUS_LABELS = {
    "AWAITING": "Awaiting triage",
    "IN_TRIAGE": "In triage",
    "COMPLETED": "Triage completed",
    "RECHECK_COMPLETED": "Re-check completed",
    "RECHECK_DUE": "Re-check due",
}


def concept_labels():
    """(valueset id, code) → display, for every active served concept."""
    return {
        (valueset_id, code): display
        for valueset_id, code, display in LocalConcept.objects.filter(active=True).values_list(
            "valueset_id", "code", "display"
        )
    }


def user_display(user):
    if not user:
        return ""
    return f"{user.first_name} {user.last_name}".strip() or user.email


# ── Episode ──


def open_episode_for(patient):
    return (
        EpisodeOfCare.objects.filter(patient=patient, status__in=EpisodeOfCare.OPEN_STATUSES)
        .order_by("-period_start")
        .first()
    )


def current_or_latest_episode(patient):
    return open_episode_for(patient) or (
        EpisodeOfCare.objects.filter(patient=patient).order_by("-period_start").first()
    )


def get_or_open_episode(patient, user, presenting=""):
    episode = open_episode_for(patient)
    if episode:
        return episode
    now = timezone.now()
    episode = EpisodeOfCare.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        status="waitlist",
        period_start=now,
        presenting_problems=presenting,
        created_by=user,
    )
    EpisodeStatusHistory.objects.create(
        organization_id=patient.organization_id,
        episode=episode,
        status="waitlist",
        period_start=now,
        changed_by=user,
    )
    return episode


def current_admission(patient):
    return (
        Admission.objects.filter(patient=patient, status__in=CURRENT_ADMISSION_STATUSES)
        .select_related("bed__ward", "consultant")
        .order_by("-admitted_at")
        .first()
    )


def latest_signed_triage(patient):
    return (
        TriageEncounter.objects.filter(patient=patient, triage_version__gt=0)
        .order_by("-last_triaged_at")
        .first()
    )


# ── Registration (doc 15 §1.4) ──


def _split_name(full_name):
    parts = full_name.split()
    if not parts:
        return "", "", ""
    if len(parts) == 1:
        return parts[0], "", ""
    return parts[0], " ".join(parts[1:-1]), parts[-1]


def _allergy_items(text):
    return [item.strip() for item in re.split(r"[;,]", text or "") if item.strip()]


def _record_allergies(patient, items, user, source, verification):
    existing = {
        record.substance.lower(): record for record in AllergyRecord.objects.filter(patient=patient)
    }
    for item in items:
        record = existing.get(item.lower())
        if record is None:
            AllergyRecord.objects.create(
                organization_id=patient.organization_id,
                patient=patient,
                substance=item,
                source=source,
                verification_status=verification,
                recorded_by=user,
            )
        elif verification == "CONFIRMED" and record.verification_status != "CONFIRMED":
            record.verification_status = "CONFIRMED"
            record.save(update_fields=["verification_status", "updated_at"])


@transaction.atomic
def register_arrival(user, data):
    """Create or update the client, then open a NEW triage encounter — it never
    reopens an earlier one (doc 15 §1.4). Idempotent on `client_request_id`."""
    from apps.client_registry.views import _generate_citramac_number

    request_id = (data.get("client_request_id") or "").strip()
    if not request_id:
        raise ValidationError({"client_request_id": "Required."})
    existing_request = TriageEncounter.objects.filter(client_request_id=request_id).first()
    if existing_request:
        return existing_request

    identity = data.get("identity_status") or Patient.IDENTITY_IDENTIFIED
    if identity not in dict(Patient.IDENTITY_STATUS_CHOICES):
        raise ValidationError({"identity_status": "Unknown identity status."})
    full_name = (data.get("full_name") or "").strip()
    description = (data.get("description") or "").strip()
    if identity == Patient.IDENTITY_IDENTIFIED and not full_name:
        raise ValidationError(
            {
                "full_name": "Enter the client’s full name, or change Identity status to "
                "Unidentified or Unknown to register without one."
            }
        )
    if identity == Patient.IDENTITY_UNIDENTIFIED and not description:
        raise ValidationError(
            {
                "description": "Add a brief description or reported temporary alias so this "
                "unidentified arrival can be distinguished safely."
            }
        )

    patient = None
    if data.get("patient_id"):
        patient = Patient.objects.filter(pk=data["patient_id"], archived_at__isnull=True).first()
        if patient is None:
            raise ValidationError({"patient_id": "Client not found."})

    now = timezone.now()
    if patient is None:
        patient = Patient(
            organization=user.organization,
            registered_by=user,
            registered_at=now,
            citramac_number=_generate_citramac_number(user.organization),
            identity_status=identity,
        )

    if identity == Patient.IDENTITY_IDENTIFIED:
        if patient.pk and patient.identity_status != Patient.IDENTITY_IDENTIFIED:
            patient.identity_confirmed_at = now
        patient.first_name, patient.middle_other_names, patient.last_name = _split_name(full_name)
    patient.identity_status = identity
    if description:
        patient.identity_description = description

    def take(field, key=None):
        value = data.get(key or field)
        if value not in (None, ""):
            setattr(patient, field, value)

    take("preferred_name")
    take("pronouns")
    take("date_of_birth")
    take("estimated_age")
    take("gender", "sex")
    take("contact_phone", "phone")
    take("address")
    take("id_document_type")
    take("id_document_number")
    take("preferred_language")
    take("interpreter")
    take("payer")
    if data.get("id_document_number"):
        if data.get("id_document_type") == "NATIONAL_ID":
            patient.national_id = data["id_document_number"]
        elif data.get("id_document_type") == "PASSPORT":
            patient.passport_number = data["id_document_number"]
    referral = (data.get("referral_source") or "").strip() or "Self-presented"
    if not patient.referral_source:
        patient.referral_source = referral

    allergy_status = data.get("allergy_status") or "UNKNOWN"
    if allergy_status in ("NONE", "ACTIVE_ALLERGIES"):
        patient.allergy_status = allergy_status
    patient.save()

    if allergy_status == "ACTIVE_ALLERGIES":
        _record_allergies(
            patient,
            _allergy_items(data.get("allergy_details")) or ["Client reports an allergy"],
            user,
            "REGISTRATION",
            "UNCONFIRMED",
        )

    next_of_kin = (data.get("next_of_kin") or "").strip()
    if next_of_kin and (patient.next_of_kin is None or patient.next_of_kin.name != next_of_kin):
        contact = EmergencyContact.objects.create(
            organization_id=patient.organization_id,
            patient=patient,
            name=next_of_kin,
            relationship="Next of kin / emergency contact",
        )
        patient.next_of_kin = contact
        patient.save(update_fields=["next_of_kin", "updated_at"])

    reason = (data.get("reason") or "").strip()
    episode = get_or_open_episode(patient, user, presenting=reason)
    encounter = Encounter.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        episode=episode,
        opened_by=user,
        encounter_type="TRIAGE",
        status="OPEN",
        opened_at=now,
    )
    visit_number = TriageEncounter.objects.filter(patient=patient).count() + 1
    return TriageEncounter.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        episode=episode,
        encounter=encounter,
        client_request_id=request_id,
        visit_number=visit_number,
        arrival_at=now,
        due_at=triage_rules.triage_due_at(now),
        presenting_concern=reason,
        referral_source=referral,
        registered_by=user,
    )


@transaction.atomic
def resolve_identity(user, patient, data):
    """Confirm a temporary record's identity in place (doc 15 §1.4). Unlike a
    registration submit, this does not open a new triage encounter."""
    full_name = (data.get("full_name") or "").strip()
    if not full_name:
        raise ValidationError({"full_name": "Enter the client’s full name."})
    patient.first_name, patient.middle_other_names, patient.last_name = _split_name(full_name)
    patient.identity_status = Patient.IDENTITY_IDENTIFIED
    patient.identity_confirmed_at = timezone.now()
    for field, key in (
        ("date_of_birth", "date_of_birth"),
        ("gender", "sex"),
        ("contact_phone", "phone"),
        ("id_document_type", "id_document_type"),
        ("id_document_number", "id_document_number"),
    ):
        if data.get(key):
            setattr(patient, field, data[key])
    patient.save()
    return patient


# ── Triage (doc 15 §1.6) ──


def start_triage(triage_encounter, user):
    """Opening an encounter marks it In triage and stamps the start time."""
    changed = []
    if triage_encounter.status == TriageEncounter.STATUS_AWAITING:
        triage_encounter.status = TriageEncounter.STATUS_IN_TRIAGE
        changed.append("status")
    if not triage_encounter.triage_started_at:
        triage_encounter.triage_started_at = timezone.now()
        triage_encounter.triage_started_by = user
        changed += ["triage_started_at", "triage_started_by"]
    if changed:
        triage_encounter.save(update_fields=changed + ["updated_at"])
    return triage_encounter


def current_triage_draft(triage_encounter):
    return triage_encounter.assessments.filter(status="IN_PROGRESS").first()


@transaction.atomic
def save_triage_draft(triage_encounter, user, answers):
    if triage_encounter.status not in (
        TriageEncounter.STATUS_AWAITING,
        TriageEncounter.STATUS_IN_TRIAGE,
    ):
        raise ValidationError({"detail": "This triage is not open for editing."})
    start_triage(triage_encounter, user)
    draft = current_triage_draft(triage_encounter)
    if draft is None:
        draft = TriageAssessment(
            organization_id=triage_encounter.organization_id,
            triage_encounter=triage_encounter,
            version=triage_encounter.triage_version + 1,
            author=user,
        )
    draft.answers = answers or {}
    draft.draft_saved_at = timezone.now()
    draft.save()
    return draft


def _record_vitals(encounter, user, *, bp=None, systolic=None, diastolic=None, **values):
    if bp:
        systolic, diastolic = triage_rules.parse_blood_pressure(bp)
    fields = {
        "systolic_bp": systolic,
        "diastolic_bp": diastolic,
        "heart_rate": triage_rules._number(values.get("pulse")),
        "respiratory_rate": triage_rules._number(values.get("rr")),
        "spo2": triage_rules._number(values.get("spo2")),
        "temperature_c": triage_rules._number(values.get("temp"), Decimal),
        "blood_glucose_mmol": triage_rules._number(values.get("glucose"), Decimal),
    }
    fields = {key: value for key, value in fields.items() if value is not None}
    if not fields:
        return None
    return VitalSigns.objects.create(
        organization_id=encounter.organization_id,
        encounter=encounter,
        recorded_by=user,
        **fields,
    )


@transaction.atomic
def sign_triage(triage_encounter, user, payload):
    answers = payload.get("answers") or {}
    merged = {**triage_rules.DEFAULT_ANSWERS, **answers}
    missing_keys = [key for key, _ in triage_rules.CORE_SCREENS if not merged.get(key)]
    missing = [name for key, name in triage_rules.CORE_SCREENS if key in missing_keys]
    final_priority = payload.get("final_priority") or ""
    decision = payload.get("decision") or "CONFIRM"
    override_reason = (payload.get("override_reason") or "").strip()
    if missing or final_priority not in PRIORITY_ORDER:
        raise ValidationError(
            {
                "detail": "Complete the required safety screens and select a final priority "
                "before signing.",
                "missing": missing,
                "missing_keys": missing_keys,
            }
        )
    if decision == "OVERRIDE" and not override_reason:
        raise ValidationError({"override_reason": "A reason is required to override."})
    if triage_encounter.status not in (
        TriageEncounter.STATUS_AWAITING,
        TriageEncounter.STATUS_IN_TRIAGE,
    ):
        raise ValidationError({"detail": "This triage has already been signed."})

    result = triage_rules.evaluate(answers, concept_labels())
    now = timezone.now()
    assessment = save_triage_draft(triage_encounter, user, answers)
    assessment.findings = result["findings"]
    assessment.alerts = result["alerts"]
    assessment.recommendation = result["recommendation"]
    assessment.recommendation_reasons = result["reasons"]
    assessment.final_priority = final_priority
    assessment.decision = decision
    assessment.override_reason = override_reason if decision == "OVERRIDE" else ""
    assessment.rules_version = triage_rules.RULES_VERSION
    assessment.tasks_snapshot = list(
        triage_encounter.tasks.values("action_label", "owner", "status", "created_at")
    )
    for task in assessment.tasks_snapshot:
        task["created_at"] = task["created_at"].isoformat()
    assessment.signed_at = now
    assessment.signed_by = user
    assessment.status = "COMPLETED"
    assessment.save()

    patient = triage_encounter.patient
    triage_encounter.priority = final_priority
    concern = (answers.get("c_concern") or "").strip()
    if concern:
        triage_encounter.presenting_concern = concern
    triage_encounter.triage_version += 1
    triage_encounter.status = TriageEncounter.STATUS_COMPLETED
    triage_encounter.last_triaged_at = now
    triage_encounter.last_triaged_by = user
    triage_encounter.next_recheck_at = triage_rules.recheck_due_after(final_priority, now)
    triage_encounter.save()

    encounter = triage_encounter.encounter
    if encounter.status != "CLOSED":
        encounter.status = "CLOSED"
        encounter.closed_at = now
        encounter.save(update_fields=["status", "closed_at", "updated_at"])

    active_codes = set(
        ClinicalAlert.objects.filter(patient=patient, status="ACTIVE").values_list(
            "alert_code", flat=True
        )
    )
    for alert in result["alerts"]:
        if alert["code"] not in active_codes:
            ClinicalAlert.objects.create(
                organization_id=patient.organization_id,
                patient=patient,
                alert_code=alert["code"],
                label=alert["label"],
                source_assessment=assessment,
                raised_at=now,
                raised_by=user,
            )

    _record_vitals(
        encounter,
        user,
        bp=answers.get("h_bp"),
        pulse=answers.get("h_pulse"),
        rr=answers.get("h_rr"),
        temp=answers.get("h_temp"),
        spo2=answers.get("h_spo2"),
        glucose=answers.get("h_glucose"),
    )

    allergy_status = answers.get("a_allergy_status")
    if allergy_status == "none":
        patient.allergy_status = "NONE"
        patient.save(update_fields=["allergy_status", "updated_at"])
    elif allergy_status == "known":
        patient.allergy_status = "ACTIVE_ALLERGIES"
        patient.save(update_fields=["allergy_status", "updated_at"])
        _record_allergies(
            patient, _allergy_items(answers.get("a_allergy_detail")), user, "TRIAGE", "CONFIRMED"
        )
    elif allergy_status == "unknown":
        patient.allergy_status = "UNKNOWN"
        patient.save(update_fields=["allergy_status", "updated_at"])
    return assessment


def request_full_retriage(triage_encounter):
    triage_encounter.status = TriageEncounter.STATUS_IN_TRIAGE
    triage_encounter.full_retriage_requested_at = timezone.now()
    triage_encounter.save(update_fields=["status", "full_retriage_requested_at", "updated_at"])
    return triage_encounter


# ── Re-check (doc 15 §1.7) ──

RECHECK_VITAL_KEYS = {
    "heartRate": "pulse",
    "respiratoryRate": "rr",
    "temperature": "temp",
    "oxygenSaturation": "spo2",
    "bloodGlucose": "glucose",
}


def current_recheck_draft(triage_encounter):
    return triage_encounter.rechecks.filter(status="IN_PROGRESS").first()


@transaction.atomic
def save_recheck_draft(triage_encounter, user, data):
    draft = current_recheck_draft(triage_encounter) or TriageRecheck(
        organization_id=triage_encounter.organization_id,
        triage_encounter=triage_encounter,
        version=triage_encounter.rechecks.filter(status="COMPLETED").count() + 1,
        author=user,
    )
    draft.change_since_last_check = data.get("change_since_last_check") or ""
    draft.distress_behaviour = data.get("distress_behaviour") or ""
    draft.observations = data.get("observations") or {}
    draft.note = (data.get("note") or "").strip()
    draft.draft_saved_at = timezone.now()
    draft.save()
    return draft


@transaction.atomic
def sign_recheck(triage_encounter, user, data):
    if triage_encounter.effective_status != "RECHECK_DUE":
        raise ValidationError({"detail": "No re-check is due for this encounter."})
    if not data.get("change_since_last_check"):
        raise ValidationError({"change_since_last_check": "Required."})
    observations = data.get("observations") or {}
    measured = {}
    for key, entry in observations.items():
        entry = entry or {}
        if entry.get("status") == "MEASURED":
            if entry.get("value") in (None, ""):
                raise ValidationError({key: "Enter the measured value, or change its status."})
            measured[key] = entry["value"]
    recheck = save_recheck_draft(triage_encounter, user, data)
    now = timezone.now()
    recheck.status = "COMPLETED"
    recheck.signed_at = now
    recheck.signed_by = user
    recheck.save()

    _record_vitals(
        triage_encounter.encounter,
        user,
        systolic=triage_rules._number(measured.get("bloodPressureSystolic")),
        diastolic=triage_rules._number(measured.get("bloodPressureDiastolic")),
        **{
            short: measured.get(long)
            for long, short in RECHECK_VITAL_KEYS.items()
            if measured.get(long) is not None
        },
    )
    triage_encounter.status = TriageEncounter.STATUS_RECHECK_COMPLETED
    triage_encounter.next_recheck_at = triage_rules.recheck_due_after(
        triage_encounter.priority, now
    )
    triage_encounter.save(update_fields=["status", "next_recheck_at", "updated_at"])
    return recheck


# ── Psychiatry (doc 15 §1.8) ──


@transaction.atomic
def open_psychiatry_review(triage_encounter, user):
    if triage_encounter.triage_version == 0:
        raise ValidationError(
            {
                "detail": "A signed triage record is required before opening the Psychiatry "
                "workflow."
            }
        )
    if triage_encounter.psychiatry_encounter is None:
        now = timezone.now()
        triage_encounter.psychiatry_encounter = Encounter.objects.create(
            organization_id=triage_encounter.organization_id,
            patient=triage_encounter.patient,
            episode=triage_encounter.episode,
            opened_by=user,
            encounter_type="PSYCHIATRY",
            status="IN_PROGRESS",
            opened_at=now,
        )
        triage_encounter.psychiatry_review_started_at = now
        triage_encounter.save(
            update_fields=["psychiatry_encounter", "psychiatry_review_started_at", "updated_at"]
        )
        triage_encounter.episode.transition("active", user=user, at=now)
    return triage_encounter


def clinical_encounter_for(patient, episode, user):
    """The encounter intake/MSE work hangs off: the psychiatry review encounter
    when one is open, otherwise a new INTAKE encounter in the same episode."""
    signed = latest_signed_triage(patient)
    if signed and signed.psychiatry_encounter_id:
        return signed.psychiatry_encounter
    return Encounter.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        episode=episode,
        opened_by=user,
        encounter_type="INTAKE",
        status="IN_PROGRESS",
    )


def psychiatry_queue():
    latest = {}
    for te in (
        TriageEncounter.objects.filter(
            triage_version__gt=0,
            episode__status__in=EpisodeOfCare.OPEN_STATUSES,
            patient__archived_at__isnull=True,
        )
        .select_related("patient", "last_triaged_by")
        .order_by("last_triaged_at")
    ):
        latest[te.patient_id] = te
    return sorted(
        latest.values(),
        key=lambda te: (
            PRIORITY_ORDER.get(te.priority, 9),
            -(te.last_triaged_at.timestamp() if te.last_triaged_at else 0),
        ),
    )


# ── Worklist & banner ──


def triage_worklist():
    now = timezone.now()
    rows = (
        TriageEncounter.objects.filter(patient__archived_at__isnull=True)
        .filter(
            Q(status__in=(TriageEncounter.STATUS_AWAITING, TriageEncounter.STATUS_IN_TRIAGE))
            | Q(
                status__in=(
                    TriageEncounter.STATUS_COMPLETED,
                    TriageEncounter.STATUS_RECHECK_COMPLETED,
                ),
                next_recheck_at__lte=now,
                psychiatry_review_started_at__isnull=True,
            )
        )
        .select_related("patient", "last_triaged_by")
    )
    items = []
    for te in rows:
        status = te.effective_status
        is_recheck = status == "RECHECK_DUE"
        due = te.next_recheck_at if is_recheck else te.due_at
        items.append(
            {
                "te": te,
                "status": status,
                "due_at": due,
                "is_overdue": (not is_recheck) and due < now,
                "wait_minutes": max(0, int((now - te.arrival_at).total_seconds() // 60)),
            }
        )
    items.sort(key=lambda item: (not item["is_overdue"], item["due_at"]))
    return items


def setting_for(patient, admission=None, triage_encounter=None):
    admission = admission if admission is not None else current_admission(patient)
    if admission:
        return {
            "type": "INPATIENT",
            "ward": admission.bed.ward.name,
            "bed": admission.bed.bed_number,
            "status": admission.get_status_display(),
        }
    status = ""
    if triage_encounter and triage_encounter.psychiatry_review_started_at is None:
        status = EFFECTIVE_STATUS_LABELS.get(triage_encounter.effective_status, "")
    else:
        episode = current_or_latest_episode(patient)
        status = episode.get_status_display() if episode else "Active"
    return {"type": "OUTPATIENT", "ward": None, "bed": None, "status": status}


def allergy_banner(patient):
    if patient.allergy_status == "NONE":
        return {"state": "none", "items": []}
    if patient.allergy_status == "ACTIVE_ALLERGIES":
        records = AllergyRecord.objects.filter(patient=patient).exclude(
            verification_status="REFUTED"
        )
        return {
            "state": "known",
            "items": [
                {
                    "substance": r.substance,
                    "reaction": r.reaction,
                    "verification_status": r.verification_status,
                }
                for r in records
                if r.substance != "Client reports an allergy"
            ],
        }
    return {"state": "unknown", "items": []}


def banner_for(patient):
    admission = current_admission(patient)
    latest_te = TriageEncounter.objects.filter(patient=patient).order_by("-arrival_at").first()
    signed = latest_signed_triage(patient)
    episode = current_or_latest_episode(patient)
    clinician = patient.doctor or (admission.consultant if admission else None)
    team = (admission.primary_care_team if admission else "") or (
        user_display(episode.care_manager) if episode and episode.care_manager else ""
    )
    return {
        "patient_id": str(patient.id),
        "name": patient.get_full_name(),
        "preferred_name": patient.preferred_name,
        "identity_status": patient.identity_status,
        "identity_label": (
            patient.get_identity_status_display()
            if patient.identity_status != Patient.IDENTITY_IDENTIFIED
            else ""
        ),
        "identity_description": patient.identity_description,
        "citramac_number": patient.citramac_number,
        "mrn": patient.uhid_number,
        "age": patient.age_years,
        "sex": patient.gender,
        "date_of_birth": patient.date_of_birth.isoformat() if patient.date_of_birth else None,
        "payer": patient.get_payer_display() if patient.payer else "",
        "phone": patient.contact_phone,
        "next_of_kin": patient.next_of_kin.name if patient.next_of_kin else "",
        "referral_source": patient.referral_source,
        "allergy": allergy_banner(patient),
        "setting": setting_for(patient, admission, latest_te),
        "priority": signed.priority if signed else "",
        "alerts": [
            {"id": str(a.id), "code": a.alert_code, "label": a.label}
            for a in ClinicalAlert.objects.filter(patient=patient, status="ACTIVE")
        ],
        "clinician": user_display(clinician) or "Unassigned",
        "team": team,
        "episode_id": str(episode.id) if episode else None,
        "latest_triage_encounter_id": str(latest_te.id) if latest_te else None,
        "latest_signed_triage_encounter_id": str(signed.id) if signed else None,
        "psychiatry_encounter_id": (
            str(signed.psychiatry_encounter_id)
            if signed and signed.psychiatry_encounter_id
            else None
        ),
    }


# ── Care plan, interventions, billing ──

ALERT_SUGGESTIONS = {
    "SUICIDE_RISK": (
        "Safety plan / enhanced observation",
        "Mitigate documented suicide risk",
        "ASSESSMENT",
        "a Safety Plan intervention",
    ),
    "WITHDRAWAL_RISK": (
        "Detox / withdrawal management",
        "Safe management of withdrawal (monitored)",
        "ASSESSMENT",
        "a Withdrawal-risk assessment",
    ),
    "AGGRESSION_RISK": (
        "Violence / risk assessment",
        "Manage documented risk of harm to others",
        "PSYCHIATRY",
        "a violence / risk assessment",
    ),
    "SAFEGUARDING": (
        "Safeguarding intervention",
        "Address documented safeguarding concern",
        "NURSING",
        "a safeguarding intervention",
    ),
    "ABNORMAL_VITALS": (
        "Urgent medical review",
        "Review abnormal vital signs",
        "NURSING",
        "an urgent medical review",
    ),
    "ALTERED_CONSCIOUSNESS": (
        "Urgent medical review",
        "Review altered consciousness",
        "NURSING",
        "an urgent medical review",
    ),
}


def get_or_create_care_plan(patient, user):
    episode = current_or_latest_episode(patient) or get_or_open_episode(patient, user)
    plan, _ = CarePlan.objects.get_or_create(
        episode=episode,
        defaults={"organization_id": patient.organization_id, "patient": patient},
    )
    return plan


def care_plan_suggestions(patient, plan):
    alerts = list(ClinicalAlert.objects.filter(patient=patient, status="ACTIVE"))
    existing = {title.lower() for title in plan.activities.values_list("title", flat=True)}
    suggestions, phrases, seen = [], [], set()
    for alert in alerts:
        suggestion = ALERT_SUGGESTIONS.get(alert.alert_code)
        if not suggestion or suggestion[0] in seen:
            continue
        seen.add(suggestion[0])
        phrases.append(suggestion[3])
        if suggestion[0].lower() not in existing:
            suggestions.append(
                {"title": suggestion[0], "goal": suggestion[1], "module": suggestion[2]}
            )
    recommendation = ""
    if phrases:
        documented = ", ".join(a.label.lower() for a in alerts)
        recommendation = (
            f"Based on the documented {documented}, the system recommends "
            f"{' and '.join(phrases)}. The clinician accepts, modifies, or declines."
        )
    return {"recommendation": recommendation, "suggestions": suggestions}


@transaction.atomic
def record_intervention(user, activity, data):
    record = InterventionRecord.objects.create(
        organization_id=activity.organization_id,
        patient=activity.care_plan.patient,
        activity=activity,
        performed_at=data.get("performed_at") or timezone.now(),
        provider=data.get("provider") or user,
        intervention=data["intervention"],
        response=data.get("response", ""),
        next_action=data.get("next_action", ""),
        billable=bool(data.get("billable")),
        billing_service=data.get("billing_service"),
        quantity=data.get("quantity") or 1,
    )
    if record.billable and record.billing_service:
        ChargeItem.objects.create(
            organization_id=record.organization_id,
            patient=record.patient,
            episode=activity.care_plan.episode,
            service=record.billing_service,
            quantity=record.quantity,
            unit_price=record.billing_service.rate,
            delivered_at=record.performed_at,
            intervention=record,
            created_by=user,
        )
    return record


def billing_overview(patient=None):
    """Billing events with claim/payment allocation, exactly as doc 15 §1.15:
    claim value is allocated oldest-first up to the submitted claim total;
    payments settle claimed balances first, then unbilled ones."""
    from apps.billing.models import Payment
    from apps.insurance_claims.models import InsuranceClaim

    charges = ChargeItem.objects.select_related("service", "patient").order_by("delivered_at")
    if patient is not None:
        charges = charges.filter(patient=patient)
    unpriced = sorted({c.service.name for c in charges if c.unit_price is None})
    by_patient = {}
    for charge in charges:
        if charge.unit_price is None:
            continue
        by_patient.setdefault(charge.patient_id, []).append(charge)

    events = []
    for patient_id, patient_charges in by_patient.items():
        client = patient_charges[0].patient
        claims = InsuranceClaim.objects.filter(patient_id=patient_id).exclude(status="DRAFT")
        claim_budget = sum((c.total_claimed_amount for c in claims), Decimal("0"))
        payment_budget = sum(
            (p.amount for p in Payment.objects.filter(invoice__patient_id=patient_id)),
            Decimal("0"),
        )
        rows = []
        for charge in patient_charges:
            amount = charge.unit_price * charge.quantity
            claimed = min(amount, claim_budget)
            claim_budget -= claimed
            rows.append(
                {
                    "charge": charge,
                    "amount": amount,
                    "claimed": claimed,
                    "unbilled": amount - claimed,
                    "paid_claimed": Decimal("0"),
                    "paid_unbilled": Decimal("0"),
                }
            )
        for row in rows:
            if row["claimed"] > 0:
                row["paid_claimed"] = min(row["claimed"], payment_budget)
                payment_budget -= row["paid_claimed"]
        for row in rows:
            if row["unbilled"] > 0:
                row["paid_unbilled"] = min(row["unbilled"], payment_budget)
                payment_budget -= row["paid_unbilled"]
        for row in rows:
            paid = row["paid_claimed"] + row["paid_unbilled"]
            if row["amount"] - paid <= 0:
                status = "paid"
            elif paid > 0:
                status = "partial"
            elif row["claimed"] > 0 and row["unbilled"] > 0:
                status = "partial-claim"
            elif row["claimed"] > 0:
                status = "claimed"
            else:
                status = "unbilled"
            charge = row["charge"]
            events.append(
                {
                    "id": str(charge.id),
                    "client_id": str(client.id),
                    "client_name": client.preferred_name or client.get_full_name(),
                    "client_number": client.citramac_number,
                    "service": charge.service.name,
                    "payer": client.get_payer_display() if client.payer else "Not recorded",
                    "delivered_at": charge.delivered_at.isoformat(),
                    "quantity": charge.quantity,
                    "amount": str(row["amount"]),
                    "paid_amount": str(paid),
                    "claimed_balance": str(max(Decimal("0"), row["claimed"] - row["paid_claimed"])),
                    "unbilled_balance": str(
                        max(Decimal("0"), row["unbilled"] - row["paid_unbilled"])
                    ),
                    "status": status,
                }
            )
    events.sort(key=lambda e: e["delivered_at"], reverse=True)
    total = sum((Decimal(e["amount"]) for e in events), Decimal("0"))
    return {
        "summary": {
            "services": {"amount": str(total), "count": len(events)},
            "unbilled": {
                "amount": str(sum((Decimal(e["unbilled_balance"]) for e in events), Decimal("0"))),
                "count": sum(1 for e in events if Decimal(e["unbilled_balance"]) > 0),
            },
            "claimed": {
                "amount": str(sum((Decimal(e["claimed_balance"]) for e in events), Decimal("0"))),
                "count": sum(1 for e in events if Decimal(e["claimed_balance"]) > 0),
            },
            "paid": {
                "amount": str(sum((Decimal(e["paid_amount"]) for e in events), Decimal("0"))),
                "count": sum(1 for e in events if e["status"] == "paid"),
            },
        },
        "events": events,
        "unpriced_services": unpriced,
        "currency": "KES",
    }


# ── Timeline & activity ──


def episode_summary(patient):
    """Current (or latest) episode with its status history and the waiting time
    — waitlist start to first active (CLAUDE.md §4: unrecoverable later)."""
    episode = current_or_latest_episode(patient)
    if episode is None:
        return None
    history = list(episode.status_history.select_related("changed_by"))
    waitlist = next((h for h in history if h.status == "waitlist"), None)
    active = next((h for h in history if h.status == "active"), None)
    waited = None
    if waitlist and active:
        waited = int((active.period_start - waitlist.period_start).total_seconds() // 60)
    return {
        "id": str(episode.id),
        "status": episode.status,
        "status_label": episode.get_status_display(),
        "period_start": episode.period_start.isoformat(),
        "period_end": episode.period_end.isoformat() if episode.period_end else None,
        "care_manager": user_display(episode.care_manager),
        "waiting_minutes": waited,
        "still_waiting": waitlist is not None and active is None and episode.status == "waitlist",
        "history": [
            {
                "status": h.status,
                "status_label": h.get_status_display(),
                "period_start": h.period_start.isoformat(),
                "period_end": h.period_end.isoformat() if h.period_end else None,
                "changed_by": user_display(h.changed_by),
            }
            for h in history
        ],
    }


def client_timeline(patient):
    events = [
        {
            "at": patient.registered_at,
            "kind": "registration",
            "title": "Registration completed",
            "detail": user_display(patient.registered_by) or "Front Desk",
        }
    ]
    for te in TriageEncounter.objects.filter(patient=patient):
        events.append(
            {
                "at": te.arrival_at,
                "kind": "arrival",
                "title": f"{'Visit ' + str(te.visit_number)} — sent to triage",
                "detail": te.presenting_concern or "Reason not yet recorded",
            }
        )
    for a in TriageAssessment.objects.filter(
        triage_encounter__patient=patient, status="COMPLETED"
    ).select_related("signed_by"):
        events.append(
            {
                "at": a.signed_at,
                "kind": "triage",
                "title": "Triage completed",
                "detail": f"Priority: {a.final_priority} — {user_display(a.signed_by)}",
            }
        )
    for r in TriageRecheck.objects.filter(
        triage_encounter__patient=patient, status="COMPLETED"
    ).select_related("signed_by"):
        events.append(
            {
                "at": r.signed_at,
                "kind": "recheck",
                "title": f"Triage re-check v{r.version}",
                "detail": f"{r.get_status_display()} — {user_display(r.signed_by)}",
            }
        )
    for v in VitalSigns.objects.filter(encounter__patient=patient):
        parts = [
            v.heart_rate and f"HR {v.heart_rate}",
            v.systolic_bp and f"BP {v.systolic_bp}/{v.diastolic_bp or '—'}",
            v.temperature_c and f"Temp {v.temperature_c}°C",
            v.spo2 and f"SpO2 {v.spo2}%",
        ]
        events.append(
            {
                "at": v.recorded_at,
                "kind": "vitals",
                "title": "Vitals recorded",
                "detail": " · ".join(p for p in parts if p),
            }
        )
    for alert in ClinicalAlert.objects.filter(patient=patient):
        events.append(
            {
                "at": alert.raised_at,
                "kind": "alert",
                "title": "Risk flag identified",
                "detail": alert.label,
            }
        )
    for adm in Admission.objects.filter(patient=patient).select_related("bed__ward"):
        events.append(
            {
                "at": adm.admitted_at,
                "kind": "admission",
                "title": "Inpatient admission",
                "detail": f"{adm.get_admission_type_display()} · {adm.bed.ward.name}, "
                f"Bed {adm.bed.bed_number}",
            }
        )
        if adm.discharged_at:
            events.append(
                {
                    "at": adm.discharged_at,
                    "kind": "discharge",
                    "title": "Discharged",
                    "detail": adm.discharge_summary[:140] or "Discharge recorded",
                }
            )
    for intake in IntakeAssessment.objects.filter(patient=patient).select_related("author"):
        events.append(
            {
                "at": intake.created_at,
                "kind": "intake",
                "title": "Intake & clinical assessment saved",
                "detail": user_display(intake.author),
            }
        )
    for record in InterventionRecord.objects.filter(patient=patient).select_related("provider"):
        events.append(
            {
                "at": record.performed_at,
                "kind": "intervention",
                "title": record.intervention,
                "detail": (
                    f"{user_display(record.provider)} — "
                    f"{record.response or 'No response noted'}"
                ),
            }
        )
    for d in DiagnosisCode.objects.filter(encounter__patient=patient).select_related("icd11_code"):
        events.append(
            {
                "at": d.noted_at,
                "kind": "diagnosis",
                "title": "Diagnosis recorded",
                "detail": f"{d.icd11_code_id} — {d.icd11_code.description}",
            }
        )
    for appt in Appointment.objects.filter(patient=patient):
        events.append(
            {
                "at": appt.scheduled_for,
                "kind": "appointment",
                "title": appt.appointment_type or "Appointment",
                "detail": appt.get_status_display(),
            }
        )
    from apps.client_registry.models import ConsentRecord

    for history in EpisodeStatusHistory.objects.filter(episode__patient=patient).select_related(
        "changed_by"
    ):
        events.append(
            {
                "at": history.period_start,
                "kind": "episode",
                "title": f"Episode of care — {history.get_status_display()}",
                "detail": user_display(history.changed_by) or "System",
            }
        )
    for consent in ConsentRecord.objects.filter(patient=patient).select_related("captured_by"):
        events.append(
            {
                "at": consent.captured_at,
                "kind": "consent",
                "title": (
                    "Data-sharing consent granted"
                    if consent.granted
                    else "Data-sharing consent declined / withdrawn"
                ),
                "detail": f"Wording {consent.consent_text_version} — "
                f"{user_display(consent.captured_by)}",
            }
        )
    for task in CareTask.objects.filter(patient=patient).select_related("created_by"):
        events.append(
            {
                "at": task.created_at,
                "kind": "task",
                "title": f"Task registered — {task.action_label}",
                "detail": f"{task.owner} · {task.get_status_display()}",
            }
        )
    for alert in ClinicalAlert.objects.filter(patient=patient, resolved_at__isnull=False):
        events.append(
            {
                "at": alert.resolved_at,
                "kind": "alert",
                "title": "Alert resolved",
                "detail": f"{alert.label} — {user_display(alert.resolved_by)}",
            }
        )
    events = [e for e in events if e["at"]]
    events.sort(key=lambda e: e["at"], reverse=True)
    for event in events:
        event["at"] = event["at"].isoformat()
    return events


def recent_activity(limit=4):
    events = []
    for adm in Admission.objects.select_related("patient", "bed__ward").order_by("-admitted_at")[
        :limit
    ]:
        priority = adm.clinical_priority or adm.get_priority_display()
        events.append(
            {
                "at": adm.admitted_at,
                "title": f"New inpatient admission — {adm.patient.get_full_name()}",
                "detail": f"{priority} admission, Bed {adm.bed.bed_number}, {adm.bed.ward.name}",
            }
        )
    for a in (
        TriageAssessment.objects.filter(status="COMPLETED")
        .select_related("triage_encounter__patient")
        .order_by("-signed_at")[:limit]
    ):
        patient = a.triage_encounter.patient
        setting = "Inpatient care" if current_admission(patient) else "Outpatient care"
        events.append(
            {
                "at": a.signed_at,
                "title": f"Triage completed — {patient.get_full_name()}",
                "detail": f"Priority: {a.final_priority}, {setting}",
            }
        )
    for adm in (
        Admission.objects.filter(discharged_at__isnull=False)
        .select_related("patient")
        .order_by("-discharged_at")[:limit]
    ):
        follow = (
            f"follow-up {adm.follow_up_date:%Y-%m-%d}" if adm.follow_up_date else "no follow-up set"
        )
        events.append(
            {
                "at": adm.discharged_at,
                "title": f"Discharge summary signed — {adm.patient.get_full_name()}",
                "detail": f"Episode closed, {follow}",
            }
        )
    for mar in (
        MedicationAdministration.objects.filter(status="ADMINISTERED")
        .select_related("admission__patient", "prescription_item__drug")
        .order_by("-administered_at")[:limit]
    ):
        drug = ""
        if mar.prescription_item:
            drug = f"{mar.prescription_item.drug.generic_name} {mar.prescription_item.dose}, "
        events.append(
            {
                "at": mar.administered_at,
                "title": f"Medication administered — {mar.admission.patient.get_full_name()}",
                "detail": f"{drug}{mar.scheduled_time:%H:%M} dose",
            }
        )
    events = [e for e in events if e["at"]]
    events.sort(key=lambda e: e["at"], reverse=True)
    events = events[:limit]
    for event in events:
        event["at"] = event["at"].isoformat()
    return events
