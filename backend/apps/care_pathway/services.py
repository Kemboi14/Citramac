"""
Business logic for the care pathway — docs/15-CLINICAL-WORKSPACE-V3.md.
Views stay thin; every state change on a clinical record happens here,
inside a transaction.
"""

import re
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from apps.client_registry.models import AllergyRecord, Appointment, EmergencyContact, Patient
from apps.clinical_encounter.models import DiagnosisCode, Encounter, PrescriptionItem
from apps.dha_interop.models import NationalDrugIndex
from apps.ipd_ward.models import Admission, MedicationAdministration
from apps.triage.models import VitalSigns

from . import triage_rules
from .models import (
    PRIORITY_ORDER,
    BillingService,
    CarePlan,
    CareTask,
    ChargeItem,
    ClinicalAlert,
    DischargeMedicationLine,
    DischargeSummary,
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
            # Disposition only: the narrative is confidential to the care team
            # and the timeline is visible more widely.
            signed = (
                DischargeSummary.objects.filter(admission=adm, status="COMPLETED")
                .order_by("-version")
                .first()
            )
            detail = "Discharge recorded"
            if signed:
                detail = concept_labels().get(
                    ("discharge-disposition", signed.disposition), "Discharge signed"
                )
            events.append(
                {
                    "at": adm.discharged_at,
                    "kind": "discharge",
                    "title": "Discharged",
                    "detail": detail,
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
    for summary in (
        DischargeSummary.objects.filter(status="COMPLETED", signed_at__isnull=False)
        .select_related("patient", "follow_up_appointment")
        .order_by("-signed_at")[:limit]
    ):
        follow = (
            f"follow-up {summary.follow_up_appointment.scheduled_for:%Y-%m-%d}"
            if summary.follow_up_appointment_id
            else "no follow-up booked"
        )
        events.append(
            {
                "at": summary.signed_at,
                "title": f"Discharge summary signed — {summary.patient.get_full_name()}",
                "detail": f"Version {summary.version}, {follow}",
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


# ── Follow-up (docs/17-DISCHARGE-AND-FOLLOW-UP.md) ──

FOLLOW_UP_BUCKETS = ("upcoming", "overdue", "missed", "unbooked")
MISSED_WINDOW_DAYS = 90
UNBOOKED_WINDOW_DAYS = 30


class StateConflict(APIException):
    """409 — the record is not in a state that allows the request."""

    status_code = 409
    default_detail = "This record is not in a state that allows that."
    default_code = "conflict"


def _valid_codes(valueset_id):
    return set(
        LocalConcept.objects.filter(valueset_id=valueset_id, active=True).values_list(
            "code", flat=True
        )
    )


def book_follow_up(user, patient, data, *, episode=None, admission=None, origin="MANUAL"):
    """Book a follow-up appointment. Idempotent on `client_request_id`: a retried
    request returns the appointment already created instead of double-booking."""
    request_id = str(data.get("client_request_id") or "").strip()
    if request_id:
        existing = Appointment.objects.filter(client_request_id=request_id).first()
        if existing:
            if existing.patient_id != patient.id:
                raise StateConflict("That request id was already used for a different client.")
            return existing
    reason = data.get("reason") or ""
    if reason not in _valid_codes("follow-up-reason"):
        raise ValidationError({"reason": "Choose a follow-up reason from the list."})
    scheduled_for = data.get("scheduled_for")
    if not scheduled_for:
        raise ValidationError({"scheduled_for": "Choose a date and time."})
    if isinstance(scheduled_for, str):
        from django.utils.dateparse import parse_datetime

        parsed = parse_datetime(scheduled_for)
        if parsed is None:
            raise ValidationError({"scheduled_for": "Enter a valid date and time."})
        scheduled_for = parsed
    if timezone.is_naive(scheduled_for):
        scheduled_for = timezone.make_aware(scheduled_for)
    provider = None
    if data.get("provider"):
        from apps.accounts.models import User

        provider = User.objects.filter(pk=data["provider"]).first()
        if provider is None:
            raise ValidationError({"provider": "That clinician was not found."})
    mode = data.get("mode") or "IN_PERSON"
    if mode not in dict(Appointment.MODE_CHOICES):
        raise ValidationError({"mode": "Choose in person, phone or video."})
    if episode is None:
        episode = open_episode_for(patient)
    label = concept_labels().get(("follow-up-reason", reason), reason)
    return Appointment.objects.create(
        organization_id=user.organization_id,
        patient=patient,
        provider=provider,
        scheduled_for=scheduled_for,
        duration_minutes=int(data.get("duration_minutes") or 30),
        location=data.get("location") or "",
        mode=mode,
        appointment_type=label,
        notes=data.get("notes") or "",
        episode=episode,
        admission=admission,
        reason=reason,
        origin=origin,
        booked_by=user,
        client_request_id=request_id,
    )


def _patient_ref(patient):
    return {
        "patient_id": str(patient.id),
        "patient_name": patient.get_full_name(),
        "citramac_number": patient.citramac_number,
    }


def _follow_up_row(appointment, labels):
    return {
        "kind": "appointment",
        "id": str(appointment.id),
        **_patient_ref(appointment.patient),
        "scheduled_for": appointment.scheduled_for.isoformat(),
        "reason": appointment.reason,
        "reason_label": labels.get(("follow-up-reason", appointment.reason), appointment.reason),
        "status": appointment.status,
        "provider_name": appointment.provider.get_full_name() if appointment.provider_id else "",
        "origin": appointment.origin,
        "admission_id": str(appointment.admission_id) if appointment.admission_id else None,
        "episode_id": str(appointment.episode_id) if appointment.episode_id else None,
    }


def _unbooked_discharges(now):
    """Recently discharged clients with no live appointment on or after discharge."""
    later = Appointment.objects.filter(
        patient=OuterRef("patient"), scheduled_for__gte=OuterRef("discharged_at")
    ).exclude(status="CANCELLED")
    linked = Appointment.objects.filter(admission=OuterRef("pk")).exclude(status="CANCELLED")
    admissions = list(
        Admission.objects.filter(
            status="DISCHARGED",
            discharged_at__isnull=False,
            discharged_at__gte=now - timedelta(days=UNBOOKED_WINDOW_DAYS),
        )
        .annotate(has_later=Exists(later), has_linked=Exists(linked))
        .filter(has_later=False, has_linked=False)
        .select_related("patient")
        .order_by("discharged_at")
    )
    # No follow-up is expected after a death.
    deceased = set(
        DischargeSummary.objects.filter(
            admission__in=admissions, status="COMPLETED", disposition="DECEASED"
        ).values_list("admission_id", flat=True)
    )
    return [a for a in admissions if a.id not in deceased]


def follow_up_overview(bucket="upcoming", now=None):
    """Counts for every bucket plus the rows of the requested one. A follow-up is
    an appointment with a reason, or one booked from a discharge / the care plan."""
    now = now or timezone.now()
    follow_ups = Appointment.objects.filter(
        Q(origin__in=("DISCHARGE", "CARE_PLAN")) | ~Q(reason="")
    ).select_related("patient", "provider")
    querysets = {
        "upcoming": follow_ups.filter(status="SCHEDULED", scheduled_for__gte=now).order_by(
            "scheduled_for"
        ),
        "overdue": follow_ups.filter(status="SCHEDULED", scheduled_for__lt=now).order_by(
            "scheduled_for"
        ),
        "missed": follow_ups.filter(
            status="NO_SHOW",
            scheduled_for__gte=now - timedelta(days=MISSED_WINDOW_DAYS),
        ).order_by("-scheduled_for"),
    }
    unbooked = _unbooked_discharges(now)
    counts = {name: queryset.count() for name, queryset in querysets.items()}
    counts["unbooked"] = len(unbooked)
    labels = concept_labels()
    if bucket == "unbooked":
        results = [
            {
                "kind": "unbooked",
                "id": str(adm.id),
                **_patient_ref(adm.patient),
                "discharged_at": adm.discharged_at.isoformat(),
                "days_since_discharge": (now - adm.discharged_at).days,
                "admission_id": str(adm.id),
                "episode_id": str(adm.episode_id) if adm.episode_id else None,
            }
            for adm in unbooked
        ]
    else:
        results = [_follow_up_row(a, labels) for a in querysets[bucket][:200]]
    return {"bucket": bucket, "counts": counts, "results": results}


# ── Discharge planning (docs/17-DISCHARGE-AND-FOLLOW-UP.md) ──

DISCHARGE_NARRATIVE_FIELDS = ("clinical_status", "treatment_summary", "legal_status_at_discharge")


def latest_discharge(admission):
    return DischargeSummary.objects.filter(admission=admission).order_by("-version").first()


def _role_label(user):
    if user.is_superuser:
        return "Super Admin"
    return ", ".join(sorted(user.roles.values_list("name", flat=True)))


def can_view_discharge_in_full(user, admission, summary=None):
    """Discharge content is psychiatric: full access for the care team, Org Admin,
    the admitting consultant and whoever wrote or signed this summary."""
    from apps.mhp_program.permissions import has_full_mhp_access

    if has_full_mhp_access(user, admission.patient):
        return True
    if admission.consultant_id == user.id:
        return True
    return bool(summary and user.id in (summary.author_id, summary.signed_by_id))


def discharge_context(admission):
    """What the discharge form pre-fills from the existing record."""
    diagnoses, medications = [], []
    if admission.encounter_id:
        diagnoses = [
            {
                "id": str(d.id),
                "code": d.icd11_code_id,
                "description": d.icd11_code.description,
                "is_primary": d.is_primary,
            }
            for d in DiagnosisCode.objects.filter(encounter_id=admission.encounter_id)
            .select_related("icd11_code")
            .order_by("-is_primary", "-noted_at")
        ]
        latest_mar = {}
        for mar in MedicationAdministration.objects.filter(
            admission=admission, prescription_item__isnull=False
        ).order_by("scheduled_time"):
            latest_mar[mar.prescription_item_id] = mar.status
        medications = [
            {
                "prescription_item": str(item.id),
                "drug": item.drug_id,
                "drug_name": item.drug.generic_name,
                "dose": item.dose,
                "route": item.route,
                "frequency": item.frequency,
                "duration": item.duration,
                "last_mar_status": latest_mar.get(item.id, ""),
            }
            for item in PrescriptionItem.objects.filter(
                prescription__encounter_id=admission.encounter_id
            ).select_related("drug")
        ]
    return {
        "diagnoses": diagnoses,
        "medications": medications,
        "involuntary": admission.admission_type == "INVOLUNTARY",
        "legal_status": admission.legal_status,
        "legal_order_reference": admission.legal_order_reference,
    }


def serialize_discharge(summary, full):
    labels = concept_labels()
    data = {
        "id": str(summary.id),
        "admission_id": str(summary.admission_id),
        "version": summary.version,
        "supersedes": str(summary.supersedes_id) if summary.supersedes_id else None,
        "status": summary.status,
        "disposition": summary.disposition,
        "disposition_label": labels.get(("discharge-disposition", summary.disposition), ""),
        "discharged_at": summary.discharged_at.isoformat() if summary.discharged_at else None,
        "signed_at": summary.signed_at.isoformat() if summary.signed_at else None,
        "signed_by_name": user_display(summary.signed_by),
        "signed_role": summary.signed_role,
        "draft_saved_at": summary.draft_saved_at.isoformat() if summary.draft_saved_at else None,
        "restricted": not full,
    }
    if not full:
        return data
    follow_up = summary.follow_up_appointment
    data.update(
        {
            "destination": summary.destination,
            "clinical_status": summary.clinical_status,
            "treatment_summary": summary.treatment_summary,
            "legal_status_at_discharge": summary.legal_status_at_discharge,
            "education": summary.education,
            "diagnoses": [
                {
                    "id": str(d.id),
                    "code": d.icd11_code_id,
                    "description": d.icd11_code.description,
                    "is_primary": d.is_primary,
                }
                for d in summary.diagnoses.select_related("icd11_code")
            ],
            "medications": [
                {
                    "prescription_item": (
                        str(m.prescription_item_id) if m.prescription_item_id else None
                    ),
                    "drug": m.drug_id,
                    "drug_name": m.drug.generic_name,
                    "dose": m.dose,
                    "route": m.route,
                    "frequency": m.frequency,
                    "duration": m.duration,
                    "action": m.action,
                    "action_label": labels.get(("discharge-medication-action", m.action), m.action),
                    "note": m.note,
                }
                for m in summary.medications.select_related("drug")
            ],
            "follow_up": (
                {
                    "id": str(follow_up.id),
                    "scheduled_for": follow_up.scheduled_for.isoformat(),
                    "reason": follow_up.reason,
                    "reason_label": labels.get(("follow-up-reason", follow_up.reason), ""),
                    "status": follow_up.status,
                }
                if follow_up
                else None
            ),
        }
    )
    return data


def discharge_worklist():
    """Current inpatients (with their draft state) and clients discharged in the
    last 30 days (with their signed summary)."""
    now = timezone.now()
    current = []
    for adm in (
        Admission.objects.filter(status__in=CURRENT_ADMISSION_STATUSES)
        .select_related("patient", "bed__ward")
        .order_by("admitted_at")
    ):
        draft = latest_discharge(adm)
        current.append(
            {
                "admission_id": str(adm.id),
                **_patient_ref(adm.patient),
                "bed_label": f"{adm.bed.ward.name} · Bed {adm.bed.bed_number}",
                "admission_type": adm.admission_type,
                "admitted_at": adm.admitted_at.isoformat(),
                "days_in": (now - adm.admitted_at).days,
                "state": "DRAFT" if draft else "NOT_STARTED",
                "draft_saved_at": (
                    draft.draft_saved_at.isoformat() if draft and draft.draft_saved_at else None
                ),
            }
        )
    labels = concept_labels()
    recent = []
    for adm in (
        Admission.objects.filter(
            status="DISCHARGED",
            discharged_at__gte=now - timedelta(days=UNBOOKED_WINDOW_DAYS),
        )
        .select_related("patient", "bed__ward")
        .order_by("-discharged_at")
    ):
        latest = latest_discharge(adm)
        recent.append(
            {
                "admission_id": str(adm.id),
                **_patient_ref(adm.patient),
                "bed_label": f"{adm.bed.ward.name} · Bed {adm.bed.bed_number}",
                "discharged_at": adm.discharged_at.isoformat(),
                "summary_id": str(latest.id) if latest else None,
                "version": latest.version if latest else None,
                "status": latest.status if latest else "LEGACY",
                "disposition_label": (
                    labels.get(("discharge-disposition", latest.disposition), "") if latest else ""
                ),
            }
        )
    return {"current": current, "recent": recent}


def _check_codes(data):
    """Reject codes that are not in the served value sets."""
    errors = {}
    disposition = data.get("disposition")
    if disposition and disposition not in _valid_codes("discharge-disposition"):
        errors["disposition"] = "Choose a disposition from the list."
    bad_education = set(data.get("education") or []) - _valid_codes("discharge-education")
    if bad_education:
        errors["education"] = "Unknown education item."
    actions = _valid_codes("discharge-medication-action")
    for index, line in enumerate(data.get("medications") or []):
        if line.get("action") not in actions:
            errors[f"medications.{index}.action"] = "Choose continue, stop, change or new."
    if errors:
        raise ValidationError(errors)


def _apply_discharge_fields(summary, admission, data):
    from django.utils.dateparse import parse_datetime

    for field in ("destination", *DISCHARGE_NARRATIVE_FIELDS):
        if field in data:
            setattr(summary, field, str(data[field] or "").strip())
    if "disposition" in data:
        summary.disposition = data["disposition"] or ""
    if "education" in data:
        summary.education = list(data["education"] or [])
    if data.get("discharged_at"):
        moment = data["discharged_at"]
        if isinstance(moment, str):
            moment = parse_datetime(moment)
        if moment is None:
            raise ValidationError({"discharged_at": "Enter a valid date and time."})
        if timezone.is_naive(moment):
            moment = timezone.make_aware(moment)
        if moment < admission.admitted_at:
            raise ValidationError({"discharged_at": "Discharge cannot be before admission."})
        summary.discharged_at = moment
    summary.draft_saved_at = timezone.now()
    summary.save()
    if "diagnoses" in data:
        ids = list(data["diagnoses"] or [])
        diagnoses = list(
            DiagnosisCode.objects.filter(pk__in=ids, encounter_id=admission.encounter_id)
        )
        if len(diagnoses) != len(set(ids)):
            raise ValidationError(
                {"diagnoses": "Diagnoses must be ones recorded on this admission's encounter."}
            )
        summary.diagnoses.set(diagnoses)
    if "medications" in data:
        summary.medications.all().delete()
        for line in data["medications"] or []:
            drug = NationalDrugIndex.objects.filter(pk=line.get("drug")).first()
            if drug is None:
                raise ValidationError({"medications": "A medication line names an unknown drug."})
            DischargeMedicationLine.objects.create(
                organization_id=summary.organization_id,
                summary=summary,
                prescription_item_id=line.get("prescription_item") or None,
                drug=drug,
                dose=line.get("dose") or "",
                route=line.get("route") or "",
                frequency=line.get("frequency") or "",
                duration=line.get("duration") or "",
                action=line["action"],
                note=line.get("note") or "",
            )


def _open_draft(admission, user):
    """The draft being edited, started from scratch for a current admission only."""
    draft = DischargeSummary.objects.filter(admission=admission, status="IN_PROGRESS").first()
    if draft:
        return draft
    if admission.status not in CURRENT_ADMISSION_STATUSES:
        raise StateConflict(
            "This client is already discharged. Amend the signed summary to correct it."
        )
    previous = latest_discharge(admission)
    return DischargeSummary.objects.create(
        organization_id=admission.organization_id,
        admission=admission,
        patient=admission.patient,
        episode=admission.episode,
        encounter=admission.encounter,
        version=(previous.version + 1) if previous else 1,
        author=user,
    )


def save_discharge_draft(admission, user, data):
    with transaction.atomic():
        admission = Admission.objects.select_for_update().get(pk=admission.pk)
        _check_codes(data)
        summary = _open_draft(admission, user)
        if summary.author_id is None:
            summary.author = user
        _apply_discharge_fields(summary, admission, data)
        return summary


def amend_discharge(summary, user):
    """Start a new version of a signed summary. The signed row is never edited."""
    with transaction.atomic():
        admission = Admission.objects.select_for_update().get(pk=summary.admission_id)
        latest = latest_discharge(admission)
        if summary.status != "COMPLETED":
            raise StateConflict("Only a signed discharge summary can be amended.")
        if latest.id != summary.id:
            raise StateConflict("A newer version already exists; amend that one instead.")
        draft = DischargeSummary.objects.create(
            organization_id=summary.organization_id,
            admission=admission,
            patient=summary.patient,
            episode=summary.episode,
            encounter=summary.encounter,
            version=summary.version + 1,
            supersedes=summary,
            disposition=summary.disposition,
            destination=summary.destination,
            discharged_at=summary.discharged_at,
            clinical_status=summary.clinical_status,
            treatment_summary=summary.treatment_summary,
            legal_status_at_discharge=summary.legal_status_at_discharge,
            education=summary.education,
            follow_up_appointment=summary.follow_up_appointment,
            author=user,
            draft_saved_at=timezone.now(),
        )
        draft.diagnoses.set(summary.diagnoses.all())
        for line in summary.medications.all():
            DischargeMedicationLine.objects.create(
                organization_id=summary.organization_id,
                summary=draft,
                prescription_item=line.prescription_item,
                drug=line.drug,
                dose=line.dose,
                route=line.route,
                frequency=line.frequency,
                duration=line.duration,
                action=line.action,
                note=line.note,
            )
        return draft


def sign_discharge(admission, user, data=None):
    """Sign the discharge and, for the first signed version, discharge the client:
    admission closed, bed freed, encounter closed, charge recorded and any
    follow-up booked — all in one transaction. The episode is left open: outpatient
    follow-up normally continues inside it, and closing it is a separate step."""
    data = data or {}
    follow_up = data.get("follow_up")
    with transaction.atomic():
        admission = (
            Admission.objects.select_for_update(of=("self",))
            .select_related("patient", "bed", "encounter")
            .get(pk=admission.pk)
        )
        _check_codes(data)
        draft = DischargeSummary.objects.filter(admission=admission, status="IN_PROGRESS").first()
        amending = bool(draft and draft.supersedes_id)
        if draft is None and admission.status not in CURRENT_ADMISSION_STATUSES:
            raise StateConflict("This client is already discharged. Amend the signed summary.")
        if not amending and admission.status not in CURRENT_ADMISSION_STATUSES:
            raise StateConflict("This client is already discharged.")
        summary = draft or _open_draft(admission, user)
        _apply_discharge_fields(summary, admission, data)

        problems = {}
        if not summary.disposition:
            problems["disposition"] = "Choose a discharge disposition."
        if not summary.clinical_status.strip():
            problems["clinical_status"] = "Describe the clinical status at discharge."
        if not summary.treatment_summary.strip():
            problems["treatment_summary"] = "Summarise the treatment given."
        if (
            admission.admission_type == "INVOLUNTARY"
            and not summary.legal_status_at_discharge.strip()
        ):
            problems["legal_status_at_discharge"] = (
                "State what became of the legal order before discharging an involuntary admission."
            )
        if problems:
            raise ValidationError(problems)

        now = timezone.now()
        discharged_at = summary.discharged_at or now
        summary.discharged_at = discharged_at
        summary.status = "COMPLETED"
        summary.signed_at = now
        summary.signed_by = user
        summary.signed_role = _role_label(user)
        summary.author = summary.author or user

        if follow_up:
            appointment = book_follow_up(
                user,
                admission.patient,
                follow_up,
                episode=admission.episode,
                admission=admission,
                origin="DISCHARGE",
            )
            summary.follow_up_appointment = appointment
        summary.save()

        if not amending:
            admission.status = "DISCHARGED"
            admission.discharged_at = discharged_at
            admission.save(update_fields=["status", "discharged_at", "updated_at"])
            admission.bed.status = "AVAILABLE"
            admission.bed.save(update_fields=["status"])
            if admission.encounter_id:
                Encounter.objects.filter(pk=admission.encounter_id).update(
                    status="CLOSED", closed_at=discharged_at
                )
            service = BillingService.objects.filter(name="Discharge", active=True).first()
            if service:
                ChargeItem.objects.create(
                    organization_id=admission.organization_id,
                    patient=admission.patient,
                    episode=admission.episode,
                    service=service,
                    quantity=1,
                    unit_price=service.rate,
                    delivered_at=discharged_at,
                    created_by=user,
                )
        return summary
