"""
Group programme — the v4 mockup's "Group Psychotherapy" workspace
(mockups/citramac_clinical_workspace_v4.html, `groupProgrammePage`).

FHIR R4 mapping (approved by the project owner):

| Model | FHIR R4 resource |
|---|---|
| GroupSession | Appointment (the shared session) + Group (the cohort) |
| GroupSessionEntry | Encounter per participant (appointment → session, episodeOfCare → episode) |
| follow-up CareTask | Task |
| linked InterventionRecord | Procedure (module `group_psychotherapy`, not billable) |
| GroupProgrammeCategory | tenant-configured category list (local, not a clinical code) |

Per-subject separation (CLAUDE.md §4) is enforced here, not in the UI: the
shared session list, the session history and utilisation never carry an
observation or a risk detail; a client's record carries only that client's own
entries plus the shared session facts.

Open questions, recorded rather than guessed:
- No programme-enrolment model exists, so every client's programme is
  "Not assigned" (the mockup's own fallback).
- No session-eligibility model exists, so every listed client is eligible. The
  "Eligible clients only / All active clients" filter is kept working against
  the `eligible` flag so a real rule can be added without a UI change.
"""

from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.models import User
from apps.client_registry.models import Appointment, Patient
from apps.ipd_ward.models import Admission

from . import facility_time, services
from .models import (
    CareTask,
    ClinicalAlert,
    EpisodeOfCare,
    GroupProgrammeCategory,
    GroupSession,
    GroupSessionEntry,
)
from .services import StateConflict, user_display

ATTENDANCE_VALUESET = "group-attendance"
PRESENT = "PRESENT"
ATTENDANCE_ORDER = ("PRESENT", "ABSENT", "EXCUSED", "DECLINED")

# The mockup's DEFAULT_GROUP_PROGRAMME_CATEGORIES, seeded per organisation on first use.
DEFAULT_CATEGORIES = [
    ("group_psychotherapy", "Group psychotherapy"),
    ("psychoeducation", "Psychoeducation"),
    ("spiritual_wellbeing", "Spiritual wellbeing"),
    ("physical_fitness_and_movement", "Physical fitness and movement"),
    ("life_skills", "Life skills"),
    ("recreational_and_social_activities", "Recreational and social activities"),
    ("other_approved_programme", "Other approved programme"),
]

# The mockup's isGroupPsychotherapyAppointment() match on appointment type.
GROUP_APPOINTMENT_PATTERN = (
    r"group|programme|program|psychoeducation|spiritual|life skills|recreational"
)
# Saved sessions shown in the workspace rail: recent past plus everything ahead.
SESSION_WINDOW_DAYS = 90
SCHEDULED_PAST_DAYS = 14
SCHEDULED_AHEAD_DAYS = 7

INTERVENTION_MODULE = "group_psychotherapy"
INTERVENTION_NAME = "Group therapy"
FOLLOW_UP_CODE = "group_follow_up"
FOLLOW_UP_LABEL = "Individual follow-up after group session"
FOLLOW_UP_NEXT_ACTION = "Individual follow-up task required."
FOLLOW_UP_COMPLETED_REASON = "Individual follow-up task marked completed"
# A risk disclosure raises this alert on that client's record only (§4).
RISK_ALERT_CODE = "GROUP_RISK_DISCLOSURE"
RISK_ALERT_LABEL = "Group session: risk disclosure — individual clinical review"
RISK_OVERRIDE_MIN = 5


# ── Categories ──


def can_configure_categories(user):
    """Category changes are an administrator workflow (Org Admin, or Super Admin)."""
    return user.is_superuser or user.roles.filter(name__iexact="Org Admin").exists()


def categories(organization_id):
    """The organisation's categories; the mockup defaults are seeded on first use."""
    if organization_id and not GroupProgrammeCategory.objects.exists():
        GroupProgrammeCategory.objects.bulk_create(
            [
                GroupProgrammeCategory(
                    organization_id=organization_id, code=code, display=display, order=order
                )
                for order, (code, display) in enumerate(DEFAULT_CATEGORIES)
            ],
            ignore_conflicts=True,
        )
    return GroupProgrammeCategory.objects.all()


def category_row(category):
    return {
        "code": category.code,
        "display": category.display,
        "active": category.active,
        "is_other": category.code.startswith("other"),
    }


def _clean_category_display(display, exclude=None):
    display = str(display or "").strip()
    if not display:
        raise ValidationError({"display": "Enter a category name."})
    if len(display) > 100:
        raise ValidationError({"display": "Keep the category name to 100 characters."})
    clash = GroupProgrammeCategory.objects.filter(display__iexact=display)
    if exclude:
        clash = clash.exclude(pk=exclude.pk)
    if clash.exists():
        raise ValidationError({"display": "This category already exists."})
    return display


def add_category(user, display):
    if not can_configure_categories(user):
        raise PermissionDenied("Only an administrator can add a session category.")
    existing = categories(user.organization_id)
    display = _clean_category_display(display)
    base = slugify(display).replace("-", "_")[:56] or "category"
    code, suffix = base, 2
    while existing.filter(code=code).exists():
        code, suffix = f"{base}_{suffix}", suffix + 1
    last = existing.order_by("-order").first()
    return GroupProgrammeCategory.objects.create(
        organization_id=user.organization_id,
        code=code,
        display=display,
        order=(last.order + 1) if last else 0,
    )


def modify_category(user, category, display):
    """Changes the display only — the code, and every session using it, stay put."""
    if not can_configure_categories(user):
        raise PermissionDenied("Only an administrator can modify a session category.")
    category.display = _clean_category_display(display, exclude=category)
    category.save(update_fields=["display", "updated_at"])
    return category


# ── Eligible clients and the scheduled programme ──


def _client_name(patient):
    return patient.get_full_name().strip() or "Temporary client (unnamed)"


def _units_for(patient_ids):
    """Current inpatient admission → ward; no admission → Outpatient (mockup groupUnitForClient)."""
    units = {}
    admissions = (
        Admission.objects.filter(
            patient_id__in=patient_ids, status__in=services.CURRENT_ADMISSION_STATUSES
        )
        .select_related("bed__ward")
        .order_by("admitted_at")
    )
    for admission in admissions:
        ward = admission.bed.ward.name if admission.bed_id else ""
        units[admission.patient_id] = ward or "Residential unit not recorded"
    return units


def _eligible_patients():
    """Clients with an open episode, not archived, identity not "unknown"."""
    patient_ids = EpisodeOfCare.objects.filter(status__in=EpisodeOfCare.OPEN_STATUSES).values_list(
        "patient_id", flat=True
    )
    return Patient.objects.filter(pk__in=patient_ids, archived_at__isnull=True).exclude(
        identity_status=Patient.IDENTITY_UNKNOWN
    )


def eligible_clients():
    patients = list(_eligible_patients())
    units = _units_for([p.pk for p in patients])
    rows = [
        {
            "id": str(patient.pk),
            "display_id": patient.citramac_number,
            "name": _client_name(patient),
            "programme": "Not assigned",
            "unit": units.get(patient.pk, "Outpatient"),
            "admitted": patient.pk in units,
            # ASSUMPTION: no eligibility model exists — see the module docstring.
            "eligible": True,
        }
        for patient in patients
    ]
    return sorted(rows, key=lambda row: row["name"].lower())


def _hhmm(value):
    return value.strftime("%H:%M") if value else ""


def scheduled_sessions(today=None):
    """Group appointments not yet documented, one item per (date, time, provider)."""
    today = today or facility_time.local_date()
    linked = set(
        GroupSession.objects.exclude(appointment=None).values_list("appointment_id", flat=True)
    )
    appointments = (
        Appointment.objects.filter(
            appointment_type__iregex=GROUP_APPOINTMENT_PATTERN,
            # Facility-day bounds, not `__date` (which would truncate in UTC).
            scheduled_for__gte=facility_time.combine_local(
                today - timedelta(days=SCHEDULED_PAST_DAYS)
            ),
            scheduled_for__lt=facility_time.combine_local(
                today + timedelta(days=SCHEDULED_AHEAD_DAYS + 1)
            ),
        )
        .exclude(status="CANCELLED")
        .select_related("provider")
        .order_by("scheduled_for")
    )
    groups = {}
    for appointment in appointments:
        start = facility_time.local_datetime(appointment.scheduled_for)
        end = start + timedelta(minutes=appointment.duration_minutes or 0)
        key = (start.date(), _hhmm(start), appointment.provider_id)
        group = groups.setdefault(key, {"appointments": [], "end": end})
        group["appointments"].append(appointment)
        group["end"] = max(group["end"], end)
    items = []
    for (date, time, _provider), group in groups.items():
        booked = group["appointments"]
        if any(a.pk in linked for a in booked):
            continue
        first = booked[0]
        items.append(
            {
                "key": f"appointment:{first.pk}",
                "appointment_id": str(first.pk),
                "date": date.isoformat(),
                "time": time,
                "end_time": _hhmm(group["end"]) if group["end"].date() == date else "",
                # Instants, so the browser can format them in its own zone.
                "starts_at": first.scheduled_for.isoformat(),
                "ends_at": group["end"].isoformat(),
                "category": first.appointment_type or "Group session",
                "topic": first.appointment_type or "Group psychotherapy session",
                "facilitator": user_display(first.provider) or "Facilitator not assigned",
                "facilitator_id": str(first.provider_id) if first.provider_id else None,
                "location": first.location or "Location not assigned",
                "booked_count": len(booked),
            }
        )
    return items


def staff_directory():
    return [
        {"id": str(user.pk), "name": user_display(user)}
        for user in User.objects.filter(is_active=True).order_by("first_name", "last_name")
    ]


# ── Session payloads (shared facts only unless stated) ──


def _reference(session):
    return f"GRP-{str(session.pk)[:8].upper()}"


def category_label(session):
    return session.category_other or session.category.display


def facilitator_label(session):
    return (
        user_display(session.facilitator) or session.facilitator_name or "Facilitator not assigned"
    )


def _shared_facts(session):
    """What any attendee's record may show about the session itself."""
    return {
        "id": str(session.pk),
        "reference": _reference(session),
        "category_code": session.category.code,
        "category": category_label(session),
        "category_other": session.category_other,
        "topic": session.topic,
        "session_date": session.session_date.isoformat(),
        "start_time": _hhmm(session.start_time),
        "end_time": _hhmm(session.end_time),
        "facilitator": facilitator_label(session),
        "facilitator_id": str(session.facilitator_id) if session.facilitator_id else None,
        "facilitator_name": session.facilitator_name,
        "location": session.location,
        "description": session.description,
        "documented_by": user_display(session.documented_by) or "Staff member",
        "confirmed_at": session.confirmed_at.isoformat(),
    }


def _follow_up_open(entry):
    return bool(entry.follow_up_task_id) and entry.follow_up_task.status != "COMPLETED"


def session_row(session):
    """A session in the shared list: shared facts plus aggregate counts — never an
    observation or a risk detail."""
    entries = list(session.entries.all())
    present = sum(1 for e in entries if e.attendance == PRESENT)
    return {
        **_shared_facts(session),
        "appointment_id": str(session.appointment_id) if session.appointment_id else None,
        "entry_count": len(entries),
        "present_count": present,
        "not_present_count": len(entries) - present,
        "follow_ups_outstanding": sum(1 for e in entries if _follow_up_open(e)),
    }


def _sessions_queryset():
    return GroupSession.objects.select_related(
        "category", "facilitator", "documented_by"
    ).prefetch_related("entries__follow_up_task")


def recent_sessions(today=None):
    today = today or facility_time.local_date()
    since = today - timedelta(days=SESSION_WINDOW_DAYS)
    return [session_row(s) for s in _sessions_queryset().filter(session_date__gte=since)]


def _follow_up_status(entry):
    if not entry.follow_up_task_id:
        return "Not required"
    return "Completed" if entry.follow_up_task.status == "COMPLETED" else "Open"


def _entry_clinical(entry, labels):
    """The client-specific part of an entry — for the facilitator's saved-session
    view and that client's own record only."""
    record = entry.intervention_record
    return {
        "id": str(entry.pk),
        "attendance": entry.attendance,
        "attendance_display": labels.get((ATTENDANCE_VALUESET, entry.attendance), entry.attendance),
        "observation": entry.observation,
        "risk_disclosure": entry.risk_disclosure,
        "risk_detected": bool(entry.risk_detected),
        "risk_override_reason": entry.risk_override_reason,
        "follow_up_required": bool(entry.follow_up_task_id),
        "follow_up_status": _follow_up_status(entry),
        "follow_up_task_id": str(entry.follow_up_task_id) if entry.follow_up_task_id else None,
        "intervention_linked": bool(record and not record.voided_at),
        "version": entry.version,
    }


def _audit_trail(session, entries):
    trail = [
        {
            "label": "Session confirmed",
            "by": user_display(session.documented_by) or "Staff member",
            "at": session.confirmed_at.isoformat(),
            "note": f"Session confirmation linked {len(entries)} client entries.",
        }
    ]
    trail += [
        {"label": "Session amended", "by": item["by"], "at": item["at"], "note": item["reason"]}
        for item in session.audit
    ]
    trail += [
        {
            "label": "Individual client entry corrected",
            "by": item["by"],
            "at": item["at"],
            "note": "A correction was recorded on a linked client entry.",
        }
        for entry in entries
        for item in entry.audit
    ]
    return sorted(trail, key=lambda item: item["at"], reverse=True)


def session_detail(session):
    """The facilitator's saved-session view: each attendee's entry, as the mockup shows."""
    labels = services.concept_labels()
    entries = list(
        session.entries.select_related("patient", "follow_up_task", "intervention_record")
    )
    return {
        **session_row(session),
        "entries": [
            {
                **_entry_clinical(entry, labels),
                "patient_id": str(entry.patient_id),
                "display_id": entry.patient.citramac_number,
                "name": _client_name(entry.patient),
                "programme": "Not assigned",
            }
            for entry in entries
        ],
        "audit_trail": _audit_trail(session, entries),
    }, entries


def client_entries(patient):
    """One client's own group entries, newest session first, with the shared facts."""
    labels = services.concept_labels()
    entries = list(
        GroupSessionEntry.objects.filter(patient=patient)
        .select_related(
            "session__category",
            "session__facilitator",
            "session__documented_by",
            "follow_up_task",
            "intervention_record",
        )
        .order_by("-session__session_date", "-session__start_time")
    )
    return [
        {**_entry_clinical(entry, labels), "session": _shared_facts(entry.session)}
        for entry in entries
    ], entries


# ── Validation ──


class SessionDetailsSerializer(serializers.Serializer):
    category = serializers.CharField()
    category_other = serializers.CharField(max_length=100, required=False, allow_blank=True)
    topic = serializers.CharField(max_length=160)
    session_date = serializers.DateField()
    start_time = serializers.TimeField()
    end_time = serializers.TimeField()
    facilitator = serializers.UUIDField(required=False, allow_null=True)
    facilitator_name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    location = serializers.CharField(max_length=120)
    description = serializers.CharField(max_length=2000)

    def validate_category(self, code):
        category = GroupProgrammeCategory.objects.filter(code=code, active=True).first()
        if not category:
            raise serializers.ValidationError("Choose a session category.")
        return category

    def validate(self, data):
        if data["end_time"] <= data["start_time"]:
            raise serializers.ValidationError(
                {"end_time": "End time must be after the start time."}
            )
        other = data.get("category_other", "").strip()
        if data["category"].code.startswith("other"):
            if not other:
                raise serializers.ValidationError(
                    {"category_other": "Enter the approved category name."}
                )
        else:
            other = ""
        data["category_other"] = other
        facilitator_id = data.get("facilitator")
        name = data.get("facilitator_name", "").strip()
        if facilitator_id:
            data["facilitator"] = User.objects.filter(pk=facilitator_id, is_active=True).first()
            if not data["facilitator"]:
                raise serializers.ValidationError(
                    {"facilitator": "That facilitator is not an active member of staff."}
                )
            name = ""
        elif name:
            data["facilitator"] = None
        else:
            # Default facilitator: the member of staff documenting the session.
            data["facilitator"] = self.context["user"]
        data["facilitator_name"] = name
        return data


class EntrySerializer(serializers.Serializer):
    attendance = serializers.CharField()
    observation = serializers.CharField(max_length=1000, required=False, allow_blank=True)
    risk_disclosure = serializers.BooleanField(default=False)
    follow_up = serializers.BooleanField(default=False)
    # Why detected risk language is not a risk disclosure (owner decision
    # 2026-10-22: auto-flag, the clinician may untick only with a reason).
    risk_override_reason = serializers.CharField(
        max_length=500, required=False, allow_blank=True, default=""
    )

    def validate_attendance(self, code):
        if code not in services._valid_codes(ATTENDANCE_VALUESET):
            raise serializers.ValidationError("Select an attendance status.")
        return code

    def validate(self, data):
        data["observation"] = data.get("observation", "").strip()
        if data["risk_disclosure"]:
            if not data["observation"]:
                raise serializers.ValidationError(
                    {"observation": "Record the observation for a risk disclosure."}
                )
            if not data["follow_up"]:
                raise serializers.ValidationError(
                    {"follow_up": "A risk disclosure needs an individual follow-up task."}
                )
        data["risk_override_reason"] = data.get("risk_override_reason", "").strip()
        data["risk_detected"] = screen_observation(data["observation"])
        if data["risk_detected"] and not data["risk_disclosure"]:
            if len(data["risk_override_reason"]) < RISK_OVERRIDE_MIN:
                words = ", ".join(sorted({f["matched"] for f in data["risk_detected"]}))
                raise serializers.ValidationError(
                    {"risk_disclosure": f"Possible risk language detected ({words}). Mark it as a "
                     "risk disclosure, or give the reason it is not one."}
                )
        else:
            data["risk_override_reason"] = ""
        return data


class ConfirmEntrySerializer(EntrySerializer):
    patient = serializers.UUIDField()


class ConfirmReferencesSerializer(serializers.Serializer):
    client_request_id = serializers.UUIDField(required=False, allow_null=True)
    appointment = serializers.UUIDField(required=False, allow_null=True)


def _reason(data):
    reason = str(data.get("reason") or "").strip()
    if not reason:
        raise ValidationError({"reason": "Enter the reason for the correction."})
    if len(reason) > 500:
        raise ValidationError({"reason": "Keep the reason to 500 characters."})
    return reason


# ── Linked records ──


def _performed_at(session):
    """The session's date + start time are facility wall-clock values."""
    return facility_time.combine_local(session.session_date, session.start_time)


def _intervention_note(session):
    return (
        f"{session.topic} · {category_label(session)} · {facilitator_label(session)} "
        f"({session.session_date.isoformat()})"
    )


def _next_action(follow_up):
    return FOLLOW_UP_NEXT_ACTION if follow_up else ""


def _record_intervention(user, session, entry):
    return services.record_intervention(
        user,
        entry.patient,
        {
            "module": INTERVENTION_MODULE,
            "intervention": INTERVENTION_NAME,
            "performed_at": _performed_at(session),
            "provider": session.facilitator,
            "note": _intervention_note(session),
            "response": entry.observation,
            "next_action": _next_action(bool(entry.follow_up_task_id)),
        },
    )


def _create_follow_up(user, session, patient):
    return CareTask.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        action_code=FOLLOW_UP_CODE,
        action_label=FOLLOW_UP_LABEL,
        owner=facilitator_label(session),
        status="INITIATED",
        created_by=user,
    )


# ── Risk screen ──


def screen_observation(text):
    """Possible safety language in one client's observation — the same served
    lexicon and idiom rules as the psychotherapy note (PSY-RD). A prompt for
    the clinician, never a label or a score."""
    from . import psy_organizer, psychotherapy

    if not (text or "").strip():
        return []
    return [
        {"matched": d["matched"], "category": d["category"], "passage": d["passage"]}
        for d in psy_organizer.detect_risk_language(
            {"q1": {"text": text}}, psychotherapy.lexicon("PSY_RISK")
        )
    ]


def screen_entries(rows):
    """POST group-sessions/screen/ — run before review so the flags show where
    the clinician decides. Nothing is stored."""
    if not isinstance(rows, list):
        raise ValidationError({"entries": "Send the entries to screen."})
    return [
        {"patient": str(row.get("patient", "")), "flags": screen_observation(row.get("observation", ""))}
        for row in rows if isinstance(row, dict)
    ]


def _raise_risk_alert(user, entry):
    entry.risk_alert = ClinicalAlert.objects.create(
        organization_id=entry.organization_id, patient=entry.patient,
        alert_code=RISK_ALERT_CODE, label=RISK_ALERT_LABEL, raised_by=user,
    )


def _resolve_risk_alert(user, entry):
    alert = entry.risk_alert
    if alert and alert.status == "ACTIVE":
        alert.status, alert.resolved_at, alert.resolved_by = "RESOLVED", timezone.now(), user
        alert.save(update_fields=["status", "resolved_at", "resolved_by", "updated_at"])


# ── Confirm ──


@transaction.atomic
def confirm_session(user, data):
    """Save the reviewed session, one entry per listed client, an intervention
    record for each client present and a follow-up task where one is required —
    all or nothing. Idempotent on `client_request_id`."""
    references = ConfirmReferencesSerializer(data=data)
    references.is_valid(raise_exception=True)
    request_id = references.validated_data.get("client_request_id")
    if request_id:
        existing = GroupSession.objects.filter(client_request_id=request_id).first()
        if existing:
            return existing
    categories(user.organization_id)
    details = SessionDetailsSerializer(data=data, context={"user": user})
    details.is_valid(raise_exception=True)
    rows = data.get("entries")
    if not isinstance(rows, list) or not rows:
        raise ValidationError({"entries": "No eligible clients match the selected filters."})
    entries = []
    for index, row in enumerate(rows):
        serializer = ConfirmEntrySerializer(data=row)
        if not serializer.is_valid():
            raise ValidationError(
                {f"entries.{index}.{field}": errors for field, errors in serializer.errors.items()}
            )
        entries.append(serializer.validated_data)
    patient_ids = [row["patient"] for row in entries]
    if len(set(patient_ids)) != len(patient_ids):
        raise ValidationError({"entries": "Each client can be recorded only once per session."})
    patients = {p.pk: p for p in _eligible_patients().filter(pk__in=patient_ids)}
    if len(patients) != len(patient_ids):
        raise ValidationError(
            {
                "entries": "A listed client no longer has an open episode of care. "
                "Reload the session."
            }
        )

    appointment = None
    if references.validated_data.get("appointment"):
        appointment = Appointment.objects.filter(
            pk=references.validated_data["appointment"]
        ).first()
        if not appointment:
            raise ValidationError({"appointment": "That scheduled session was not found."})
        if GroupSession.objects.filter(appointment=appointment).exists():
            raise StateConflict("This scheduled session has already been documented.")

    try:
        with transaction.atomic():
            session = GroupSession.objects.create(
                organization_id=user.organization_id,
                documented_by=user,
                appointment=appointment,
                client_request_id=request_id or None,
                **details.validated_data,
            )
    except IntegrityError:
        if not request_id:
            raise
        # A concurrent retry of the same request won the race.
        return GroupSession.objects.get(client_request_id=request_id)

    for row in entries:
        patient = patients[row["patient"]]
        entry = GroupSessionEntry(
            organization_id=session.organization_id,
            session=session,
            patient=patient,
            episode=services.open_episode_for(patient),
            attendance=row["attendance"],
            observation=row["observation"],
            risk_disclosure=row["risk_disclosure"],
            risk_detected=row["risk_detected"],
            risk_override_reason=row["risk_override_reason"],
        )
        if row["follow_up"]:
            entry.follow_up_task = _create_follow_up(user, session, patient)
        if entry.risk_disclosure:
            _raise_risk_alert(user, entry)
        if entry.attendance == PRESENT:
            entry.intervention_record = _record_intervention(user, session, entry)
        entry.save()
    return session


# ── Corrections ──

SESSION_FIELDS = (
    "category",
    "category_other",
    "topic",
    "session_date",
    "start_time",
    "end_time",
    "facilitator",
    "facilitator_name",
    "location",
    "description",
)


def _session_snapshot(session):
    return {
        "category": session.category.code,
        "category_other": session.category_other,
        "topic": session.topic,
        "session_date": session.session_date.isoformat(),
        "start_time": _hhmm(session.start_time),
        "end_time": _hhmm(session.end_time),
        "facilitator": facilitator_label(session),
        "location": session.location,
        "description": session.description,
    }


@transaction.atomic
def correct_session(user, session, data):
    """Amend the shared session details. Every linked intervention record's note
    is updated with a correction; individual observations are not touched."""
    reason = _reason(data)
    details = SessionDetailsSerializer(data=data, context={"user": user})
    details.is_valid(raise_exception=True)
    session = GroupSession.objects.select_for_update().get(pk=session.pk)
    before = _session_snapshot(session)
    for field in SESSION_FIELDS:
        setattr(session, field, details.validated_data[field])
    after = _session_snapshot(session)
    if after == before:
        raise ValidationError({"detail": "Change at least one detail before saving a correction."})
    now = timezone.now().isoformat()
    by = user_display(user)
    session.audit = [
        *session.audit,
        {"at": now, "by": by, "reason": reason, "before": before, "after": after},
    ]
    session.save()
    note = _intervention_note(session)
    for entry in session.entries.select_related("intervention_record"):
        record = entry.intervention_record
        if not record or record.voided_at:
            continue
        record.corrections = [
            *record.corrections,
            {
                "at": now,
                "by": by,
                "reason": reason,
                "before": {"note": record.note},
                "after": {"note": note},
            },
        ]
        record.note = note
        record.save(update_fields=["note", "corrections", "updated_at"])
    return session


def _entry_snapshot(entry):
    return {
        "attendance": entry.attendance,
        "observation": entry.observation,
        "risk_disclosure": entry.risk_disclosure,
        "risk_override_reason": entry.risk_override_reason,
        "follow_up_required": bool(entry.follow_up_task_id),
    }


def _sync_entry_intervention(user, session, entry, before, reason):
    record = entry.intervention_record
    live = record if record and not record.voided_at else None
    present = entry.attendance == PRESENT
    correction = {
        "at": timezone.now().isoformat(),
        "by": user_display(user),
        "reason": reason,
        "before": {"attendance": before["attendance"], "observation": before["observation"]},
        "after": {"attendance": entry.attendance, "observation": entry.observation},
    }
    if live and not present:
        services.void_intervention(
            user, live, reason, after={"voided": True, "attendance": entry.attendance}
        )
    elif present and not live:
        added = _record_intervention(user, session, entry)
        added.corrections = [{**correction, "replaces": str(record.pk) if record else None}]
        added.save(update_fields=["corrections", "updated_at"])
        entry.intervention_record = added
    elif live:
        live.response = entry.observation
        live.next_action = _next_action(bool(entry.follow_up_task_id))
        live.corrections = [*live.corrections, correction]
        live.save(update_fields=["response", "next_action", "corrections", "updated_at"])


@transaction.atomic
def correct_entry(user, entry, data):
    """Amend one client's entry only. The version goes up and the before/after is
    kept; the linked intervention record is voided, created or updated to match."""
    reason = _reason(data)
    serializer = EntrySerializer(data=data)
    serializer.is_valid(raise_exception=True)
    changes = serializer.validated_data
    entry = (
        GroupSessionEntry.objects.select_for_update(of=("self",))
        .select_related("session__category", "session__facilitator", "patient")
        .get(pk=entry.pk)
    )
    session = entry.session
    before = _entry_snapshot(entry)
    task = entry.follow_up_task
    if changes["follow_up"] and not task:
        entry.follow_up_task = _create_follow_up(user, session, entry.patient)
    elif not changes["follow_up"] and task:
        if task.status != "COMPLETED":
            raise ValidationError(
                {
                    "follow_up": "The follow-up task is still open. "
                    "Complete it from the client record first."
                }
            )
        entry.follow_up_task = None
    was_risk = entry.risk_disclosure
    entry.attendance = changes["attendance"]
    entry.observation = changes["observation"]
    entry.risk_disclosure = changes["risk_disclosure"]
    entry.risk_detected = changes["risk_detected"]
    entry.risk_override_reason = changes["risk_override_reason"]
    after = _entry_snapshot(entry)
    if after == before:
        raise ValidationError({"detail": "Change at least one field before saving a correction."})
    _sync_entry_intervention(user, session, entry, before, reason)
    if entry.risk_disclosure and not was_risk:
        _raise_risk_alert(user, entry)
    elif was_risk and not entry.risk_disclosure:
        _resolve_risk_alert(user, entry)
    entry.version += 1
    entry.audit = [
        *entry.audit,
        {
            "at": timezone.now().isoformat(),
            "by": user_display(user),
            "reason": reason,
            "before": before,
            "after": after,
        },
    ]
    entry.save()
    return entry


@transaction.atomic
def complete_follow_up(user, entry):
    entry = GroupSessionEntry.objects.select_for_update().get(pk=entry.pk)
    task = entry.follow_up_task
    if not task:
        raise ValidationError({"detail": "This entry has no follow-up task."})
    if task.status == "COMPLETED":
        return entry
    task.status = "COMPLETED"
    task.save(update_fields=["status", "updated_at"])
    entry.version += 1
    entry.audit = [
        *entry.audit,
        {
            "at": timezone.now().isoformat(),
            "by": user_display(user),
            "reason": FOLLOW_UP_COMPLETED_REASON,
            "before": {"follow_up_status": "Open"},
            "after": {"follow_up_status": "Completed"},
        },
    ]
    entry.save(update_fields=["version", "audit", "updated_at"])
    return entry


# ── Aggregates (counts only — no observation or risk detail ever leaves here) ──


def _open_follow_up_filter():
    return Q(follow_up_task__isnull=False) & ~Q(follow_up_task__status="COMPLETED")


def utilisation():
    entries = GroupSessionEntry.objects.all()
    live_records = Q(intervention_record__isnull=False, intervention_record__voided_at__isnull=True)
    by_category = []
    for category in categories_with_sessions():
        counts = dict(
            entries.filter(session__category=category)
            .order_by()
            .values_list("attendance")
            .annotate(n=Count("id"))
        )
        marked = sum(counts.get(code, 0) for code in ATTENDANCE_ORDER)
        present = counts.get(PRESENT, 0)
        by_category.append(
            {
                "category": category.display,
                "sessions": category.session_count,
                "present": present,
                "absent": counts.get("ABSENT", 0),
                "excused": counts.get("EXCUSED", 0),
                "declined": counts.get("DECLINED", 0),
                "attendance_percent": round(present / marked * 100) if marked else 0,
            }
        )
    return {
        "confirmed_sessions": GroupSession.objects.count(),
        "recorded_attendances": entries.filter(attendance=PRESENT).count(),
        "follow_ups_outstanding": entries.filter(_open_follow_up_filter()).count(),
        "linked_intervention_records": entries.filter(live_records).count(),
        "by_category": by_category,
        "sessions_with_linked_records": GroupSession.objects.filter(
            Q(entries__intervention_record__isnull=False)
            & Q(entries__intervention_record__voided_at__isnull=True)
        )
        .distinct()
        .count(),
        "risk_disclosures_flagged": entries.filter(risk_disclosure=True).count(),
    }


def categories_with_sessions():
    return (
        GroupProgrammeCategory.objects.annotate(session_count=Count("sessions"))
        .filter(session_count__gt=0)
        .order_by("order", "display")
    )


def dashboard_counts():
    return {
        "group_session_count": GroupSession.objects.count(),
        "group_follow_up_open": GroupSessionEntry.objects.filter(_open_follow_up_filter()).count(),
    }
