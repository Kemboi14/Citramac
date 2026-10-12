"""
Derived "needs attention" layer: the live risk register for one client and the
cross-client task list. Nothing here is stored — every item is computed from the
one shared record (CLAUDE.md §4: modules are views over one store), so it can
never disagree with the source. Items are shown to a clinician; none of them
changes the record or sets a priority.

Intervals and thresholds are owned by the modules that already define them
(observation policy, MAR windows, withdrawal protocol); this module only asks.
"""

from datetime import timedelta

from django.utils import timezone

from apps.client_registry.models import Appointment, Patient
from apps.triage.models import VitalSigns

from . import ews, instruments, intake, tools, withdrawal
from . import interventions as iv
from .models import (
    AssessmentToolDecision,
    CarePlanTask,
    ClinicalAlert,
    CosignRequest,
    EpisodeOfCare,
    IntakeAssessment,
    MdtReview,
    OutcomeScore,
    RestrictiveCheck,
    RestrictivePracticeEpisode,
)

SEVERITY = {"high": 0, "medium": 1, "info": 2}


def _intake_sections(patient):
    row = intake.current_draft(patient) or intake.latest_signed(patient)
    return row.sections if row else {}


def active_alerts(patient):
    """The live risk register: [{key, severity, text, source}], most serious first."""
    out = []

    def add(key, severity, text, source):
        out.append({"key": key, "severity": severity, "text": text, "source": source})

    for a in ClinicalAlert.objects.filter(patient=patient, status="ACTIVE"):
        add(f"alert:{a.alert_code}", "high", a.label, "Triage alert")

    sections = _intake_sections(patient)
    rows = (sections.get("risk", {}) or {}).get("rows", {}) or {}
    from . import intake_schema

    for spec in intake_schema.RISK_ROWS:
        chosen = [o for o in (rows.get(spec["key"]) or []) if o in spec["active"]]
        if chosen:
            add(f"risk:{spec['key']}", "high", f"{spec['label']}: {', '.join(chosen)}", "Intake risk")

    for code, spec in instruments.INSTRUMENTS.items():
        if spec.get("safety_item") is None:
            continue
        last = OutcomeScore.objects.filter(patient=patient, instrument=code).order_by("-recorded_at").first()
        if last and last.items and last.items[spec["safety_item"]] > 0:
            add(f"score:{code}:safety", "high", f"{spec['name']} self-harm item positive — review risk", spec["name"])

    for scale in withdrawal.overview(patient):
        for flag in scale["flags"]:
            add(f"withdrawal:{scale['instrument']}", "high", f"{scale['name']}: {flag}", "Withdrawal chart")

    vitals = VitalSigns.objects.filter(encounter__patient=patient).order_by("-recorded_at").first()
    if vitals:
        result = ews.from_vital(vitals)
        if result["response"]["tone"] == "bad":
            add("ews", "high", result["response"]["text"], "Early warning score")

    mse = (sections.get("mse") or {})
    perception, content = str(mse.get("perception", "")), str(mse.get("thought_content", ""))
    if "hallucination" in perception.lower() or "Delusions" in content:
        add("psychosis", "medium", "Possible psychotic features on mental state exam", "Mental state exam")

    obs = iv.observation_state(patient)
    if obs["overdue"]:
        add("obs:due", "medium", "Observation entry overdue", "Observation")
    if obs["rotation_overdue"]:
        add("obs:rotation", "medium", "Observer rotation due", "Observation")

    out.sort(key=lambda i: SEVERITY[i["severity"]])
    return out


def patient_items(patient, now=None):
    """Everything outstanding for one client: [{key, category, text, due_at, overdue}]."""
    now = now or timezone.now()
    items = []

    def add(key, category, text, due_at=None):
        items.append({"key": key, "category": category, "text": text, "due_at": due_at,
                      "overdue": bool(due_at and due_at < now)})

    for scale in withdrawal.overview(patient):
        if scale["nextDueAt"]:
            add(f"wd:{scale['instrument']}", "Withdrawal", f"Re-score {scale['name']}", scale["nextDueAt"])

    obs = iv.observation_state(patient)
    if obs["next_entry_due"]:
        add("obs", "Observation", "Observation entry due", obs["next_entry_due"])
    if obs["rotation_due"]:
        add("obs:rotation", "Observation", "Observer rotation due", obs["rotation_due"])

    mar = iv.mar_today(patient)
    for row in mar["entries"]:
        if row["state"] in ("due", "late", "missed"):
            add(f"mar:{row['id']}", "Medicines", f"{row['drug']} — {row['state']}", row["scheduled_time"])
    for row in mar["pending_effects"]:
        add(f"prn:{row['id']}", "Medicines", f"Record effect of PRN {row['drug']}", row["administered_at"])

    for ep in RestrictivePracticeEpisode.objects.filter(patient=patient):
        if iv.seclusion_review_due(ep):
            add(f"seclusion:{ep.id}", "Restrictive practice", "Seclusion past maximum — senior review", None)
        if ep.end_at and not ep.client_debrief_at:
            add(f"debrief:{ep.id}", "Restrictive practice", "Client debrief not recorded", ep.end_at)
        for check in RestrictiveCheck.objects.filter(episode=ep, done_at__isnull=True):
            add(f"check:{check.id}", "Restrictive practice", check.label, check.due_at)

    for undecided in tools.recommended_undecided(patient):
        add(f"tool:{undecided['key']}", "Assessment", f"Accept or decline recommended tool: {undecided['key']}")

    draft = intake.current_draft(patient)
    if draft:
        carried = ((draft.sections.get("risk") or {}).get("carried") or {})
        if any(not v.get("confirmed") for v in carried.values()):
            add("intake:carried", "Intake", "Confirm carried-forward triage risk findings")
        add("intake:draft", "Intake", "Intake is an unsigned draft")

    for task in CarePlanTask.objects.filter(activity__care_plan__patient=patient, done_at__isnull=True):
        add(f"task:{task.id}", "Care plan", task.label, task.due_at)

    for mdt in MdtReview.objects.filter(patient=patient, held_at__isnull=True):
        due = timezone.make_aware(timezone.datetime.combine(mdt.scheduled_for, timezone.datetime.min.time()))
        add(f"mdt:{mdt.id}", "Care plan", "MDT review", due)

    risky = any(a["severity"] == "high" for a in active_alerts(patient))
    for appt in Appointment.objects.filter(patient=patient, status="NO_SHOW", dna_actioned_at__isnull=True):
        text = (
            "Missed appointment with active risk — contact the client and next of kin today"
            if risky else "Missed appointment — re-contact the client"
        )
        add(f"dna:{appt.id}", "Follow-up", text, appt.scheduled_for)

    from django.conf import settings

    repeat_days = getattr(settings, "MEASURE_REPEAT_DAYS", None)
    if repeat_days:
        for code in ("PHQ9", "GAD7"):
            last = OutcomeScore.objects.filter(patient=patient, instrument=code).order_by("-recorded_at").first()
            if last and last.recorded_at < now - timedelta(days=repeat_days):
                add(f"measure:{code}", "Outcomes", f"{instruments.INSTRUMENTS[code]['name']} repeat due",
                    last.recorded_at + timedelta(days=repeat_days))

    from . import labs

    for r in labs.unacknowledged_abnormal(patient):
        add(f"lab:{r.pk}", "Labs", f"Abnormal result to acknowledge: {r.lab_order.loinc_code.description}", r.recorded_at)

    if patient.allergy_status == "UNKNOWN":
        add("allergy", "Safety", "Allergy status unknown")
    items.sort(key=lambda i: (not i["overdue"], i["due_at"] or now))
    return items


def my_tasks(user, limit=200):
    """Cross-client list, overdue first, plus decisions awaiting this user."""
    now = timezone.now()
    patient_ids = (
        EpisodeOfCare.objects.filter(status__in=EpisodeOfCare.OPEN_STATUSES)
        .values_list("patient_id", flat=True).distinct()[:limit]
    )
    out = []
    for patient in Patient.objects.filter(pk__in=list(patient_ids)):
        for item in patient_items(patient, now):
            out.append({**item, "patient_id": str(patient.pk), "patient": patient.get_full_name()})
    from . import plan_extras

    for req, kind in plan_extras.inbox(user):
        out.append({"key": f"cosign:{req.pk}", "category": "Decisions", "text": req.what, "due_at": req.requested_at,
                    "overdue": False, "patient_id": str(req.patient_id), "patient": req.patient.get_full_name(), "kind": kind})
    out.sort(key=lambda i: (not i["overdue"], i["due_at"] or now))
    return out


def ward_board():
    """One row per current inpatient: what a charge nurse scans at handover."""
    from apps.ipd_ward.models import Admission

    from .services import CURRENT_ADMISSION_STATUSES

    now = timezone.now()
    rows = []
    admissions = Admission.objects.filter(status__in=CURRENT_ADMISSION_STATUSES).select_related("patient", "bed__ward")
    for adm in admissions:
        patient = adm.patient
        vitals = list(VitalSigns.objects.filter(encounter__patient=patient).order_by("-recorded_at")[:2])
        ews_now = ews.from_vital(vitals[0]) if vitals else None
        trend = None
        if len(vitals) == 2 and ews_now:
            before = ews.from_vital(vitals[1])
            trend = "rising" if ews_now["score"] > before["score"] else "improving" if ews_now["score"] < before["score"] else "steady"
        obs = iv.observation_state(patient)
        scales = {s["instrument"]: s["latest"] for s in withdrawal.overview(patient) if s["latest"]}
        mdt = MdtReview.objects.filter(patient=patient, held_at__isnull=True).order_by("scheduled_for").first()
        soon = [i for i in patient_items(patient, now) if i["due_at"] and i["due_at"] <= now + timedelta(minutes=60)]
        rows.append({
            "patient_id": str(patient.pk), "patient": patient.get_full_name(),
            "bed": adm.bed.bed_number if adm.bed_id else "", "ward": adm.bed.ward.name if adm.bed_id else "",
            "day": (now.date() - adm.admitted_at.date()).days + 1,
            "legal_status": adm.get_admission_type_display(),
            "observation": obs["level"]["display"] if obs["level"] else "",
            "ews": ews_now["label"] if ews_now else "", "ews_trend": trend,
            "withdrawal": {k: {"score": v["score"], "band": v["band"]} for k, v in scales.items()},
            "next_mdt": mdt.scheduled_for if mdt else None, "due_within_hour": len(soon),
        })
    return rows
