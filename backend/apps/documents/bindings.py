"""
Auto-populated field bindings (DOC-SPEC #4) — read-only views over the one
shared store (CLAUDE.md §4). Nothing here copies or re-derives clinical data
into a second store: each resolver reads the source object at organize time
and returns the value with its source (RULE-03) and time (RULE-04).

Psychotherapy session content (mhp_program.PsychotherapySession,
care_pathway therapy notes) has no binding at all — it can never reach a
generated document (DOC-CI-04, DOC-GOV-03).

A missing value is returned as None and rendered "Not recorded" — never as a
negative finding.
"""

from functools import cached_property

from django.conf import settings

CLIENT_REPORT = "CLIENT_REPORT"
CLINICIAN_OBSERVATION = "CLINICIAN_OBSERVATION"
MEASUREMENT = "MEASUREMENT"
ASSESSMENT_RESULT = "ASSESSMENT_RESULT"
PREVIOUS_RECORD = "PREVIOUS_RECORD"


def _iso(value):
    return value.isoformat() if value else None


def _date(value):
    if not value:
        return ""
    return value.strftime("%d %b %Y") if hasattr(value, "strftime") else str(value)


def _user(user):
    if not user:
        return ""
    return f"{user.first_name} {user.last_name}".strip() or user.email


def _concept(valueset, code):
    if not code:
        return ""
    from apps.care_pathway.models import LocalConcept

    concept = LocalConcept.objects.filter(valueset_id=valueset, code=code).first()
    return concept.display if concept else str(code)


def _v(value, source=PREVIOUS_RECORD, at=None, origin=""):
    if value in (None, "", []):
        return None
    return {"value": value, "source": source, "recorded_at": _iso(at), "origin": origin}


class RecordContext:
    """Lazily loaded record facts for one client, shared by bindings and rules."""

    def __init__(self, patient, author, organization):
        self.patient = patient
        self.author = author
        self.organization = organization

    @cached_property
    def episode(self):
        from apps.care_pathway.services import current_or_latest_episode

        return current_or_latest_episode(self.patient)

    @cached_property
    def current_admission(self):
        from apps.care_pathway.services import current_admission

        return current_admission(self.patient)

    @cached_property
    def latest_admission(self):
        from apps.ipd_ward.models import Admission

        return self.current_admission or (
            Admission.objects.filter(patient=self.patient).order_by("-admitted_at").first()
        )

    @cached_property
    def intake(self):
        from apps.care_pathway.intake import latest_signed

        return latest_signed(self.patient)

    def intake_value(self, section, key):
        intake = self.intake
        if not intake:
            return None, None
        return (intake.sections or {}).get(section, {}).get(key), intake

    @cached_property
    def branch(self):
        if self.episode and self.episode.branch_id:
            return self.episode.branch
        return getattr(self.author, "primary_branch", None)

    @cached_property
    def active_alerts(self):
        from apps.care_pathway.models import ClinicalAlert

        return list(ClinicalAlert.objects.filter(patient=self.patient, status="ACTIVE"))

    @cached_property
    def latest_triage(self):
        from apps.care_pathway.services import latest_signed_triage

        return latest_signed_triage(self.patient)

    @cached_property
    def has_current_risk(self):
        triage = self.latest_triage
        intake = self.intake
        return bool(
            self.active_alerts
            or (triage and triage.priority in ("RED", "ORANGE"))
            or (intake and intake.risk_level)
        )

    @cached_property
    def active_prescription_items(self):
        from apps.clinical_encounter.models import PrescriptionItem

        return list(
            PrescriptionItem.objects.filter(prescription__encounter__patient=self.patient)
            .select_related("drug", "prescription__prescribed_by")
            .order_by("-prescription__prescribed_at")
        )


# ── Resolvers ──


def _full_name(ctx):
    return _v(
        ctx.patient.get_full_name(),
        PREVIOUS_RECORD,
        ctx.patient.registered_at,
        "client_registry.Patient",
    )


def _dob(ctx):
    p = ctx.patient
    return _v(_date(p.date_of_birth), PREVIOUS_RECORD, p.registered_at, "client_registry.Patient")


def _citramac(ctx):
    return _v(
        ctx.patient.citramac_number,
        PREVIOUS_RECORD,
        ctx.patient.registered_at,
        "client_registry.Patient",
    )


def _mrn(ctx):
    return _v(
        ctx.patient.uhid_number,
        PREVIOUS_RECORD,
        ctx.patient.registered_at,
        "client_registry.Patient",
    )


def _contact(ctx):
    p = ctx.patient
    parts = [x for x in (p.contact_phone, p.contact_email, p.address) if x]
    return _v(parts, CLIENT_REPORT, p.registered_at, "client_registry.Patient")


def _occupation(ctx):
    p = ctx.patient
    return _v(p.occupation, CLIENT_REPORT, p.registered_at, "client_registry.Patient")


def _current_study(ctx):
    value, intake = ctx.intake_value("edu", "education")
    return _v(
        value,
        CLIENT_REPORT,
        intake and intake.signed_at,
        f"care_pathway.IntakeAssessment v{intake.version}" if intake else "",
    )


def _episode_start(ctx):
    e = ctx.episode
    return e and _v(
        _date(e.period_start), PREVIOUS_RECORD, e.period_start, "care_pathway.EpisodeOfCare"
    )


def _episode_end(ctx):
    e = ctx.episode
    return e and _v(
        _date(e.period_end), PREVIOUS_RECORD, e.period_end, "care_pathway.EpisodeOfCare"
    )


def _attendance_summary(ctx):
    from apps.client_registry.models import Appointment
    from apps.clinical_encounter.models import Encounter

    episode = ctx.episode
    encounters = Encounter.objects.filter(patient=ctx.patient)
    if episode:
        encounters = encounters.filter(episode=episode)
    dates = sorted(encounters.values_list("opened_at", flat=True))
    attended = Appointment.objects.filter(
        patient=ctx.patient, status__in=["COMPLETED", "CHECKED_IN"]
    ).count()
    if not dates and not attended:
        return None
    parts = []
    if dates:
        parts.append(f"{len(dates)} recorded contact(s), {_date(dates[0])} to {_date(dates[-1])}")
    if attended:
        parts.append(f"{attended} attended appointment(s)")
    return _v(
        "; ".join(parts),
        PREVIOUS_RECORD,
        dates[-1] if dates else None,
        "clinical_encounter.Encounter / client_registry.Appointment",
    )


def _attended_appointments(ctx):
    from apps.client_registry.models import Appointment

    rows = Appointment.objects.filter(
        patient=ctx.patient, status__in=["COMPLETED", "CHECKED_IN"]
    ).order_by("-scheduled_for")[:20]
    items = [
        f"{_date(a.scheduled_for)} — {a.appointment_type or a.get_mode_display()}" for a in rows
    ]
    return _v(
        items,
        PREVIOUS_RECORD,
        rows[0].scheduled_for if rows else None,
        "client_registry.Appointment",
    )


def _admitted_at(ctx):
    a = ctx.current_admission or ctx.latest_admission
    return a and _v(_date(a.admitted_at), PREVIOUS_RECORD, a.admitted_at, "ipd_ward.Admission")


def _discharged_at(ctx):
    a = ctx.latest_admission
    if not a or not a.discharged_at:
        return None
    return _v(_date(a.discharged_at), PREVIOUS_RECORD, a.discharged_at, "ipd_ward.Admission")


def _ward(ctx):
    a = ctx.current_admission
    if not a or not a.bed_id:
        return None
    return _v(a.bed.ward.name, PREVIOUS_RECORD, a.admitted_at, "ipd_ward.Admission")


def _legal_status(ctx):
    a = ctx.current_admission or ctx.latest_admission
    if not a or not a.admission_type:
        return None
    return _v(a.get_admission_type_display(), PREVIOUS_RECORD, a.admitted_at, "ipd_ward.Admission")


def _intake_select(section, key, valueset, source=CLINICIAN_OBSERVATION):
    def resolve(ctx):
        value, intake = ctx.intake_value(section, key)
        if not value:
            return None
        display = _concept(valueset, value) if valueset else value
        return _v(
            display, source, intake.signed_at, f"care_pathway.IntakeAssessment v{intake.version}"
        )

    return resolve


def _presenting(ctx):
    intake = ctx.intake
    if not intake:
        return None
    value = (intake.sections or {}).get("pres", {}).get("own") or intake.presenting_concern
    return _v(
        value, CLIENT_REPORT, intake.signed_at, f"care_pathway.IntakeAssessment v{intake.version}"
    )


def _impression(ctx):
    intake = ctx.intake
    if not intake:
        return None
    return _v(
        intake.formulation,
        CLINICIAN_OBSERVATION,
        intake.signed_at,
        f"care_pathway.IntakeAssessment v{intake.version}",
    )


def _diagnoses(ctx):
    from apps.clinical_encounter.models import DiagnosisCode

    rows = list(
        DiagnosisCode.objects.filter(encounter__patient=ctx.patient, status="ACTIVE")
        .select_related("icd11_code")
        .order_by("-is_primary", "-noted_at")
    )
    items = [
        f"{d.icd11_code.description} (ICD-11 {d.icd11_code_id})"
        + (" — primary" if d.is_primary else "")
        for d in rows
    ]
    return _v(
        items,
        CLINICIAN_OBSERVATION,
        rows[0].noted_at if rows else None,
        "clinical_encounter.DiagnosisCode",
    )


def _medications(ctx):
    rows = ctx.active_prescription_items
    items = []
    for item in rows:
        sig = " ".join(x for x in (item.dose, item.route, item.frequency) if x)
        line = f"{item.drug.generic_name} {item.drug.strength}".strip() + (
            f" — {sig}" if sig else ""
        )
        if item.indication:
            line += f" (for {item.indication})"
        items.append(line)
    return _v(
        items,
        PREVIOUS_RECORD,
        rows[0].prescription.prescribed_at if rows else None,
        "clinical_encounter.PrescriptionItem",
    )


def _medication_history(ctx):
    from apps.care_pathway.models import MedicationHistoryEntry

    rows = list(MedicationHistoryEntry.objects.filter(patient=ctx.patient).order_by("-created_at"))
    items = [
        f"{m.name} {m.dose} {m.frequency} — {m.get_status_display()}".replace("  ", " ")
        for m in rows
    ]
    return _v(
        items,
        CLIENT_REPORT,
        rows[0].created_at if rows else None,
        "care_pathway.MedicationHistoryEntry",
    )


def _mar(ctx):
    from apps.ipd_ward.models import MedicationAdministration

    rows = list(
        MedicationAdministration.objects.filter(admission__patient=ctx.patient)
        .select_related("prescription_item__drug", "administered_by")
        .order_by("-scheduled_time")[:30]
    )
    items = [
        f"{_date(r.scheduled_time)} {r.scheduled_time:%H:%M} — "
        f"{r.prescription_item.drug.generic_name if r.prescription_item_id else 'Medication'}: "
        f"{r.get_status_display()}"
        + (f" by {_user(r.administered_by)}" if r.administered_by_id else "")
        for r in rows
    ]
    return _v(
        items,
        CLINICIAN_OBSERVATION,
        rows[0].scheduled_time if rows else None,
        "ipd_ward.MedicationAdministration",
    )


def _allergies(ctx):
    from apps.care_pathway.services import allergy_banner

    banner = allergy_banner(ctx.patient)
    p = ctx.patient
    if banner["state"] == "none":
        return _v(
            ["No known allergies (recorded)"],
            PREVIOUS_RECORD,
            p.allergy_confirmed_at,
            "client_registry.Patient",
        )
    if banner["state"] == "unknown":
        return _v(
            ["Allergy status not yet assessed"], PREVIOUS_RECORD, None, "client_registry.Patient"
        )
    items = [
        f"{a['substance']}"
        + (f" — {a['reaction']}" if a["reaction"] else "")
        + f" ({a['verification_status'].lower()})"
        for a in banner["items"]
    ]
    return _v(items, PREVIOUS_RECORD, p.allergy_confirmed_at, "client_registry.AllergyRecord")


def _triage_priority(ctx):
    t = ctx.latest_triage
    if not t or not t.priority:
        return None
    from apps.care_pathway.models import PRIORITY_CHOICES

    return _v(
        f"{t.priority} — {dict(PRIORITY_CHOICES).get(t.priority, '')}".strip(" —"),
        CLINICIAN_OBSERVATION,
        t.last_triaged_at,
        "care_pathway.TriageEncounter",
    )


def _alerts(ctx):
    rows = ctx.active_alerts
    return _v(
        [a.label for a in rows],
        CLINICIAN_OBSERVATION,
        rows[0].raised_at if rows else None,
        "care_pathway.ClinicalAlert",
    )


def _intake_risk(ctx):
    intake = ctx.intake
    if not intake or not intake.risk_level:
        return None
    return _v(
        intake.get_risk_level_display(),
        CLINICIAN_OBSERVATION,
        intake.signed_at,
        f"care_pathway.IntakeAssessment v{intake.version}",
    )


def _assessments_latest(ctx):
    from apps.care_pathway.models import OutcomeScore

    latest = {}
    rows = OutcomeScore.objects.filter(patient=ctx.patient).order_by("-created_at")
    for score in rows:
        latest.setdefault(score.instrument, score)
    items = [
        f"{s.get_instrument_display()}: {s.score} ({_date(s.created_at)})" for s in latest.values()
    ]
    first = next(iter(latest.values()), None)
    return _v(
        items, ASSESSMENT_RESULT, first.created_at if first else None, "care_pathway.OutcomeScore"
    )


def _assessments_series(ctx):
    from apps.care_pathway.models import OutcomeScore

    rows = list(
        OutcomeScore.objects.filter(patient=ctx.patient).order_by("instrument", "created_at")
    )
    items = [f"{s.get_instrument_display()} {_date(s.created_at)}: {s.score}" for s in rows]
    return _v(
        items, ASSESSMENT_RESULT, rows[-1].created_at if rows else None, "care_pathway.OutcomeScore"
    )


def _lab_line(r):
    flag = (
        " — CRITICAL"
        if r.interpretation == "CRITICAL"
        else (" — abnormal" if r.is_abnormal else "")
    )
    rr = f" (ref {r.reference_range})" if r.reference_range else ""
    return (
        f"{r.lab_order.loinc_code.description} (LOINC {r.lab_order.loinc_code_id}): "
        f"{r.result_value} {r.unit}".rstrip()
        + rr
        + f", {_date(r.recorded_at)}"
        + flag
    )


def _lab_results(ctx, codes=None):
    from apps.lims.models import LabResult

    rows = (
        LabResult.objects.filter(lab_order__encounter__patient=ctx.patient, is_validated=True)
        .select_related("lab_order__loinc_code")
        .order_by("-recorded_at")
    )
    if codes is not None:
        rows = rows.filter(lab_order__loinc_code_id__in=codes)
    rows = list(rows[:20])
    return _v(
        [_lab_line(r) for r in rows],
        MEASUREMENT,
        rows[0].recorded_at if rows else None,
        "lims.LabResult",
    )


def _lab_open_orders(ctx):
    from apps.lims.models import LabOrder

    rows = list(
        LabOrder.objects.filter(encounter__patient=ctx.patient)
        .exclude(status__in=["RESULT_VALIDATED", "CANCELLED"])
        .select_related("loinc_code")
        .order_by("-ordered_at")
    )
    items = [
        f"{o.loinc_code.description} (LOINC {o.loinc_code_id}) — ordered {_date(o.ordered_at)}"
        for o in rows
    ]
    return _v(items, PREVIOUS_RECORD, rows[0].ordered_at if rows else None, "lims.LabOrder")


def _lab_abnormal(ctx):
    from apps.care_pathway.labs import unacknowledged_abnormal

    rows = list(unacknowledged_abnormal(ctx.patient))
    return _v(
        [_lab_line(r) for r in rows],
        MEASUREMENT,
        rows[0].recorded_at if rows else None,
        "lims.LabResult",
    )


def _substance(ctx):
    intake = ctx.intake
    if not intake:
        return None
    subs = (intake.sections or {}).get("subs", {})
    items = []
    if subs.get("kind"):
        items.append(f"Main substance: {_concept('intake-substance-kind', subs['kind'])}")
    for card in subs.get("substances") or []:
        name = _concept("intake-substance-rows", card.get("substance"))
        current = (
            _concept("intake-substance-current", card.get("current")) if card.get("current") else ""
        )
        items.append(
            f"{name}"
            + (f" — {current}" if current else "")
            + (f"; {card['amount']}" if card.get("amount") else "")
        )
    return _v(
        items, CLIENT_REPORT, intake.signed_at, f"care_pathway.IntakeAssessment v{intake.version}"
    )


def _care_plan(ctx):
    from apps.care_pathway.models import CarePlan

    episode = ctx.episode
    qs = CarePlan.objects.filter(patient=ctx.patient)
    if episode:
        qs = qs.filter(episode=episode)
    return qs.order_by("-updated_at").first()


def _plan_goals(ctx):
    plan = _care_plan(ctx)
    return plan and _v(
        plan.goals,
        CLINICIAN_OBSERVATION,
        plan.confirmed_at or plan.updated_at,
        "care_pathway.CarePlan",
    )


def _plan_activities(ctx):
    plan = _care_plan(ctx)
    if not plan:
        return None
    rows = list(plan.activities.all())
    items = [f"{a.title} — {a.get_status_display()}" for a in rows]
    return _v(items, CLINICIAN_OBSERVATION, plan.updated_at, "care_pathway.CarePlanActivity")


def _plan_review(ctx):
    plan = _care_plan(ctx)
    return (
        plan
        and plan.review_date
        and _v(
            _date(plan.review_date), CLINICIAN_OBSERVATION, plan.updated_at, "care_pathway.CarePlan"
        )
    )


def _safety_plan(ctx):
    from apps.care_pathway.models import SafetyPlan

    plan = SafetyPlan.objects.filter(patient=ctx.patient).order_by("-version").first()
    if not plan:
        return None
    labels = [
        ("warning_signs", "Warning signs"),
        ("coping", "Things I can do"),
        ("places_people_distract", "People and places that distract"),
        ("people_to_ask", "People I can ask for help"),
        ("professionals", "Professionals / services"),
        ("safer_surroundings", "Making surroundings safer"),
        ("reasons_for_living", "Reasons for living"),
    ]
    items = [f"{label}: {getattr(plan, field)}" for field, label in labels if getattr(plan, field)]
    return _v(items, CLIENT_REPORT, plan.updated_at, f"care_pathway.SafetyPlan v{plan.version}")


def _discharge(ctx):
    from apps.care_pathway.models import DischargeSummary

    summary = (
        DischargeSummary.objects.filter(patient=ctx.patient, status="COMPLETED")
        .order_by("-version", "-created_at")
        .first()
    )
    if not summary:
        return None
    items = [f"Discharged {_date(summary.discharged_at)}"]
    if summary.disposition:
        items.append(f"Disposition: {summary.disposition.replace('_', ' ').title()}")
    if summary.destination:
        items.append(f"Destination: {summary.destination}")
    if summary.treatment_summary:
        items.append(f"Treatment summary: {summary.treatment_summary}")
    return _v(
        items,
        CLINICIAN_OBSERVATION,
        summary.discharged_at,
        f"care_pathway.DischargeSummary v{summary.version}",
    )


def _capacity(ctx):
    from apps.care_pathway.models import CapacityAssessment

    c = CapacityAssessment.objects.filter(patient=ctx.patient).order_by("-assessed_at").first()
    if not c:
        return None
    items = [
        f"Decision: {c.other_decision or c.decision}",
        f"Outcome: {c.outcome}",
        f"Understand {c.understand}; retain {c.retain}; weigh {c.weigh}; "
        f"communicate {c.communicate}",
    ]
    if c.reassess_by:
        items.append(f"Reassess by {_date(c.reassess_by)}")
    return _v(items, CLINICIAN_OBSERVATION, c.assessed_at, "care_pathway.CapacityAssessment")


def _consents(ctx):
    from apps.client_registry.models import ConsentRecord

    latest = {}
    for record in ConsentRecord.objects.filter(patient=ctx.patient).order_by("-captured_at"):
        latest.setdefault(record.consent_type, record)
    items = [
        f"{r.get_consent_type_display()}: {r.get_decision_display()} "
        f"({_date(r.captured_at)})" + (f" — {r.recipient}" if r.recipient else "")
        for r in latest.values()
    ]
    first = next(iter(latest.values()), None)
    return _v(
        items, CLIENT_REPORT, first.captured_at if first else None, "client_registry.ConsentRecord"
    )


def _family(ctx):
    from apps.client_registry.models import EmergencyContact

    rows = list(EmergencyContact.objects.filter(patient=ctx.patient))
    items = [
        f"{c.name}"
        + (f" ({c.relationship})" if c.relationship else "")
        + (f" — {c.phone}" if c.phone else "")
        for c in rows
    ]
    return _v(items, CLIENT_REPORT, None, "client_registry.EmergencyContact")


def _insurance(ctx):
    from apps.client_registry.models import InsuranceCoverage

    rows = list(InsuranceCoverage.objects.filter(patient=ctx.patient))
    items = [
        f"{c.get_scheme_type_display()}"
        + (f" — policy {c.policy_number}" if c.policy_number else "")
        for c in rows
    ]
    return _v(items, CLIENT_REPORT, None, "client_registry.InsuranceCoverage")


def _appointments_upcoming(ctx):
    from django.utils import timezone

    from apps.client_registry.models import Appointment

    rows = list(
        Appointment.objects.filter(
            patient=ctx.patient, status="SCHEDULED", scheduled_for__gte=timezone.now()
        )
        .select_related("provider")
        .order_by("scheduled_for")[:10]
    )
    items = [
        f"{_date(a.scheduled_for)} {a.scheduled_for:%H:%M} — "
        f"{a.appointment_type or a.get_mode_display()}"
        + (f" with {_user(a.provider)}" if a.provider_id else "")
        + (f", {a.location}" if a.location else "")
        for a in rows
    ]
    return _v(items, PREVIOUS_RECORD, None, "client_registry.Appointment")


def _appointments_missed(ctx):
    from apps.client_registry.models import Appointment

    rows = list(
        Appointment.objects.filter(patient=ctx.patient, status="NO_SHOW").order_by(
            "-scheduled_for"
        )[:10]
    )
    items = [
        f"{_date(a.scheduled_for)} — {a.appointment_type or a.get_mode_display()}" for a in rows
    ]
    return _v(
        items,
        PREVIOUS_RECORD,
        rows[0].scheduled_for if rows else None,
        "client_registry.Appointment",
    )


def _status_history(ctx):
    from apps.care_pathway.models import EpisodeStatusHistory

    if not ctx.episode:
        return None
    rows = list(EpisodeStatusHistory.objects.filter(episode=ctx.episode).order_by("period_start"))
    items = [f"{_date(h.period_start)} — {h.get_status_display()}" for h in rows]
    return _v(
        items,
        PREVIOUS_RECORD,
        rows[-1].period_start if rows else None,
        "care_pathway.EpisodeStatusHistory",
    )


def _encounters(ctx):
    from apps.clinical_encounter.models import Encounter

    qs = Encounter.objects.filter(patient=ctx.patient)
    if ctx.episode:
        qs = qs.filter(episode=ctx.episode)
    rows = list(qs.order_by("opened_at")[:50])
    items = [f"{_date(e.opened_at)} — {e.encounter_type or 'Encounter'}" for e in rows]
    return _v(
        items, PREVIOUS_RECORD, rows[-1].opened_at if rows else None, "clinical_encounter.Encounter"
    )


def _author_name(ctx):
    return _v(_user(ctx.author), PREVIOUS_RECORD, None, "accounts.User")


def _author_credentials(ctx):
    """Role names only. VERIFY: the user profile holds no professional
    registration number / council licence — DOC-GOV-05 credentials are the
    user's CITRAMAC roles until that is added."""
    roles = sorted(ctx.author.roles.values_list("name", flat=True)) if ctx.author else []
    return _v(", ".join(roles), PREVIOUS_RECORD, None, "accounts.Role")


def _facility_name(ctx):
    return _v(ctx.organization.name, PREVIOUS_RECORD, None, "tenancy.Organization")


def _facility_branch(ctx):
    b = ctx.branch
    return b and _v(b.name, PREVIOUS_RECORD, None, "tenancy.Branch")


def _facility_address(ctx):
    b = ctx.branch
    parts = [
        x
        for x in ((b.address if b else ""), (b.county if b else "") or ctx.organization.county)
        if x
    ]
    return _v(", ".join(parts), PREVIOUS_RECORD, None, "tenancy.Branch")


def _facility_phone(ctx):
    b = ctx.branch
    return _v(
        (b.phone if b else "") or ctx.organization.support_phone,
        PREVIOUS_RECORD,
        None,
        "tenancy.Branch",
    )


def _facility_email(ctx):
    b = ctx.branch
    return _v(
        (b.email if b else "") or ctx.organization.support_email,
        PREVIOUS_RECORD,
        None,
        "tenancy.Branch",
    )


def _b(cls, label, resolve):
    return {"class": cls, "label": label, "resolve": resolve}


BINDINGS = {
    "patient.full_name": _b("IDENTITY", "Name", _full_name),
    "patient.date_of_birth": _b("IDENTITY", "Date of birth", _dob),
    "patient.citramac_number": _b("IDENTITY", "CITRAMAC number", _citramac),
    "patient.mrn": _b("IDENTITY", "MRN / UHID", _mrn),
    "patient.contact": _b("CONTACT", "Contact details", _contact),
    "patient.occupation": _b("OCCUPATION", "Occupation", _occupation),
    "intake.current_study": _b("OCCUPATION", "Current study / institution", _current_study),
    "episode.period_start": _b("ADMINISTRATIVE", "In care since", _episode_start),
    "episode.period_end": _b("ADMINISTRATIVE", "Care ended", _episode_end),
    "attendance.summary": _b("ADMINISTRATIVE", "Attendance", _attendance_summary),
    "appointments.attended": _b("ADMINISTRATIVE", "Attended appointments", _attended_appointments),
    "encounters.recent": _b("ADMINISTRATIVE", "Contacts in this episode", _encounters),
    "episode.status_history": _b("ADMINISTRATIVE", "Episode status history", _status_history),
    "admission.admitted_at": _b("ADMISSION", "Admitted", _admitted_at),
    "admission.discharged_at": _b("ADMISSION", "Discharged", _discharged_at),
    "admission.ward": _b("ADMISSION", "Ward", _ward),
    "admission.legal_status": _b("LEGAL_STATUS", "Admission legal status", _legal_status),
    "intake.work_function": _b(
        "FUNCTIONAL",
        "Work / school functioning",
        _intake_select("sx", "work", "intake-work-function"),
    ),
    "intake.study_work_impact": _b(
        "FUNCTIONAL", "Impact on work / study", _intake_select("edu", "impact", None)
    ),
    "intake.self_care": _b("FUNCTIONAL", "Self-care", _intake_select("sx", "adl", "intake-adl")),
    "intake.social_function": _b(
        "FUNCTIONAL", "Social functioning", _intake_select("sx", "social", "intake-social-function")
    ),
    "intake.presenting_concern": _b("CLINICAL_SUMMARY", "Presenting concern", _presenting),
    "intake.clinical_impression": _b("CLINICAL_SUMMARY", "Formulation", _impression),
    "diagnoses.active": _b("DIAGNOSIS", "Active diagnoses", _diagnoses),
    "medications.active": _b("MEDICATION", "Prescribed medications", _medications),
    "medications.history": _b(
        "MEDICATION", "Medication history (client report)", _medication_history
    ),
    "mar.recent": _b("MEDICATION", "Medication administration (recent)", _mar),
    "allergies.current": _b("ALLERGY", "Allergies", _allergies),
    "risk.triage_priority": _b("RISK", "Triage priority", _triage_priority),
    "risk.active_alerts": _b("RISK", "Active clinical alerts", _alerts),
    "risk.intake_level": _b("RISK", "Intake risk level", _intake_risk),
    "assessments.latest": _b("ASSESSMENTS", "Latest assessment scores", _assessments_latest),
    "assessments.series": _b("ASSESSMENTS", "Outcome measures over time", _assessments_series),
    "labs.recent_results": _b("INVESTIGATIONS", "Recent validated results", _lab_results),
    "labs.open_orders": _b("INVESTIGATIONS", "Tests ordered", _lab_open_orders),
    "labs.unacknowledged_abnormal": _b(
        "INVESTIGATIONS", "Abnormal results awaiting action", _lab_abnormal
    ),
    "substance.intake_summary": _b("SUBSTANCE_USE", "Substance use (intake)", _substance),
    "careplan.goals": _b("TREATMENT_PLAN", "Goals", _plan_goals),
    "careplan.activities": _b("TREATMENT_PLAN", "Planned care", _plan_activities),
    "careplan.review_date": _b("TREATMENT_PLAN", "Plan review date", _plan_review),
    "safetyplan.latest": _b("SAFETY_PLAN", "Safety plan", _safety_plan),
    "discharge.latest": _b("DISCHARGE", "Discharge", _discharge),
    "capacity.latest": _b("CAPACITY", "Latest capacity assessment", _capacity),
    "consents.current": _b("CONSENT", "Consent decisions on record", _consents),
    "family.contacts": _b("FAMILY", "Family / next of kin", _family),
    "insurance.coverage": _b("INSURANCE", "Cover", _insurance),
    "appointments.upcoming": _b("APPOINTMENTS", "Upcoming appointments", _appointments_upcoming),
    "appointments.missed": _b("APPOINTMENTS", "Missed appointments", _appointments_missed),
    "author.name": _b("CLINICIAN", "Author", _author_name),
    "author.credentials": _b("CLINICIAN", "Author role(s)", _author_credentials),
    "facility.name": _b("FACILITY", "Facility", _facility_name),
    "facility.branch": _b("FACILITY", "Branch", _facility_branch),
    "facility.address": _b("FACILITY", "Address", _facility_address),
    "facility.phone": _b("FACILITY", "Telephone", _facility_phone),
    "facility.email": _b("FACILITY", "Email", _facility_email),
}


def monitoring_codes_for(drug_code):
    """CI-07: investigations configured for a medication (LOINC codes). Facility
    configuration only — no monitoring schedule is shipped in code."""
    return list(settings.DOC_MEDICATION_MONITORING.get(drug_code, []))


def lab_results_for_codes(ctx, codes):
    return _lab_results(ctx, codes)
