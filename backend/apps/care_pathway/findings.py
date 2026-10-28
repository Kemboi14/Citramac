"""
The shared clinical finding store (triage spec §17–§19; CLAUDE.md §4 "one
shared resource store, many views").

One finding per client per key ("SUICIDE_SELF_HARM", "SUBSTANCE:alcohol", …).
Triage records it; Intake and later stages read the same finding and confirm
or update it. Every change is a new `ClinicalFinding` version that supersedes
the last, so nothing is overwritten: the previous value, its source, who
recorded it and when stay in the history.
"""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import ClinicalFinding

DOMAINS = [
    ("PRESENTING_CONCERN", "Presenting concern"),
    ("SUICIDE_SELF_HARM", "Suicide / self-harm"),
    ("HARM_TO_OTHERS", "Risk of harm to others"),
    ("MENTAL_STATE", "Acute mental state"),
    ("SUBSTANCE_USE", "Alcohol & other substances"),
    ("SUBSTANCE", "Substance"),
    ("MEDICAL", "Urgent medical concern"),
    ("SAFEGUARDING", "Safeguarding & vulnerability"),
    ("FUNCTIONAL", "Immediate functional safety"),
]
STATUSES = dict(ClinicalFinding.STATUS_CHOICES)
SOURCES = [
    ("CLIENT_REPORT", "Client report"),
    ("THIRD_PARTY_REPORT", "Third-party report"),
    ("CLINICIAN_OBSERVATION", "Clinician observation"),
    ("MEASUREMENT", "Measurement"),
    ("PREVIOUS_RECORD", "Previous record"),
    ("ASSESSMENT", "Assessment result"),
]
VALUESETS = {
    "clinical-finding-domain": ("Clinical finding domain", DOMAINS),
    "clinical-finding-status": ("Finding status", list(ClinicalFinding.STATUS_CHOICES)),
    "clinical-finding-action": ("Finding change", list(ClinicalFinding.ACTION_CHOICES)),
    "clinical-finding-source": ("Finding source", SOURCES),
}


def current(patient):
    """{key: latest version} for the client, in the store's domain order."""
    latest = {}
    for finding in ClinicalFinding.objects.filter(patient=patient).select_related("recorded_by"):
        if finding.key not in latest:  # ordered by key, -version
            latest[finding.key] = finding
    order = {code: i for i, (code, _l) in enumerate(DOMAINS)}
    return sorted(latest.values(), key=lambda f: (order.get(f.domain, 99), f.key))


def history(patient, key):
    return list(
        ClinicalFinding.objects.filter(patient=patient, key=key)
        .select_related("recorded_by")
        .order_by("-version")
    )


def _latest(patient, key):
    return (
        ClinicalFinding.objects.select_for_update()
        .filter(patient=patient, key=key)
        .order_by("-version")
        .first()
    )


def _write(patient, key, previous, **fields):
    return ClinicalFinding.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        key=key,
        version=(previous.version + 1) if previous else 1,
        supersedes=previous,
        **fields,
    )


@transaction.atomic
def record_from_triage(assessment, items, user, at):
    """A signed v5 triage writes each domain it screened. An unchanged finding
    is still a new version (stage TRIAGE, action CONFIRMED) so the history shows
    it was re-checked at this triage; a changed one is UPDATED."""
    te = assessment.triage_encounter
    patient = te.patient
    out = []
    for item in items:
        previous = _latest(patient, item["key"])
        if previous is None:
            action = "RECORDED"
        elif previous.status == item["status"] and previous.values == item["values"]:
            action = "CONFIRMED"
        else:
            action = "UPDATED"
        out.append(
            _write(
                patient,
                item["key"],
                previous,
                episode_id=te.episode_id,
                encounter_id=te.encounter_id,
                domain=item["domain"],
                title=item["title"][:120],
                status=item["status"],
                summary=item["summary"],
                values=item["values"],
                action=action,
                stage="TRIAGE",
                source_code=item["source_code"],
                source_label=item["source_label"][:120],
                source_detail=(item.get("source_detail") or "")[:200],
                source_type="TriageAssessment",
                source_id=assessment.id,
                recorded_at=at,
                recorded_by=user,
            )
        )
    return out


@transaction.atomic
def review(patient, key, user, *, action, stage, status=None, note="", source=None):
    """Confirm the current finding unchanged, or update its status / add
    information. `source` is a (code, label) pair; by default a clinician's
    review at this stage."""
    previous = _latest(patient, key)
    if previous is None:
        raise ValidationError({"key": "No such finding for this client."})
    if action not in ("CONFIRMED", "UPDATED"):
        raise ValidationError({"action": "Choose confirm or update."})
    note = (note or "").strip()
    if action == "UPDATED":
        status = status or previous.status
        if status not in STATUSES:
            raise ValidationError({"status": "Choose present, not present or unable to determine."})
        if status == previous.status and not note:
            raise ValidationError({"note": "Say what changed or add the new information."})
    else:
        status = previous.status
    code, label = source or ("CLINICIAN_OBSERVATION", f"Clinician review ({stage.lower()})")
    return _write(
        patient,
        key,
        previous,
        episode_id=previous.episode_id,
        encounter_id=previous.encounter_id,
        domain=previous.domain,
        title=previous.title,
        status=status,
        summary=previous.summary,
        values=previous.values,
        note=note,
        action=action,
        stage=stage,
        source_code=code,
        source_label=label,
        recorded_at=timezone.now(),
        recorded_by=user,
    )


def payload(finding):
    from .services import user_display

    return {
        "id": str(finding.id),
        "key": finding.key,
        "domain": finding.domain,
        "title": finding.title,
        "status": finding.status,
        "status_label": STATUSES[finding.status],
        "summary": finding.summary,
        "note": finding.note,
        "action": finding.action,
        "stage": finding.stage,
        "source_code": finding.source_code,
        "source_label": finding.source_label,
        "source_detail": finding.source_detail,
        "version": finding.version,
        "recorded_at": finding.recorded_at.isoformat(),
        "recorded_by": user_display(finding.recorded_by),
    }
