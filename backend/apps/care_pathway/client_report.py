"""
The full client report — registration through every intervention and outcome.

One compiler (`compile_report`) feeds both the screen (`ClientReportView`) and
the printable document (`ClientReportPrintView`), so the two cannot drift apart.
Nothing is stored: the report is worked out from the records each time it is
opened. Every opening is a VIEW entry and every PDF download an EXPORT entry in
the audit log (CLAUDE.md §4).

The report includes the client's signed notes and, by explicit project-owner
decision, the confidential psychotherapy session notes for all clinicians.
"""

from django.utils import timezone

from apps.mhp_program.models import PsychotherapySession
from apps.triage.models import MentalStatusExam

from . import facility_time, intake_schema, outcomes, records, services
from .models import (
    PRIORITY_CHOICES,
    CarePlan,
    CarePlanActivity,
    ClinicalAlert,
    DischargeSummary,
    EpisodeOfCare,
    EpisodeOutcome,
    IntakeAssessment,
    InterventionRecord,
    ProgressNote,
    TriageEncounter,
)

# The printed report's title and reference prefix.
REFERENCE_PREFIX = "CLR"
TITLE = "Client report"

MSE_FIELDS = [
    ("appearance", "Appearance"),
    ("behavior", "Behaviour"),
    ("psychomotor", "Psychomotor"),
    ("rapport", "Rapport"),
    ("speech", "Speech"),
    ("mood", "Mood"),
    ("affect", "Affect"),
    ("thought_process", "Thought process"),
    ("thought_content", "Thought content"),
    ("perception", "Perception"),
    ("orientation", "Orientation"),
    ("attention", "Attention / concentration"),
    ("cognition", "Cognition / memory"),
    ("insight", "Insight"),
    ("judgment", "Judgement"),
    ("impulse_control", "Impulse control"),
    ("reliability", "Reliability"),
    ("plan", "Plan"),
    ("summary", "Summary"),
]

OUTCOME_OUTCOMES = dict(EpisodeOutcome.OUTCOME_CHOICES)


def _iso(value):
    return value.isoformat() if value else None


def _when(value, fmt="%d %b %Y %H:%M"):
    return facility_time.local_format(value, fmt) if value else ""


def _day(value):
    if not value:
        return ""
    if isinstance(value, str):
        from django.utils.dateparse import parse_date

        value = parse_date(value)
    return value.strftime("%d %b %Y") if value else ""


def _name(user):
    return services.user_display(user)


def _text(value):
    return (value or "").strip()


def _concept(labels, valueset, code, fallback=""):
    if not code:
        return fallback
    return labels.get((valueset, code), fallback or code.replace("_", " ").title())


def _display_value(value, valueset, labels):
    """A stored JSON answer as readable text (codes resolved through the served sets)."""
    if value is None or value == "" or value == [] or value == {}:
        return ""
    if isinstance(value, list):
        parts = [
            (
                _concept(labels, valueset, item)
                if isinstance(item, str)
                else _display_value(item, valueset, labels)
            )
            for item in value
        ]
        return ", ".join(part for part in parts if part)
    if isinstance(value, dict):
        parts = []
        for key, child in value.items():
            shown = _display_value(child, valueset, labels)
            if shown:
                parts.append(f"{key.replace('_', ' ').capitalize()}: {shown}")
        return "; ".join(parts)
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return str(value)


def _finding_lines(findings):
    """Triage findings are stored as [finding, status, source] triplets."""
    lines = []
    for row in findings or []:
        if isinstance(row, (list, tuple)):
            parts = [str(part) for part in row if part]
            if parts:
                lines.append(" — ".join(parts))
        elif isinstance(row, dict):
            label = row.get("finding") or row.get("label") or ""
            status = row.get("status") or ""
            source = row.get("source") or ""
            shown = " — ".join(part for part in (label, status, source) if part)
            if shown:
                lines.append(shown)
        elif row:
            lines.append(str(row))
    return lines


def _intake_sections(intake, labels):
    """The saved intake sections as titled label/value rows."""
    result = []
    saved = intake.sections or {}
    for section in intake_schema.SECTIONS:
        payload = saved.get(section["key"])
        if not payload:
            continue
        rows = []
        for field in section["fields"]:
            key = field["key"]
            value = payload.get(key) if isinstance(payload, dict) else None
            shown = _display_value(value, field.get("valueset"), labels)
            if shown:
                rows.append({"label": field["label"], "value": shown})
        if rows:
            result.append({"title": section["title"], "rows": rows})
    return result


def _address(patient):
    return _text(patient.address)


def _branch_for(patient, episode):
    if episode and episode.branch_id:
        return episode.branch
    first = (
        EpisodeOfCare.objects.filter(patient=patient, branch__isnull=False)
        .select_related("branch")
        .order_by("period_start")
        .first()
    )
    return first.branch if first else None


def _registration(patient, banner, episode):
    kin = patient.next_of_kin
    branch = _branch_for(patient, episode)
    return {
        "registered_at": _iso(patient.registered_at),
        "registered_on": _when(patient.registered_at, "%d %b %Y"),
        "branch": branch.name if branch else "",
        "setting": (banner.get("setting") or {}).get("type", ""),
        "setting_label": (
            "Inpatient"
            if (banner.get("setting") or {}).get("type") == "INPATIENT"
            else "Outpatient"
        ),
        "ward": (banner.get("setting") or {}).get("ward") or "",
        "bed": (banner.get("setting") or {}).get("bed") or "",
        "payer": banner.get("payer", ""),
        "phone": patient.contact_phone,
        "email": patient.contact_email,
        "address": _address(patient),
        "national_id": patient.national_id,
        "preferred_language": patient.preferred_language,
        "marital_status": (patient.get_marital_status_display() if patient.marital_status else ""),
        "occupation": patient.occupation,
        "next_of_kin": kin.name if kin else "",
        "next_of_kin_relationship": kin.relationship if kin else "",
        "next_of_kin_phone": kin.phone if kin else "",
        "referral_source": patient.referral_source,
    }


def _episode(episode):
    if episode is None:
        return None
    return {
        "id": str(episode.id),
        "open": episode.status in EpisodeOfCare.OPEN_STATUSES,
        "status": episode.status,
        "status_label": episode.get_status_display(),
        "started_at": _iso(episode.period_start),
        "started_on": _when(episode.period_start, "%d %b %Y"),
        "ended_on": _when(episode.period_end, "%d %b %Y"),
        "care_manager": _name(episode.care_manager),
        "branch": episode.branch.name if episode.branch_id else "",
        "presenting_problems": _text(episode.presenting_problems),
    }


def _diagnoses(patient):
    from apps.clinical_encounter.models import DiagnosisCode

    rows = (
        DiagnosisCode.objects.filter(encounter__patient=patient)
        .exclude(verification_status__in=DiagnosisCode.NOT_ASSERTED)
        .select_related("icd11_code")
        .order_by("-noted_at")
    )
    return [
        {
            "code": row.shown_code if row.icd11_code_id else "",
            "label": row.shown_label if row.icd11_code_id else str(row),
            "kind": "Primary" if row.is_primary else "Secondary",
            "status": row.get_status_display(),
            "certainty": row.get_verification_status_display(),
            "noted_on": _when(row.noted_at, "%d %b %Y"),
        }
        for row in rows
    ]


def _allergies(patient):
    from apps.client_registry.models import AllergyRecord

    rows = (
        AllergyRecord.objects.filter(patient=patient)
        .exclude(verification_status="REFUTED")
        .exclude(clinical_status="RESOLVED")
        .order_by("substance")
    )
    return [
        {
            "substance": row.substance,
            "reaction": row.reaction,
            "severity": row.severity,
            "type": row.get_allergy_type_display(),
            "verified": row.get_verification_status_display(),
        }
        for row in rows
    ]


def _medicines(patient):
    from apps.clinical_encounter.models import PrescriptionItem

    rows = (
        PrescriptionItem.objects.filter(prescription__encounter__patient=patient)
        .select_related("drug", "prescription__prescribed_by")
        .order_by("-prescription__prescribed_at")[:30]
    )
    return [
        {
            "drug": row.drug.generic_name if row.drug_id else "",
            "dose": row.dose,
            "route": row.route,
            "frequency": row.frequency,
            "duration": row.duration,
            "indication": row.indication,
            "prescribed_by": _name(row.prescription.prescribed_by),
            "prescribed_on": _when(row.prescription.prescribed_at, "%d %b %Y"),
        }
        for row in rows
    ]


def _alerts(patient):
    return [
        {"code": row.alert_code, "label": row.label, "raised_on": _when(row.raised_at, "%d %b %Y")}
        for row in ClinicalAlert.objects.filter(patient=patient, status="ACTIVE").order_by(
            "raised_at"
        )
    ]


def _triage(patient, labels):
    encounter = (
        TriageEncounter.objects.filter(patient=patient)
        .select_related("triage_started_by")
        .order_by("-arrival_at")
        .first()
    )
    if encounter is None:
        return None
    assessment = encounter.assessments.filter(status="COMPLETED").order_by("-version").first()
    return {
        "arrival_at": _iso(encounter.arrival_at),
        "arrival_on": _when(encounter.arrival_at),
        "status": encounter.get_status_display(),
        "presenting_concern": _text(encounter.presenting_concern),
        "priority": encounter.priority,
        "priority_label": (encounter.get_priority_display() if encounter.priority else "Not set"),
        "signed_on": _when(assessment.signed_at) if assessment else "",
        "signed_by": _name(assessment.signed_by) if assessment else "",
        "recommendation": (
            _concept(labels, "triage-recommendation", assessment.recommendation)
            if assessment
            else ""
        ),
        "recommendation_reasons": _text(assessment.recommendation_reasons) if assessment else "",
        "final_priority": (
            assessment.get_final_priority_display()
            if assessment and assessment.final_priority
            else ""
        ),
        "findings": _finding_lines(assessment.findings) if assessment else [],
        "alerts": _finding_lines(assessment.alerts) if assessment else [],
    }


def _intake(patient, labels):
    intake = (
        IntakeAssessment.objects.filter(patient=patient)
        .select_related("author", "signed_by")
        .order_by("-created_at", "-version")
        .first()
    )
    if intake is None:
        return None
    return {
        "version": intake.version,
        "status": intake.get_status_display(),
        "completeness": (intake.get_completeness_display() if intake.completeness else ""),
        "saved_on": _when(intake.created_at),
        "signed_on": _when(intake.signed_at),
        "signed_by": _name(intake.signed_by),
        "presenting_concern": _text(intake.presenting_concern),
        "history": _text(intake.history),
        "risk_level": intake.get_risk_level_display() if intake.risk_level else "",
        "risk_notes": _text(intake.risk_notes),
        "formulation": _text(intake.formulation),
        "clinical_decision": _concept(labels, "intake-clinical-decision", intake.clinical_decision),
        "gad7_score": intake.gad7_score,
        "phq9_score": intake.phq9_score,
        "outstanding": intake.outstanding or [],
        "sections": _intake_sections(intake, labels),
    }


def _mse(patient):
    exam = (
        MentalStatusExam.objects.filter(encounter__patient=patient)
        .select_related("recorded_by")
        .order_by("-recorded_at")
        .first()
    )
    if exam is None:
        return None
    fields = [
        {"label": label, "value": _text(getattr(exam, key))}
        for key, label in MSE_FIELDS
        if _text(getattr(exam, key))
    ]
    risk = exam.risk_assessment or {}
    risk_lines = []
    if risk.get("suicidal_ideation"):
        risk_lines.append("Suicidal ideation reported")
    if risk.get("homicidal_ideation"):
        risk_lines.append("Homicidal ideation reported")
    if _text(risk.get("notes")):
        risk_lines.append(_text(risk.get("notes")))
    if exam.risk_escalated_to_supervisor:
        risk_lines.append("Escalated to supervisor")
    return {
        "recorded_on": _when(exam.recorded_at),
        "recorded_by": _name(exam.recorded_by),
        "fields": fields,
        "risk": risk_lines,
    }


def _plan_note(activity):
    note = (
        ProgressNote.objects.filter(care_plan_activity=activity, note_type="CARE_PLAN")
        .select_related("author")
        .order_by("-created_at")
        .first()
    )
    if note is None:
        return None
    return {
        "at": _iso(note.signed_at or note.created_at),
        "on": _when(note.signed_at or note.created_at),
        "by": _name(note.author),
        "text": _text(note.text),
    }


def _delivery(row):
    return {
        "id": str(row.id),
        "kind": "delivery",
        "at": _iso(row.performed_at),
        "on": _when(row.performed_at),
        "provider": _name(row.provider),
        "title": row.intervention,
        "note": _text(row.note),
        "response": _text(row.response),
        "outcome": _text(row.outcome),
        "next_action": _text(row.next_action),
        "details": [],
    }


def _interventions(patient, labels):
    activities = list(
        CarePlanActivity.objects.filter(care_plan__patient=patient)
        .exclude(decision="DECLINED")
        .select_related("care_plan", "created_by")
        .order_by("created_at")
    )
    deliveries = list(
        InterventionRecord.objects.filter(patient=patient, voided_at__isnull=True)
        .select_related("provider", "activity")
        .order_by("-performed_at")
    )
    by_activity = {}
    unlinked = []
    for row in deliveries:
        if row.activity_id:
            by_activity.setdefault(row.activity_id, []).append(row)
        else:
            unlinked.append(row)

    groups = []
    for activity in activities:
        rows = by_activity.get(activity.id, [])
        note = _plan_note(activity)
        groups.append(
            {
                "id": str(activity.id),
                "title": activity.title,
                "module": _concept(labels, "care-module", activity.module),
                "priority": activity.priority,
                "priority_label": (activity.get_priority_display() if activity.priority else ""),
                "status": activity.status,
                "status_label": activity.get_status_display(),
                "decision": (activity.get_decision_display() if activity.decision else ""),
                "goal": _text(activity.goal),
                "instructions": _text(activity.instructions),
                "note": note,
                "records": [_delivery(row) for row in rows],
                "record_count": len(rows) + (1 if note else 0),
            }
        )

    if unlinked:
        groups.append(
            {
                "id": "other",
                "title": "Other interventions",
                "module": "",
                "priority": "",
                "priority_label": "",
                "status": "",
                "status_label": "",
                "decision": "",
                "goal": "",
                "instructions": "Recorded without a care-plan action.",
                "note": None,
                "records": [_delivery(row) for row in unlinked],
                "record_count": len(unlinked),
            }
        )

    sessions = _psychotherapy(patient)
    if sessions:
        groups.append(
            {
                "id": "psychotherapy",
                "title": "Psychotherapy sessions",
                "module": "Psychotherapy",
                "priority": "",
                "priority_label": "",
                "status": "",
                "status_label": "",
                "decision": "",
                "goal": "",
                "instructions": "",
                "note": None,
                "records": sessions,
                "record_count": len(sessions),
            }
        )
    return groups


def _psychotherapy(patient):
    sessions = (
        PsychotherapySession.objects.filter(patient=patient)
        .select_related("therapist", "psy_note")
        .order_by("-session_date")
    )
    result = []
    for session in sessions:
        note = getattr(session, "psy_note", None)
        details = []
        if session.duration_minutes:
            details.append({"label": "Duration", "value": f"{session.duration_minutes} minutes"})
        if session.modality:
            details.append({"label": "Modality", "value": session.modality})
        if session.trauma_processing_stage:
            details.append({"label": "Trauma phase", "value": session.trauma_processing_stage})
        if session.progress_rating:
            details.append({"label": "Progress", "value": f"{session.progress_rating}/10"})
        if _text(session.goals):
            details.append({"label": "Goals", "value": _text(session.goals)})
        extra = session.extra or {}
        if _text(extra.get("homework")):
            details.append({"label": "Homework", "value": _text(extra.get("homework"))})
        if _text(extra.get("process_notes")):
            details.append({"label": "Process notes", "value": _text(extra.get("process_notes"))})
        if note is not None:
            for key, title in _psy_sections():
                shown = _text((note.sections or {}).get(key))
                if shown:
                    details.append({"label": title, "value": shown})
        notes = _text(session.session_notes)
        result.append(
            {
                "id": str(session.id),
                "kind": "session",
                "at": _iso(session.session_date),
                "on": _when(session.session_date),
                "provider": _name(session.therapist),
                "title": session.get_session_type_display(),
                "note": notes,
                "response": "",
                "outcome": "",
                "next_action": "",
                "details": details,
            }
        )
    return result


def _psy_sections():
    from . import psy_organizer

    return psy_organizer.SECTIONS


def _outcomes(patient):
    overview = outcomes.overview(patient)
    summary = []
    for row in overview["summary"]:
        latest = row["latest"]
        change = row["change"]
        summary.append(
            {
                "instrument": row["instrument"],
                "name": row["name"],
                "max": row["max"],
                "baseline": row["baseline"]["score"],
                "baseline_on": _when(row["baseline"]["at"], "%d %b %Y"),
                "latest": latest["score"],
                "latest_on": _when(latest["at"], "%d %b %Y"),
                "band": latest["band"],
                "change": change["text"],
                "direction": change["direction"],
                "series": [
                    {"score": point["score"], "on": _when(point["at"], "%d %b %Y")}
                    for point in row["series"]
                ],
            }
        )

    episode = overview["episode"]
    outcome_row = episode.get("outcome") if episode else None
    episode_outcome = None
    if outcome_row:
        episode_outcome = {
            "outcome": OUTCOME_OUTCOMES.get(outcome_row["outcome"], outcome_row["outcome"]),
            "destination": outcome_row["destination"],
            "reason": outcome_row["reason"],
            "recorded_on": _when(outcome_row["recorded_at"]),
            "recorded_by": outcome_row["recorded_by"],
        }

    previous = [
        {
            "number": row["number"],
            "period": f"{_day(row['period_start'])} – {_day(row['period_end'])}",
            "outcome": OUTCOME_OUTCOMES.get(row["outcome"], row["outcome"]),
            "destination": row["destination"],
            "reason": row["reason"],
            "plan_version": row["plan_version"],
            "plan_actions": row["plan_actions"],
        }
        for row in overview["previous_episodes"]
    ]

    return {
        "summary": summary,
        "episode_outcome": episode_outcome,
        "previous_episodes": previous,
        "discharge_measures_due": overview["discharge_measures_due"],
    }


def _discharges(patient):
    labels = services.concept_labels()
    rows = (
        DischargeSummary.objects.filter(patient=patient)
        .select_related("signed_by", "admission__bed__ward")
        .prefetch_related("diagnoses", "medications")
        .order_by("-version")
    )
    result = []
    for row in rows:
        result.append(
            {
                "version": row.version,
                "status": row.get_status_display(),
                "signed_on": _when(row.signed_at),
                "signed_by": _name(row.signed_by),
                "discharged_on": _when(row.discharged_at),
                "destination": row.destination,
                "disposition": _concept(labels, "discharge-disposition", row.disposition),
                "clinical_status": _text(row.clinical_status),
                "treatment_summary": _text(row.treatment_summary),
                "legal_status": _text(row.legal_status_at_discharge),
                "diagnoses": [
                    {
                        "code": diagnosis.shown_code if diagnosis.icd11_code_id else "",
                        "label": (
                            diagnosis.shown_label if diagnosis.icd11_code_id else str(diagnosis)
                        ),
                    }
                    for diagnosis in row.diagnoses.all()
                ],
                "medications": [
                    {
                        "drug": line.drug.generic_name if line.drug_id else "",
                        "dose": line.dose,
                        "route": line.route,
                        "frequency": line.frequency,
                        "action": _concept(labels, "discharge-medication-action", line.action),
                        "note": line.note,
                    }
                    for line in row.medications.all()
                ],
            }
        )
    return result


def _follow_ups(patient):
    rows = records.client_follow_ups(patient)["results"]
    return [
        {
            "id": row["id"],
            "scheduled_for": _when(row["scheduled_for"]),
            "reason": row["reason_label"] or row["reason"],
            "status": row["status"].replace("_", " ").title(),
            "provider": row["provider_name"],
            "overdue": row["overdue"],
            "contact_note": row["contact_note"]["text"] if row["contact_note"] else "",
            "contact_by": row["contact_note"]["by"] if row["contact_note"] else "",
            "contact_on": _when(row["contact_note"]["at"]) if row["contact_note"] else "",
        }
        for row in rows
    ]


def _appointments(patient, labels):
    from apps.client_registry.models import Appointment

    rows = (
        Appointment.objects.filter(patient=patient)
        .select_related("provider", "branch")
        .order_by("-scheduled_for")[:100]
    )
    return [
        {
            "id": str(row.id),
            "scheduled_for": _iso(row.scheduled_for),
            "on": _when(row.scheduled_for),
            "type": row.appointment_type or "Appointment",
            "provider": _name(row.provider),
            "mode": row.get_mode_display(),
            "status": row.get_status_display(),
            "location": row.location,
            "origin": row.get_origin_display() if row.origin else "",
            "notes": _text(row.notes),
        }
        for row in rows
    ]


def _notes(patient, labels):
    rows = (
        ProgressNote.objects.filter(patient=patient, status="SIGNED")
        .exclude(note_type="CARE_PLAN")
        .select_related("author", "appointment")
        .order_by("-signed_at", "-created_at")
    )
    return [
        {
            "id": str(row.id),
            "on": _when(row.signed_at or row.created_at),
            "at": _iso(row.signed_at or row.created_at),
            "type": _concept(labels, "note-type", row.note_type, "Progress note"),
            "by": _name(row.author),
            "text": _text(row.text),
            "amends": str(row.amends_id) if row.amends_id else "",
        }
        for row in rows
    ]


def compile_report(patient, user=None):
    """The whole client report as plain, render-ready data."""
    labels = services.concept_labels()
    banner = services.banner_for(patient, include_journey=True)
    episode = services.current_or_latest_episode(patient)
    generated_at = timezone.now()

    plan = CarePlan.objects.filter(patient=patient).order_by("-created_at").first()
    care_plan = None
    if plan is not None:
        care_plan = {
            "version": plan.version,
            "confirmed_on": _when(plan.confirmed_at),
            "confirmed_by": _name(plan.confirmed_by),
            "goals": _text(plan.goals),
            "review_date": _day(plan.review_date),
            "care_coordinator": _name(plan.care_coordinator),
            "client_agreement": _concept(labels, "care-plan-agreement", plan.client_agreement),
            "what_matters": _text(plan.what_matters),
            "rationale": _text(plan.rationale),
        }

    return {
        "reference": f"{REFERENCE_PREFIX}-{str(patient.id)[:6].upper()}",
        "generated_at": generated_at.isoformat(),
        "generated_on": _when(generated_at),
        "generated_by": _name(user),
        "client": {
            "id": str(patient.id),
            "name": patient.get_full_name(),
            "preferred_name": patient.preferred_name,
            "citramac_number": patient.citramac_number,
            "mrn": patient.uhid_number,
            "age": patient.age_years,
            "sex": patient.get_gender_display() if patient.gender else "",
            "date_of_birth": _day(patient.date_of_birth),
            "identity_status": patient.identity_status,
            "identity_label": banner.get("identity_label", ""),
        },
        "registration": _registration(patient, banner, episode),
        "episode": _episode(episode),
        "clinical": {
            "priority": banner.get("priority", ""),
            "priority_label": dict(PRIORITY_CHOICES).get(banner.get("priority", ""), ""),
            "clinician": banner.get("clinician", ""),
            "team": banner.get("team", ""),
            "diagnoses": _diagnoses(patient),
            "allergies": _allergies(patient),
            "medicines": _medicines(patient),
            "alerts": _alerts(patient),
        },
        "care_plan": care_plan,
        "triage": _triage(patient, labels),
        "intake": _intake(patient, labels),
        "mse": _mse(patient),
        "interventions": _interventions(patient, labels),
        "outcomes": _outcomes(patient),
        "discharges": _discharges(patient),
        "follow_ups": _follow_ups(patient),
        "appointments": _appointments(patient, labels),
        "notes": _notes(patient, labels),
    }
