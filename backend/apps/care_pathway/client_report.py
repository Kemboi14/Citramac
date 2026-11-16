"""
The full client report — registration through every intervention and outcome.

One compiler (`compile_report`) feeds both the screen (`ClientReportView`) and
the printable document (`ClientReportPrintView`), so the two cannot drift apart.
Nothing is stored: the report is worked out from the records each time it is
opened. Every opening is a VIEW entry and every PDF download an EXPORT entry in
the audit log (guide.md §4).

Content follows the same access rules as the screens it comes from: a
psychotherapy note's content only for its author or the client's care team
(`psychotherapy.can_read`), process notes and restricted intake fields only
for `clinical.restricted_content.view`, a discharge summary in full only for
`services.can_view_discharge_in_full`. Anything withheld is marked as such,
never silently dropped, so the reader knows it exists.
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


def _intake_sections(intake, labels, can_view_restricted=False):
    """The saved intake sections as titled label/value rows. Restricted fields
    (trauma detail) are removed unless the reader may see them."""
    result = []
    saved = intake_schema.strip_restricted(intake.sections or {}, can_view_restricted)
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


def _recheck(row):
    def shown(code):
        return code.replace("_", " ").capitalize() if code else ""

    return {
        "version": row.version,
        "signed_on": _when(row.signed_at),
        "signed_by": _name(row.signed_by),
        "change": shown(row.change_since_last_check),
        "distress": shown(row.distress_behaviour),
        "note": _text(row.note),
    }


def _triage_one(encounter, labels):
    assessment = encounter.assessments.filter(status="COMPLETED").order_by("-version").first()
    rechecks = encounter.rechecks.filter(status="COMPLETED").order_by("signed_at")
    from .print_views import _triage_sections

    answers = (
        [
            {"title": section["title"], "rows": section["lines"]}
            for section in _triage_sections(assessment.answers, labels)
        ]
        if assessment
        else []
    )
    return {
        "id": str(encounter.id),
        "assessment_id": str(assessment.id) if assessment else "",
        "answers": answers,
        "rules_version": assessment.rules_version if assessment else "",
        "arrival_at": _iso(encounter.arrival_at),
        "arrival_on": _when(encounter.arrival_at),
        "status": encounter.get_status_display(),
        "presenting_concern": _text(encounter.presenting_concern),
        "priority": encounter.priority,
        "priority_label": (encounter.get_priority_display() if encounter.priority else "Not set"),
        "signed": assessment is not None,
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
        "override_reason": (
            _text(assessment.override_reason)
            if assessment and assessment.decision == "OVERRIDE"
            else ""
        ),
        "findings": _finding_lines(assessment.findings) if assessment else [],
        "alerts": _finding_lines(assessment.alerts) if assessment else [],
        "rechecks": [_recheck(row) for row in rechecks],
    }


def _triages(patient, labels):
    """Every triage, first to latest: each arrival, its signed assessment and rechecks."""
    encounters = (
        TriageEncounter.objects.filter(patient=patient)
        .prefetch_related("assessments__signed_by", "rechecks__signed_by")
        .order_by("arrival_at")
    )
    return [_triage_one(encounter, labels) for encounter in encounters]


def _intakes(patient, labels, can_view_restricted):
    """Every intake, first to latest, each with what was recorded and decided."""
    intakes = (
        IntakeAssessment.objects.filter(patient=patient)
        .select_related("author", "signed_by")
        .order_by("created_at", "version")
    )
    return [_intake_one(intake, labels, can_view_restricted) for intake in intakes]


def _intake_one(intake, labels, can_view_restricted):
    return {
        "id": str(intake.id),
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
        "author": _name(intake.author),
        "sections": _intake_sections(intake, labels, can_view_restricted),
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


def _interventions(patient, labels, user):
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

    sessions = _psychotherapy(patient, user)
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


WITHHELD = "Withheld — only the author or the client's care team may read this content."


def _psychotherapy(patient, user):
    from apps.mhp_program.permissions import has_full_mhp_access

    from . import psychotherapy, therapy

    full_access = user is not None and has_full_mhp_access(user, patient)
    sessions = (
        PsychotherapySession.objects.filter(patient=patient)
        .select_related("therapist", "psy_note")
        .order_by("-session_date")
    )
    result = []
    for session in sessions:
        note = getattr(session, "psy_note", None)
        readable = (
            psychotherapy.can_read(user, note)
            if note is not None and user is not None
            else full_access or (user is not None and session.therapist_id == user.pk)
        )
        details = []
        if session.duration_minutes:
            details.append({"label": "Duration", "value": f"{session.duration_minutes} minutes"})
        if session.modality:
            details.append({"label": "Modality", "value": session.modality})
        if session.trauma_processing_stage:
            details.append({"label": "Trauma phase", "value": session.trauma_processing_stage})
        if session.progress_rating:
            details.append({"label": "Progress", "value": f"{session.progress_rating}/10"})
        if not readable:
            result.append(
                {
                    "id": str(session.id),
                    "kind": "session",
                    "at": _iso(session.session_date),
                    "on": _when(session.session_date),
                    "provider": _name(session.therapist),
                    "title": session.get_session_type_display(),
                    "note": "",
                    "response": "",
                    "outcome": "",
                    "next_action": "",
                    "details": details,
                    "restricted": WITHHELD,
                }
            )
            continue
        if _text(session.goals):
            details.append({"label": "Goals", "value": _text(session.goals)})
        extra = therapy.visible_extra(session.extra or {}, user)
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
                "restricted": "",
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


def _discharges(patient, user):
    from apps.mhp_program.permissions import has_full_mhp_access

    labels = services.concept_labels()
    rows = (
        DischargeSummary.objects.filter(patient=patient)
        .select_related("signed_by", "admission__bed__ward")
        .prefetch_related("diagnoses", "medications")
        .order_by("-version")
    )
    result = []
    for row in rows:
        if row.admission_id:
            full = user is not None and services.can_view_discharge_in_full(
                user, row.admission, row
            )
        else:
            full = user is not None and (
                has_full_mhp_access(user, patient) or user.pk in (row.author_id, row.signed_by_id)
            )
        if not full:
            result.append(
                {
                    "id": str(row.id),
                    "printable": False,
                    "version": row.version,
                    "status": row.get_status_display(),
                    "signed_on": _when(row.signed_at),
                    "signed_by": _name(row.signed_by),
                    "discharged_on": _when(row.discharged_at),
                    "restricted": "Content withheld — the discharge summary is for the care "
                    "team, the consultant and its author.",
                    "destination": "",
                    "disposition": "",
                    "clinical_status": "",
                    "treatment_summary": "",
                    "legal_status": "",
                    "diagnoses": [],
                    "medications": [],
                }
            )
            continue
        result.append(
            {
                "restricted": "",
                "id": str(row.id),
                "printable": True,
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


def _admissions(patient):
    from apps.ipd_ward.models import Admission

    rows = (
        Admission.objects.filter(patient=patient)
        .select_related("bed__ward", "consultant", "admitted_by")
        .order_by("admitted_at")
    )
    result = []
    for row in rows:
        risks = [
            label
            for flag, label in (
                (row.risk_self_harm, "Self-harm"),
                (row.risk_to_others, "Harm to others"),
                (row.risk_absconding, "Absconding"),
                (row.risk_medical, "Medical"),
            )
            if flag
        ]
        result.append(
            {
                "id": str(row.id),
                "admitted_on": _when(row.admitted_at),
                "discharged_on": _when(row.discharged_at),
                "status": row.get_status_display(),
                "ward": row.bed.ward.name if row.bed_id and row.bed.ward_id else "",
                "bed": row.bed.bed_number if row.bed_id else "",
                "consultant": _name(row.consultant),
                "admitted_by": _name(row.admitted_by),
                "reason": _text(row.reason_for_admission),
                "primary_diagnosis": _text(row.primary_diagnosis),
                "risks": risks,
                "observation_level": row.observation_level,
                "risk_summary": _text(row.risk_summary),
            }
        )
    return result


def _group_sessions(patient, labels):
    from .models import GroupSessionEntry

    rows = (
        GroupSessionEntry.objects.filter(patient=patient)
        .select_related("session__category", "session__facilitator")
        .order_by("session__session_date")
    )
    return [
        {
            "id": str(row.id),
            "on": _day(row.session.session_date),
            "topic": row.session.topic,
            "category": (
                row.session.category.display
                if row.session.category_id
                else row.session.category_other
            ),
            "facilitator": _name(row.session.facilitator) or row.session.facilitator_name,
            "attendance": _concept(labels, "group-attendance", row.attendance),
            "observation": _text(row.observation),
            "risk_disclosure": row.risk_disclosure,
        }
        for row in rows
    ]


def _billing(patient, user):
    """Services delivered, the invoice, payments, claims and the balance — the
    billing workspace's own figures (insurance_claims.workspace), read-only."""
    from django.utils.dateparse import parse_datetime

    from apps.insurance_claims import workspace

    data = workspace.workspace(user, patient)
    currency = data.get("currency", "KES")

    def money(value):
        return f"{currency} {value}" if value not in (None, "") else ""

    def when(iso):
        parsed = parse_datetime(iso) if isinstance(iso, str) else iso
        return _when(parsed, "%d %b %Y") if parsed else ""

    invoice = data.get("invoice")
    return {
        "payer": data["payer"]["label"],
        "totals": {
            "services": money(data["totals"]["services"]),
            "paid": money(data["totals"]["paid"]),
            "outstanding": money(data["totals"]["outstanding"]),
        },
        "services": [
            {
                "on": when(e.get("delivered_at")),
                "service": e.get("service", ""),
                "status": str(e.get("status", "")).replace("_", " ").capitalize(),
                "amount": money(e.get("amount")),
            }
            for e in sorted(data["overview"]["events"], key=lambda e: e.get("delivered_at") or "")
        ],
        "invoice": (
            {
                "number": invoice["number"],
                "version": invoice["version"],
                "issued_on": when(invoice["created_at"]),
                "total": money(invoice["total"]),
                "stale": invoice["stale"],
            }
            if invoice
            else None
        ),
        "payments": [
            {
                "on": when(p["paid_at"]),
                "amount": money(p["amount"]),
                "method": p["method_label"],
                "reference": p["reference"],
                "received_by": p["received_by"],
            }
            for p in data["payments"]
        ],
        "claims": [
            {
                "number": c["claim_number"],
                "payer": c["payer"],
                "status": c["status_label"],
                "claimed": money(c["total_claimed_amount"]),
                "submitted_on": when(c["submitted_at"]),
            }
            for c in data["claims"]
        ],
    }


def _activity(patient):
    """Everything that happened, newest first — the client timeline
    (services.client_timeline): arrivals, triage, re-checks, vitals, alerts,
    scores, notes, risk findings, consents, plan signatures, MDT reviews,
    co-signs, admissions and discharges."""
    from django.utils.dateparse import parse_datetime

    rows = []
    for event in services.client_timeline(patient):
        at = event.get("at")
        parsed = parse_datetime(at) if isinstance(at, str) else at
        rows.append(
            {
                "at": _iso(parsed) if parsed else "",
                "on": _when(parsed) if parsed else "",
                "kind": str(event.get("kind", "")).replace("_", " ").capitalize(),
                "title": str(event.get("title", "")),
                "detail": str(event.get("detail", "") or ""),
            }
        )
    rows.sort(key=lambda row: row["at"], reverse=True)
    return rows


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
    """The whole client report as plain, render-ready data, shaped by what
    `user` may read."""
    from . import intake as intake_module

    labels = services.concept_labels()
    can_view_restricted = user is not None and intake_module.can_view_restricted(user)
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
        "triages": _triages(patient, labels),
        "intakes": _intakes(patient, labels, can_view_restricted),
        "mse": _mse(patient),
        "admissions": _admissions(patient),
        "interventions": _interventions(patient, labels, user),
        "group_sessions": _group_sessions(patient, labels),
        "outcomes": _outcomes(patient),
        "discharges": _discharges(patient, user),
        "billing": _billing(patient, user),
        "activity": _activity(patient),
        "follow_ups": _follow_ups(patient),
        "appointments": _appointments(patient, labels),
        "notes": _notes(patient, labels),
    }
