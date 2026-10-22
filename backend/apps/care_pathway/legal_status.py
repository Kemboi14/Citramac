"""
Legal admission status — business logic (master prompt §7A: LGL-DATA, LGL-V,
LGL-V-WF, LGL-I, LGL-R, LGL-WF, LGL-DOC). Models and the FHIR mapping are in
legal_models.py; statutory wording, notice period and maximum duration come from
versioned jurisdiction config (legal_config.py), never from code.

Documented assumptions (open questions in the master prompt, kept as written):
- OQ-12 each form's citations rendered as printed, from config.
- OQ-13 one canonical facility address — whatever the tenant facility profile
  (Branch → Organization) holds; nothing about a specific facility is in code.
- OQ-14 applicant-signature and decision timestamps are added automatically.
- OQ-15 a client under the configured age cannot self-apply; the voluntary
  application is then signed by a guardian and recorded as guardian consent.
- OQ-16 a risk alert during a notice period prompts "Clinical review of legal
  status required" — never an automatic conversion to involuntary.
- OQ-17 ADMITTED on an involuntary application needs the signed recommendation(s).
- OQ-18 a required clinical-grounds narrative per Declaration 3 ground.
- OQ-19 Declarations 3 and 4 rendered verbatim, both.
- OQ-20 "he/she" from the client's recorded pronouns, else "they".
- OQ-21 the recommendation form's Admitted/Rejected is a read-only mirror.
- OQ-22 required recommendation count from config (default 1).
- OQ-23 rights Task added; rights text from config only (empty until supplied).
- OQ-24 identity numbers masked except for the unmask permission; every
  unmasked view logged.
- maxExpiryAt = the earlier of effectiveFrom and the earliest recommendation
  signature date, plus the configured maximum (LGL-DATA says recommendation
  date, LGL-R-06 says effectiveFrom; the earlier is never longer than either).
- Renewal of an involuntary status is not implemented: the statutory renewal
  process was not supplied (VERIFY). An expired status raises an alert.
"""

import calendar
import re
from datetime import datetime, timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.client_registry.models import Attachment, EmergencyContact, PatientIdentifier
from apps.clinical_encounter.models import DiagnosisCode, Encounter

from . import facility_time, legal_config
from .legal_config import LEGAL_ALERT_LABELS
from .legal_models import (
    INVOLUNTARY_APPLICATION_TEMPLATE,
    NOTICE_TEMPLATE,
    RECOMMENDATION_TEMPLATE,
    VOLUNTARY_TEMPLATE,
    DischargeNotice,
    LegalDocument,
    LegalStatus,
    LegalStatusEvent,
)
from .models import (
    CapacityAssessment,
    CareTask,
    ClinicalAlert,
    LocalConcept,
    TriageAssessment,
    VisitConsent,
)

ADMITTING_OFFICER_PERMISSION = "clinical.admitting_officer"
APPLICATION_TEMPLATES = {"VOLUNTARY": VOLUNTARY_TEMPLATE, "INVOLUNTARY": INVOLUNTARY_APPLICATION_TEMPLATE}
TEMPLATE_CATEGORY = {v: k for k, v in APPLICATION_TEMPLATES.items()}
E164 = re.compile(r"^\+[1-9]\d{7,14}$")
TASK_FOCUS = "LegalStatus"
TASK_RIGHTS = "legal_rights_informed"
TASK_EXPIRY_REVIEW = "legal_expiry_review"
TASK_NOTICE_REVIEW = "legal_notice_psych_review"
TASK_NOTICE_DISCHARGE = "legal_notice_discharge_planning"
TASK_LEGAL_REVIEW = "legal_status_clinical_review"
RISK_REVIEW_PROMPT = "Clinical review of legal status required"
CAPACITY_PROMPT = "Capacity to consent to voluntary admission — clinician confirmation required"
SOURCE_CODES = {
    "Client report": "CLIENT_REPORT",
    "Clinician observation": "CLINICIAN_OBSERVATION",
    "Third-party report": "THIRD_PARTY_REPORT",
    "Measured result": "MEASUREMENT",
}
LEGAL_ALERT_CODES = set(LEGAL_ALERT_LABELS)


# ── small helpers ──


def _name(user):
    if not user:
        return ""
    return f"{user.first_name} {user.last_name}".strip() or user.email


def _role(user):
    if not user:
        return ""
    if user.is_superuser:
        return "Super Admin"
    return ", ".join(user.roles.values_list("name", flat=True))


def _iso(value):
    return value.isoformat() if value else None


def add_months(moment, months):
    month_index = moment.month - 1 + months
    year, month = moment.year + month_index // 12, month_index % 12 + 1
    day = min(moment.day, calendar.monthrange(year, month)[1])
    return moment.replace(year=year, month=month, day=day)


def mask(value):
    value = (value or "").strip()
    if not value:
        return ""
    return "•" * max(len(value) - 3, 3) + value[-3:]


def is_admitting_officer(user):
    return bool(
        user and user.is_authenticated and not user.is_superuser
        and user.roles.filter(permissions__codename=ADMITTING_OFFICER_PERMISSION).exists()
    )


def can_unmask(user):
    codename = legal_config.privacy()["unmaskPermission"]
    return bool(
        user and user.is_authenticated and not user.is_superuser
        and user.roles.filter(permissions__codename=codename).exists()
    )


def credential_status(user):
    """LGL-R-02 credential gate: a verified registration AND the MHA_RECOMMENDATION_APPROVED flag."""
    from apps.accounts.models import PractitionerCredential

    cred = PractitionerCredential.objects.filter(user=user).first() if user else None
    out = {
        "name": _name(user),
        "registration_number": cred.registration_number if cred else "",
        "registration_body": cred.registration_body if cred else "",
        "registration_verified_at": _iso(cred.registration_verified_at) if cred else None,
        "qualifications": cred.qualifications if cred else "",
        "mha_recommendation_approved": bool(cred and cred.mha_recommendation_approved),
        "can_sign": False,
        "reason": "",
    }
    if cred is None or not cred.registration_verified:
        out["reason"] = (
            "Your practitioner profile has no verified registration number. "
            "An organisation administrator must record and verify it before you can make a recommendation."
        )
    elif not cred.mha_recommendation_approved:
        out["reason"] = (
            "Your practitioner profile is not marked as approved to make recommendations under the "
            "Mental Health Act (MHA_RECOMMENDATION_APPROVED)."
        )
    else:
        out["can_sign"] = True
    return out


def _event(ls, event, user, from_state="", to_state="", **detail):
    from apps.sysadmin_audit.audit import write_event

    LegalStatusEvent.objects.create(
        organization_id=ls.organization_id, legal_status=ls, event=event,
        from_state=from_state, to_state=to_state, actor=user, actor_role=_role(user), detail=detail,
    )
    write_event(ls.organization_id, "UPDATE", "care_pathway.legalstatus", ls.pk,
                {"legal_event": event, "from": from_state, "to": to_state})


def _transition(ls, to_state, user, event=None, **detail):
    from_state = ls.workflow_state
    ls.workflow_state = to_state
    ls.save()
    _event(ls, event or to_state, user, from_state, to_state, **detail)


def _alert(patient, code, user):
    alert = ClinicalAlert.objects.filter(patient=patient, alert_code=code, status="ACTIVE").first()
    if alert:
        return alert
    return ClinicalAlert.objects.create(
        organization_id=patient.organization_id, patient=patient, alert_code=code,
        label=LEGAL_ALERT_LABELS[code], raised_by=user,
    )


def _resolve_alert(patient, code, user):
    ClinicalAlert.objects.filter(patient=patient, alert_code=code, status="ACTIVE").update(
        status="RESOLVED", resolved_at=timezone.now(), resolved_by=user
    )


def _task(ls, code, label, user, *, due_at=None, priority="routine", assignee=None, owner=""):
    return CareTask.objects.create(
        organization_id=ls.organization_id, patient=ls.patient, action_code=code, action_label=label,
        owner=owner or (_name(assignee) if assignee else "Responsible clinician"), status="INITIATED",
        created_by=user, priority=priority, due_at=due_at, assignee=assignee,
        focus_type=TASK_FOCUS, focus_id=str(ls.pk),
    )


def _open_task(ls, code):
    return CareTask.objects.filter(
        focus_type=TASK_FOCUS, focus_id=str(ls.pk), action_code=code, completed_at__isnull=True
    ).first()


def responsible_psychiatrist(patient):
    from .services import current_admission

    admission = current_admission(patient)
    if admission and admission.consultant_id:
        return admission.consultant
    return patient.doctor


# ── client, applicant, facility ──


def pronoun(patient):
    return {"SHE_HER": "she", "HE_HIM": "he"}.get(patient.pronouns, "they")


def client_details(patient, user=None):
    """Part A / LGL-V-03 fields, auto-populated from the central client record (RULE-01)."""
    id_value = patient.national_id or patient.passport_number
    id_kind = "National ID" if patient.national_id else ("Passport" if patient.passport_number else "")
    return {
        "full_name": patient.get_full_name(),
        "address": patient.address,
        "id_kind": id_kind,
        "id_number_masked": mask(id_value),
        "id_number_present": bool(id_value),
        "gender": patient.gender,
        "gender_form": {"MALE": "MALE", "FEMALE": "FEMALE", "OTHER": "OTHER"}.get(patient.gender, ""),
        "gender_other_detail": "Intersex / other" if patient.gender == "OTHER" else "",
        "pronoun": pronoun(patient),
        "age": patient.age_years,
        "date_of_birth": _iso(patient.date_of_birth),
    }


def related_person_row(person):
    return {
        "id": str(person.pk),
        "name": person.name,
        "relationship": person.relationship,
        "relationship_detail": person.relationship_detail,
        "phone": person.phone,
        "address": person.address,
        "id_number_masked": mask(person.id_number),
        "id_number_present": bool(person.id_number),
        "is_guardian": person.is_guardian,
    }


def facility_profile(patient, episode=None):
    """OQ-13: one canonical facility profile — the tenant's Branch (episode's, else
    its first active one) and Organization. Nothing facility-specific in code."""
    from apps.tenancy.models import Branch, Organization

    org = Organization.objects.filter(pk=patient.organization_id).first()
    branch = episode.branch if episode and episode.branch_id else None
    if branch is None:
        branch = Branch.objects.filter(organization_id=patient.organization_id, is_active=True).order_by("created_at").first()
    return {
        "organization": org.name if org else "",
        "name": branch.name if branch else (org.name if org else ""),
        "address": branch.address if branch else "",
        "county": (branch.county if branch else "") or (org.county if org else ""),
        "phone": (branch.phone if branch else "") or (org.support_phone if org else ""),
        "email": (branch.email if branch else "") or (org.support_email if org else ""),
        "website": org.website if org else "",
        "logo_url": org.logo_url if org else "",
    }


# ── evidence context (LGL-I-A-04, LGL-R-11) and capacity prompt (LGL-V-11) ──


def _latest_signed_triage(patient):
    return (
        TriageAssessment.objects.filter(triage_encounter__patient=patient, status="COMPLETED")
        .select_related("signed_by").order_by("-signed_at").first()
    )


def _intake(patient):
    from . import intake

    return intake.current_draft(patient) or intake.latest_signed(patient)


def evidence_context(patient):
    """Existing findings beside each applicant assertion / recommendation ground.
    Read-only context: nothing here ticks an assertion or alters a finding."""
    from . import intake_schema, mental_state

    groups = {k: [] for k in ("danger_to_self", "danger_to_others", "unable_self_care", "incapable_decisions", "working_diagnosis")}
    triage = _latest_signed_triage(patient)
    if triage:
        by_label = {
            "danger_to_self": {"Suicide risk", "Acting now", "Recent self-harm / attempt", "Access to means"},
            "danger_to_others": {"Risk to others", "Immediate danger"},
            "unable_self_care": {"Functional safety concern"},
        }
        for row in triage.findings or []:
            if not isinstance(row, (list, tuple)) or len(row) < 3:
                continue
            for group, labels in by_label.items():
                if row[0] in labels:
                    groups[group].append({
                        "label": row[0], "value": row[1], "source": SOURCE_CODES.get(row[2], "PREVIOUS_RECORD"),
                        "record": "Triage (signed)", "recorded_at": _iso(triage.signed_at),
                        "recorded_by": _name(triage.signed_by),
                    })
    row = _intake(patient)
    if row:
        record = "Intake (signed)" if row.status == row.STATUS_SIGNED else "Intake (unsigned draft)"
        at = _iso(row.signed_at or row.updated_at)
        by = _name(row.signed_by or row.author)
        rows = ((row.sections or {}).get("risk") or {}).get("rows") or {}
        target = {"suicide": "danger_to_self", "violence": "danger_to_others", "neglect": "unable_self_care"}
        for spec in intake_schema.RISK_ROWS:
            chosen = [o for o in (rows.get(spec["key"]) or []) if o in spec["active"]]
            if chosen and spec["key"] in target:
                groups[target[spec["key"]]].append({
                    "label": spec["label"], "value": ", ".join(chosen), "source": "ASSESSMENT_RESULT",
                    "record": record, "recorded_at": at, "recorded_by": by,
                })
        mse = (row.sections or {}).get("mse") or {}
        for domain, label in (("insight", "Insight"), ("judgment", "Judgement")):
            values = mental_state.codes(mse, domain) if mental_state.is_structured(mse) else (
                [str(mse.get(domain))] if mse.get(domain) else []
            )
            if values:
                groups["incapable_decisions"].append({
                    "label": f"MSE — {label}", "value": ", ".join(values), "source": "CLINICIAN_OBSERVATION",
                    "record": record, "recorded_at": at, "recorded_by": by,
                })
    for dx in DiagnosisCode.objects.filter(encounter__patient=patient, status="ACTIVE").select_related("icd11_code")[:10]:
        groups["working_diagnosis"].append({
            "label": f"{dx.icd11_code.code} {dx.icd11_code.description}".strip(),
            "value": dx.get_verification_status_display() or "Certainty not stated",
            "source": "CLINICIAN_OBSERVATION", "record": "Diagnosis", "recorded_at": _iso(dx.noted_at), "recorded_by": "",
        })
    return groups


def capacity_prompt(patient):
    """LGL-V-11: active findings that put voluntary consent in question. Prompt only."""
    from . import mental_state

    reasons, latest = [], None
    triage = _latest_signed_triage(patient)
    if triage:
        a = triage.answers or {}
        if a.get("b_present") != "no" and a.get("f_consciousness") not in (None, "", "alert"):
            reasons.append(f"Triage: level of consciousness — {a.get('f_consciousness')}")
        if a.get("f_orientation") == "disoriented":
            reasons.append("Triage: disoriented/confused")
        if a.get("g_intoxication") == "severe":
            reasons.append("Triage: severe intoxication")
        if reasons:
            latest = triage.signed_at
    row = _intake(patient)
    if row:
        mse = (row.sections or {}).get("mse") or {}
        found = []
        for key in ("orient_time", "orient_place", "orient_person"):
            if mse.get(key) == "DISORIENTED":
                found.append(f"MSE: disoriented ({key.split('_')[1]})")
        if mental_state.is_structured(mse):
            if set(mental_state.codes(mse, "cognition")) & {"DROWSY", "MEMORY_IMPAIRED"}:
                found.append("MSE: alertness/memory impaired")
            if set(mental_state.codes(mse, "insight")) & {"LIMITED", "ABSENT"}:
                found.append("MSE: insight limited or absent")
        if found:
            reasons.extend(found)
            stamp = row.signed_at or row.updated_at
            latest = max(filter(None, [latest, stamp]))
    return {"required": bool(reasons), "text": CAPACITY_PROMPT if reasons else "", "reasons": reasons, "since": latest}


def capacity_confirmation(patient):
    """The clinician's confirmation is the existing decision-specific capacity
    assessment for ADMISSION (no second store) — the latest one in force."""
    return CapacityAssessment.objects.filter(patient=patient, decision="ADMISSION").order_by("-assessed_at").first()


def active_risk(patient):
    return ClinicalAlert.objects.filter(patient=patient, status="ACTIVE").exclude(alert_code__in=LEGAL_ALERT_CODES).exists()


# ── application lifecycle ──


def _open_episode(patient, user):
    """The episode the legal status belongs to. Admission starts here (legal
    status first), so a registered client without one gets a waitlist episode —
    the same one the admission then joins."""
    from .services import get_or_open_episode

    return get_or_open_episode(patient, user)


def legal_status_for(patient):
    from .services import current_or_latest_episode

    episode = current_or_latest_episode(patient)
    return LegalStatus.objects.filter(episode=episode).first() if episode else None


@transaction.atomic
def start_application(patient, user, category):
    if category not in APPLICATION_TEMPLATES:
        raise ValidationError({"category": "Choose VOLUNTARY or INVOLUNTARY."})
    episode = _open_episode(patient, user)
    template = APPLICATION_TEMPLATES[category]
    ls = LegalStatus.objects.select_for_update().filter(episode=episode).first()
    if ls and ls.pending_application_id:
        pending = ls.pending_application
        if pending.template_id == template and pending.status == "DRAFT":
            return pending
        raise ValidationError({"detail_message": "An application is already awaiting signature or decision for this episode."})
    if ls and ls.status == "ACTIVE" and ls.category == category:
        raise ValidationError({"category": f"The client is already admitted as {ls.get_category_display().lower()}."})
    if ls is None:
        ls = LegalStatus.objects.create(
            organization_id=patient.organization_id, patient=patient, episode=episode,
            config_version=legal_config.version(), category=category,
            statutory_basis=legal_config.statutory_basis(category), created_by=user,
        )
        _event(ls, "CREATED", user, "", "APPLICATION_DRAFT", category=category)
    doc = LegalDocument.objects.create(
        organization_id=patient.organization_id, legal_status=ls, patient=patient, template_id=template,
        config_version=legal_config.version(), created_by=user, content={},
    )
    ls.pending_application = doc
    if ls.status != "ACTIVE":
        # Nothing in force: this application is the one the status now describes.
        ls.category, ls.statutory_basis = category, legal_config.statutory_basis(category)
        ls.decision, ls.decision_by, ls.decision_at, ls.decision_reason, ls.decision_role = "PENDING", None, None, "", ""
        ls.status = "PENDING"
        _transition(ls, "APPLICATION_DRAFT", user, "APPLICATION_STARTED", category=category, document=str(doc.pk))
    else:
        ls.save()
        _event(ls, "CONVERSION_APPLICATION_STARTED", user, ls.workflow_state, ls.workflow_state,
               to_category=category, document=str(doc.pk))
    return doc


def _check_draft(doc):
    if doc.status != "DRAFT":
        raise ValidationError({"detail_message": "This form is signed and cannot be changed. Amend it instead."})


def _validate_phone(phone):
    phone = re.sub(r"[\s-]", "", phone or "")
    if phone and not E164.match(phone):
        raise ValidationError({"applicant_phone": "Enter the phone number in international format, e.g. +2547XXXXXXXX."})
    return phone


def _relationship_codes():
    return set(LocalConcept.objects.filter(valueset_id="next-of-kin-relationship", active=True).values_list("code", flat=True))


def _save_applicant(doc, data):
    """Part B lives on the RelatedPerson (EmergencyContact) — never form-local.
    The existing NOK is reused, never duplicated (AT-28)."""
    patient = doc.patient
    person_id = data.get("applicant_related_person_id")
    person = None
    if person_id:
        person = EmergencyContact.objects.filter(pk=person_id, patient=patient).first()
        if person is None:
            raise ValidationError({"applicant_related_person_id": "That person is not linked to this client."})
    fields = {}
    if "applicant_name" in data:
        fields["name"] = str(data.get("applicant_name") or "").strip()[:255]
    if "applicant_address" in data:
        fields["address"] = str(data.get("applicant_address") or "").strip()
    if "applicant_phone" in data:
        fields["phone"] = _validate_phone(data.get("applicant_phone"))
    if "applicant_relationship" in data:
        code = str(data.get("applicant_relationship") or "")
        if code and code not in _relationship_codes():
            raise ValidationError({"applicant_relationship": "Choose the relationship from the list."})
        fields["relationship"] = code
    if "applicant_relationship_detail" in data:
        fields["relationship_detail"] = str(data.get("applicant_relationship_detail") or "").strip()[:150]
    if str(data.get("applicant_id_number") or "").strip():
        fields["id_number"] = str(data["applicant_id_number"]).strip()[:64]
    if person is None and fields.get("name"):
        person = EmergencyContact.objects.create(organization_id=patient.organization_id, patient=patient, **fields)
    elif person is not None and fields:
        for key, value in fields.items():
            if key == "name" and not value:
                continue
            setattr(person, key, value)
        person.save()
    return person


def _save_client_identity(doc, data, user):
    """LGL-I-A-02/03: a missing ID or gender is captured into the central record."""
    patient = doc.patient
    value = str(data.get("client_id_number") or "").strip()
    if value:
        kind = data.get("client_id_kind") or "NATIONAL_ID"
        if kind not in ("NATIONAL_ID", "PASSPORT"):
            raise ValidationError({"client_id_kind": "Choose National ID or Passport."})
        from apps.client_registry.identity import record_identifier

        if kind == "NATIONAL_ID" and not patient.national_id:
            patient.national_id = value
        elif kind == "PASSPORT" and not patient.passport_number:
            patient.passport_number = value
        else:
            raise ValidationError({"client_id_number": "The client record already holds this identifier; correct it there."})
        record_identifier(patient, getattr(PatientIdentifier, f"KIND_{kind}"), value)
        patient.save()
    gender = data.get("client_gender")
    if gender:
        if gender not in ("MALE", "FEMALE", "OTHER"):
            raise ValidationError({"client_gender": "Choose Male, Female or Other."})
        if patient.gender and patient.gender != "NOT_STATED":
            raise ValidationError({"client_gender": "Gender comes from the client record; update it there."})
        patient.gender = gender
        patient.save()


@transaction.atomic
def save_draft(doc, user, data):
    doc = LegalDocument.objects.select_for_update().get(pk=doc.pk)
    _check_draft(doc)
    content = dict(doc.content or {})
    if doc.template_id == VOLUNTARY_TEMPLATE:
        if "notice_acknowledged" in data:
            if data["notice_acknowledged"]:
                content["notice_acknowledged_at"] = content.get("notice_acknowledged_at") or timezone.now().isoformat()
                content["notice_acknowledged_by"] = _name(user)
            else:
                content.pop("notice_acknowledged_at", None)
                content.pop("notice_acknowledged_by", None)
    elif doc.template_id == INVOLUNTARY_APPLICATION_TEMPLATE:
        if "assertions" in data:
            codes = {a["code"] for a in legal_config.form(doc.template_id, doc.config_version)["assertions"]}
            chosen = [c for c in (data.get("assertions") or []) if c in codes]
            if len(chosen) != len(data.get("assertions") or []):
                raise ValidationError({"assertions": "Choose from the listed statements."})
            content["assertions"] = chosen
        if "other_description" in data:
            content["other_description"] = str(data.get("other_description") or "").strip()
        _save_client_identity(doc, data, user)
        person = _save_applicant(doc, data)
        if person is not None:
            content["applicant_related_person_id"] = str(person.pk)
    elif doc.template_id == RECOMMENDATION_TEMPLATE:
        if "examination_date" in data:
            content["examination_date"] = str(data.get("examination_date") or "")
        if "examination_encounter_id" in data:
            content["examination_encounter_id"] = str(data.get("examination_encounter_id") or "")
        if "grounds" in data:
            grounds = {}
            for code in ("a", "b", "c"):
                g = (data.get("grounds") or {}).get(code) or {}
                grounds[code] = {"affirmed": bool(g.get("affirmed")), "narrative": str(g.get("narrative") or "").strip()}
            content["grounds"] = grounds
    doc.content = content
    doc.save()
    return doc


def _attachment(doc, data):
    att = Attachment.objects.filter(pk=data.get("attachment_id"), patient=doc.patient).first() if data.get("attachment_id") else None
    if att is None:
        raise ValidationError({"attachment_id": "Upload the scanned wet signature to the client's documents and choose it."})
    return att


def _signature(doc, data, user):
    method = data.get("method")
    if method not in ("ELECTRONIC", "WET_SCAN"):
        raise ValidationError({"method": "Choose electronic signature or a scanned wet signature."})
    if method == "WET_SCAN":
        doc.signature_attachment = _attachment(doc, data)
    elif not data.get("attested"):
        raise ValidationError({"attested": "Confirm the signer signed in your presence."})
    doc.signature_method = method
    doc.captured_by = user


def _recommendations(application):
    return LegalDocument.objects.filter(
        application=application, template_id=RECOMMENDATION_TEMPLATE, status="SIGNED", superseded_by__isnull=True
    )


@transaction.atomic
def sign(doc, user, data):
    doc = LegalDocument.objects.select_for_update().get(pk=doc.pk)
    _check_draft(doc)
    ls = LegalStatus.objects.select_for_update().get(pk=doc.legal_status_id)
    patient = doc.patient
    content = doc.content or {}
    now = timezone.now()
    if doc.template_id == VOLUNTARY_TEMPLATE:
        if not content.get("notice_acknowledged_at"):  # AT-21
            raise ValidationError({"notice_acknowledged": "The applicant must acknowledge the Section 10(3) notice before signing."})
        signer_kind = data.get("signer_kind") or "CLIENT"
        minor_age = legal_config.operational(doc.config_version)["minorAgeYears"]
        age = patient.age_years
        if signer_kind == "CLIENT":
            if age is not None and age < minor_age:  # AT-30
                raise ValidationError({
                    "signer_kind": f"The client is under {minor_age}. A minor cannot self-apply; the application "
                    "must be made through the guardian consent workflow.",
                    "route": "GUARDIAN_CONSENT",
                })
            if age is None and not data.get("adult_confirmed"):
                raise ValidationError({"adult_confirmed": "The client's age is not recorded. Confirm the client is an adult, or use the guardian workflow."})
            prompt = capacity_prompt(patient)
            if prompt["required"]:  # LGL-V-11: prompt; a clinician confirmation must be on record
                confirmation = capacity_confirmation(patient)
                if confirmation is None or (prompt["since"] and confirmation.assessed_at < prompt["since"]):
                    raise ValidationError({"capacity": CAPACITY_PROMPT, "reasons": prompt["reasons"]})
                if confirmation.outcome != "Has capacity":
                    raise ValidationError({"capacity": f"The capacity assessment for admission records: {confirmation.outcome}. "
                                           "A voluntary application needs the client's own capacity to consent."})
                content = {**content, "capacity_confirmation": {
                    "assessment_id": str(confirmation.pk), "outcome": confirmation.outcome,
                    "assessed_at": _iso(confirmation.assessed_at), "assessed_by": _name(confirmation.assessed_by),
                    "reasons": prompt["reasons"]}}
            doc.signer_name = patient.get_full_name()
        elif signer_kind == "GUARDIAN":
            person = EmergencyContact.objects.filter(pk=data.get("related_person_id"), patient=patient, is_guardian=True).first()
            if person is None:
                raise ValidationError({"related_person_id": "Choose the client's recorded parent/guardian."})
            doc.signer_related_person, doc.signer_name = person, person.name
            consent = VisitConsent.objects.create(
                organization_id=patient.organization_id, patient=patient, scope="ADMISSION", party="GUARDIAN",
                method=data.get("method", "")[:20], given_by_name=person.name, recorded_by=user,
                warnings=[] if (age is not None and age < minor_age) else ["Guardian consent recorded for a client not recorded as a minor"],
            )
            content = {**content, "guardian_consent_id": str(consent.pk)}
        else:
            raise ValidationError({"signer_kind": "The applicant is the client or their guardian."})
        doc.signer_kind = signer_kind
    elif doc.template_id == INVOLUNTARY_APPLICATION_TEMPLATE:
        person = EmergencyContact.objects.filter(pk=content.get("applicant_related_person_id"), patient=patient).first()
        problems = {}
        if person is None or not person.name.strip():
            problems["applicant_name"] = "Record the applicant (Part B)."
        else:
            if not person.phone or not E164.match(person.phone):
                problems["applicant_phone"] = "Record the applicant's phone number in international format."
            if not person.relationship:
                problems["applicant_relationship"] = "Record the applicant's relationship to the client."
            if not person.address.strip():
                problems["applicant_address"] = "Record the applicant's address."
        if not content.get("assertions"):
            problems["assertions"] = "The applicant must state at least one ground in Part A."
        if "OTHER" in (content.get("assertions") or []) and not content.get("other_description"):
            problems["other_description"] = "Describe the 'Other' ground."
        if problems:
            raise ValidationError(problems)
        doc.signer_kind, doc.signer_related_person, doc.signer_name = "RELATED_PERSON", person, person.name
    elif doc.template_id == RECOMMENDATION_TEMPLATE:
        cred = credential_status(user)
        if not cred["can_sign"]:  # AT-24
            raise PermissionDenied(cred["reason"])
        problems = {}
        try:
            exam = datetime.strptime(content.get("examination_date") or "", "%Y-%m-%d").date()
            if exam > facility_time.local_date():
                problems["examination_date"] = "The examination date cannot be in the future."
        except ValueError:
            exam = None
            problems["examination_date"] = "Record the date you examined the client."
        encounter = Encounter.objects.filter(pk=content.get("examination_encounter_id") or None, patient=patient).first() \
            if content.get("examination_encounter_id") else None
        if encounter is None:
            problems["examination_encounter_id"] = "Link the clinical encounter (MSE / intake / psychiatric review) at which you examined the client."
        grounds = content.get("grounds") or {}
        for code in ("a", "b", "c"):
            g = grounds.get(code) or {}
            if not g.get("affirmed"):
                problems[f"grounds.{code}"] = f"Ground ({code}) must be individually affirmed."
            elif not g.get("narrative"):
                problems[f"grounds.{code}.narrative"] = f"Record the clinical grounds for ({code})."
        if doc.application is None or doc.application.status != "SIGNED":
            problems["application"] = "The involuntary application must be signed first."
        if problems:
            raise ValidationError(problems)
        doc.examination_encounter = encounter
        doc.signer_kind, doc.signer_user, doc.signer_name = "PRACTITIONER", user, cred["name"]
        content = {**content, "credential": {k: cred[k] for k in ("registration_number", "registration_body", "registration_verified_at", "qualifications")}}
    if doc.template_id == RECOMMENDATION_TEMPLATE:
        doc.signature_method, doc.captured_by = "ELECTRONIC", user
    else:
        _signature(doc, data, user)
    doc.content = content
    doc.signed_at = now
    doc.rendered = render_snapshot(doc)
    doc.status = "SIGNED"
    doc.save()
    _event(ls, "DOCUMENT_SIGNED", user, ls.workflow_state, ls.workflow_state,
           document=str(doc.pk), template=doc.template_id, version=doc.version, signer_kind=doc.signer_kind)
    if doc.template_id in TEMPLATE_CATEGORY and ls.pending_application_id == doc.pk:
        if ls.status != "ACTIVE":
            _transition(ls, "APPLICATION_SIGNED", user, document=str(doc.pk))
    elif doc.template_id == RECOMMENDATION_TEMPLATE and ls.pending_application_id == doc.application_id:
        required = legal_config.operational(ls.config_version)["requiredRecommendations"]
        if _recommendations(doc.application).count() >= required and ls.status != "ACTIVE":
            _transition(ls, "RECOMMENDATION_SIGNED", user, document=str(doc.pk))
    return doc


@transaction.atomic
def start_recommendation(application, user):
    cred = credential_status(user)
    if not cred["can_sign"]:  # AT-24: cannot open the form
        raise PermissionDenied(cred["reason"])
    if application.template_id != INVOLUNTARY_APPLICATION_TEMPLATE or application.status != "SIGNED":
        raise ValidationError({"application": "A recommendation supports a signed involuntary application."})
    existing = LegalDocument.objects.filter(application=application, template_id=RECOMMENDATION_TEMPLATE,
                                            status="DRAFT", created_by=user).first()
    if existing:
        return existing
    return LegalDocument.objects.create(
        organization_id=application.organization_id, legal_status=application.legal_status, patient=application.patient,
        template_id=RECOMMENDATION_TEMPLATE, config_version=application.config_version, application=application,
        created_by=user, content={},
    )


@transaction.atomic
def amend(doc, user, reason):
    """LGL-DOC-04: a signed version is never edited; a correction is a new version."""
    if doc.status != "SIGNED":
        raise ValidationError({"detail_message": "Only a signed form is amended; edit the draft instead."})
    if doc.superseded_by.exists():
        raise ValidationError({"detail_message": "This version has already been amended."})
    if not (reason or "").strip():
        raise ValidationError({"reason": "Give the reason for the amendment."})
    if doc.template_id == RECOMMENDATION_TEMPLATE and doc.signer_user_id != user.pk:
        raise PermissionDenied("Only the practitioner who signed a recommendation can amend it.")
    new = LegalDocument.objects.create(
        organization_id=doc.organization_id, legal_status=doc.legal_status, patient=doc.patient,
        template_id=doc.template_id, config_version=doc.config_version, application=doc.application,
        version=doc.version + 1, supersedes=doc, amendment_reason=reason.strip(), created_by=user,
        content={k: v for k, v in (doc.content or {}).items() if k not in ("credential", "capacity_confirmation")},
    )
    ls = LegalStatus.objects.select_for_update().get(pk=doc.legal_status_id)
    if ls.pending_application_id == doc.pk:
        ls.pending_application = new
        ls.save()
    _event(ls, "DOCUMENT_AMENDMENT_STARTED", user, ls.workflow_state, ls.workflow_state,
           supersedes=str(doc.pk), document=str(new.pk), reason=reason.strip())
    return new


# ── decision (LGL-V-07…10, LGL-I-O-01…04, LGL-WF) ──


def _link_admission(ls, user):
    from apps.ipd_ward.models import Admission

    from .services import CURRENT_ADMISSION_STATUSES

    admission = (
        Admission.objects.filter(patient=ls.patient, status__in=CURRENT_ADMISSION_STATUSES)
        .filter(Q(episode=ls.episode) | Q(episode__isnull=True)).order_by("-admitted_at").first()
    )
    if admission:
        admission.legal_status_record = ls
        admission.admission_type = ls.category
        admission.save(update_fields=["legal_status_record", "admission_type", "updated_at"])


@transaction.atomic
def decide(ls, user, decision, reason=""):
    ls = LegalStatus.objects.select_for_update().get(pk=ls.pk)
    if not is_admitting_officer(user):
        raise PermissionDenied("Only an admitting officer (ADMITTING_OFFICER permission) can record the admission decision.")
    application = ls.pending_application
    if application is None or application.status != "SIGNED":
        raise ValidationError({"detail_message": "There is no signed application awaiting a decision."})
    reason = (reason or "").strip()
    category = TEMPLATE_CATEGORY[application.template_id]
    now = timezone.now()
    if decision == "REJECTED":
        if not reason:  # AT-27
            raise ValidationError({"reason": "A rejection needs a reason."})
        if ls.status == "ACTIVE":  # conversion refused: the status in force is unchanged
            ls.pending_application = None
            ls.save()
            _event(ls, "CONVERSION_REJECTED", user, ls.workflow_state, ls.workflow_state,
                   document=str(application.pk), reason=reason, decided_at=now.isoformat())
            return ls
        ls.application_document, ls.pending_application = application, None
        ls.decision, ls.decision_by, ls.decision_role, ls.decision_at, ls.decision_reason = "REJECTED", user, _role(user), now, reason
        ls.status = "NOT_ADMITTED"
        _transition(ls, "REJECTED", user, document=str(application.pk), reason=reason)
        return ls
    if decision != "ADMITTED":
        raise ValidationError({"decision": "Choose Admitted or Rejected."})
    recs = []
    if category == "INVOLUNTARY":
        required = legal_config.operational(ls.config_version)["requiredRecommendations"]
        recs = list(_recommendations(application).order_by("signed_at"))
        if len(recs) < required:  # AT-25, OQ-17
            raise ValidationError({"decision": f"An involuntary admission cannot be recorded as Admitted until "
                                   f"{required} signed medical recommendation(s) are on file ({len(recs)} signed)."})
    converting = ls.status == "ACTIVE" and ls.category != category
    previous_category = ls.category
    ls.category, ls.statutory_basis = category, legal_config.statutory_basis(category, ls.config_version)
    ls.application_document, ls.pending_application = application, None
    ls.decision, ls.decision_by, ls.decision_role, ls.decision_at, ls.decision_reason = "ADMITTED", user, _role(user), now, ""
    ls.effective_from = now
    if category == "INVOLUNTARY":
        months = legal_config.operational(ls.config_version)["involuntaryMaxDurationMonths"]
        start = min([now] + [r.signed_at for r in recs])
        ls.max_expiry_at = add_months(start, months)
    else:
        ls.max_expiry_at = None
    ls.status = "ACTIVE"
    if converting:
        _transition(ls, "CONVERTED_TO_VOLUNTARY" if category == "VOLUNTARY" else "ADMITTED", user,
                    "CONVERTED", from_category=previous_category, to_category=category, document=str(application.pk))
    else:
        _transition(ls, "ADMITTED", user, document=str(application.pk))
    _transition(ls, "ACTIVE", user, max_expiry_at=_iso(ls.max_expiry_at))
    _link_admission(ls, user)
    psychiatrist = responsible_psychiatrist(ls.patient)
    rights = legal_config.rights(ls.config_version)
    if not _open_task(ls, TASK_RIGHTS):  # LGL-WF-05, OQ-23
        _task(ls, TASK_RIGHTS, rights["taskLabel"], user, due_at=now, priority="urgent", assignee=psychiatrist)
    if category == "INVOLUNTARY":
        _alert(ls.patient, "INVOLUNTARY_STATUS", user)
        lead = legal_config.operational(ls.config_version)["reviewLeadDays"]
        if not _open_task(ls, TASK_EXPIRY_REVIEW):  # LGL-WF-02/03
            _task(ls, TASK_EXPIRY_REVIEW, "Review involuntary legal status before it reaches its maximum duration",
                  user, due_at=ls.max_expiry_at - timedelta(days=lead), priority="urgent", assignee=psychiatrist)
    else:
        for code in ("INVOLUNTARY_STATUS", "LEGAL_STATUS_EXPIRING", "LEGAL_STATUS_EXPIRED"):
            _resolve_alert(ls.patient, code, user)
    return ls


@transaction.atomic
def end_involuntary(ls, user, reason):
    """Review outcome DISCHARGED: the admitting officer ends an involuntary status."""
    ls = LegalStatus.objects.select_for_update().get(pk=ls.pk)
    if not is_admitting_officer(user):
        raise PermissionDenied("Only an admitting officer can record the end of an involuntary legal status.")
    if ls.category != "INVOLUNTARY" or ls.status not in ("ACTIVE", "EXPIRED"):
        raise ValidationError({"detail_message": "There is no involuntary legal status in force."})
    if not (reason or "").strip():
        raise ValidationError({"reason": "Give the reason."})
    ls.status = "DISCHARGED"
    _transition(ls, "DISCHARGED", user, reason=reason.strip())
    for code in ("INVOLUNTARY_STATUS", "LEGAL_STATUS_EXPIRING", "LEGAL_STATUS_EXPIRED"):
        _resolve_alert(ls.patient, code, user)
    return ls


def sweep(ls, now=None, user=None):
    """LGL-WF-03: review due inside the lead time; expiry without a recorded
    decision raises LEGAL_STATUS_EXPIRED. Idempotent; run hourly and on read."""
    now = now or timezone.now()
    if ls.category != "INVOLUNTARY" or ls.status != "ACTIVE" or not ls.max_expiry_at:
        _notice_risk_check(ls, user)
        return ls
    with transaction.atomic():
        ls = LegalStatus.objects.select_for_update().get(pk=ls.pk)
        if ls.status != "ACTIVE":
            return ls
        lead = legal_config.operational(ls.config_version)["reviewLeadDays"]
        if now >= ls.max_expiry_at:
            ls.status = "EXPIRED"
            _transition(ls, "EXPIRED", user, max_expiry_at=_iso(ls.max_expiry_at))
            _resolve_alert(ls.patient, "LEGAL_STATUS_EXPIRING", user)
            _alert(ls.patient, "LEGAL_STATUS_EXPIRED", user)
        elif now >= ls.max_expiry_at - timedelta(days=lead) and ls.workflow_state != "REVIEW_DUE":
            _transition(ls, "REVIEW_DUE", user, max_expiry_at=_iso(ls.max_expiry_at))
            _alert(ls.patient, "LEGAL_STATUS_EXPIRING", user)
    return ls


def sweep_all(now=None):
    for ls in LegalStatus.all_objects.filter(status="ACTIVE"):
        sweep(ls, now)


# ── 72-hour notice (LGL-V-WF) ──


def active_notice(ls):
    if ls is None or ls.category != "VOLUNTARY" or ls.status != "ACTIVE":
        return None
    return ls.discharge_notices.filter(withdrawn_at__isnull=True, departed_at__isnull=True).first()


def _notice_risk_check(ls, user):
    """LGL-V-WF-4: an active risk alert at notice time or during the notice
    period prompts clinical review. Prompt + task only — never a conversion."""
    notice = active_notice(ls)
    if notice is None or notice.risk_review_prompted_at or not active_risk(ls.patient):
        return False
    with transaction.atomic():
        notice = DischargeNotice.objects.select_for_update().get(pk=notice.pk)
        if notice.risk_review_prompted_at:
            return False
        notice.risk_review_prompted_at = timezone.now()
        notice.save(update_fields=["risk_review_prompted_at", "updated_at"])
        _task(ls, TASK_LEGAL_REVIEW, RISK_REVIEW_PROMPT, user, due_at=notice.earliest_departure_at,
              priority="urgent", assignee=responsible_psychiatrist(ls.patient))
        _event(ls, "RISK_REVIEW_PROMPTED", user, ls.workflow_state, ls.workflow_state, notice=str(notice.pk))
    return True


@transaction.atomic
def give_notice(ls, user, data):
    ls = LegalStatus.objects.select_for_update().get(pk=ls.pk)
    if ls.category != "VOLUNTARY" or ls.status != "ACTIVE":
        raise ValidationError({"detail_message": "Written notice applies to a voluntary admission in force."})
    if active_notice(ls):
        raise ValidationError({"detail_message": "A written notice is already active."})
    now = timezone.now()
    given_at = now
    if data.get("given_at"):
        parsed = facility_time.make_local_aware(datetime.fromisoformat(str(data["given_at"])))
        if parsed > now:
            raise ValidationError({"given_at": "The notice cannot be dated in the future."})
        given_at = parsed
    from apps.accounts.models import User

    given_to = User.objects.filter(pk=data.get("given_to"), organization_id=ls.organization_id).first() if data.get("given_to") else user
    if given_to is None:
        raise ValidationError({"given_to": "Choose the staff member in charge who received the notice."})
    statement = str(data.get("statement") or "").strip()
    doc = LegalDocument(
        organization_id=ls.organization_id, legal_status=ls, patient=ls.patient, template_id=NOTICE_TEMPLATE,
        config_version=ls.config_version, created_by=user, content={"statement": statement, "given_at": given_at.isoformat(),
                                                                    "given_to": _name(given_to)},
        signer_kind="CLIENT", signer_name=ls.patient.get_full_name(),
    )
    if data.get("method") == "ELECTRONIC" and not statement:
        raise ValidationError({"statement": "Record the client's written notice in their words."})
    _signature(doc, data, user)  # it must be in writing: e-signed statement or scan
    doc.signed_at = now
    doc.rendered = render_snapshot(doc)
    doc.status = "SIGNED"
    doc.save()
    hours = legal_config.operational(ls.config_version)["voluntaryNoticePeriodHours"]
    notice = DischargeNotice.objects.create(
        organization_id=ls.organization_id, legal_status=ls, given_at=given_at, given_to=given_to,
        written_notice_document=doc, notice_period_hours=hours,
        earliest_departure_at=given_at + timedelta(hours=hours), created_by=user,
    )
    _event(ls, "DISCHARGE_NOTICE_GIVEN", user, ls.workflow_state, ls.workflow_state, notice=str(notice.pk),
           earliest_departure_at=notice.earliest_departure_at.isoformat())
    psychiatrist = responsible_psychiatrist(ls.patient)
    _task(ls, TASK_NOTICE_REVIEW, "Psychiatric review before departure (written discharge notice)", user,
          due_at=notice.earliest_departure_at, priority="urgent", assignee=psychiatrist)
    plan = "Discharge planning: discharge summary, discharge medication list, follow-up/continuing-care plan"
    if active_risk(ls.patient):
        plan += ", safety/crisis plan (risk active)"
    _task(ls, TASK_NOTICE_DISCHARGE, plan, user, due_at=notice.earliest_departure_at, priority="urgent", owner="Care team")
    _alert(ls.patient, "DISCHARGE_NOTICE_ACTIVE", user)
    _notice_risk_check(ls, user)
    return notice


@transaction.atomic
def withdraw_notice(notice, user):
    notice = DischargeNotice.objects.select_for_update().get(pk=notice.pk)
    if not notice.is_active:
        raise ValidationError({"detail_message": "This notice is no longer active."})
    notice.withdrawn_at, notice.withdrawn_by = timezone.now(), user
    notice.save(update_fields=["withdrawn_at", "withdrawn_by", "updated_at"])
    ls = notice.legal_status
    _resolve_alert(ls.patient, "DISCHARGE_NOTICE_ACTIVE", user)
    _event(ls, "DISCHARGE_NOTICE_WITHDRAWN", user, ls.workflow_state, ls.workflow_state, notice=str(notice.pk))
    return notice


@transaction.atomic
def record_departure(notice, user):
    """LGL-V-WF-6: leaving before the notice expires is routed to the existing
    discharge flow as 'Left against medical advice' (DOC-DIS AMA)."""
    from . import services

    notice = DischargeNotice.objects.select_for_update().get(pk=notice.pk)
    if not notice.is_active:
        raise ValidationError({"detail_message": "This notice is no longer active."})
    now = timezone.now()
    ama = now < notice.earliest_departure_at
    notice.departed_at, notice.departure_against_advice = now, ama
    notice.save(update_fields=["departed_at", "departure_against_advice", "updated_at"])
    ls = LegalStatus.objects.select_for_update().get(pk=notice.legal_status_id)
    ls.status = "DISCHARGED"
    _transition(ls, "DISCHARGED", user, notice=str(notice.pk), against_medical_advice=ama)
    _resolve_alert(ls.patient, "DISCHARGE_NOTICE_ACTIVE", user)
    admission = services.current_admission(ls.patient)
    if admission:
        services.save_discharge_draft(admission, user, {"disposition": "AMA"} if ama else {})
    return {"notice": notice, "admission_id": str(admission.pk) if admission else None, "against_medical_advice": ama}


@transaction.atomic
def complete_task(task, user):
    if task.focus_type != TASK_FOCUS:
        raise ValidationError({"detail_message": "Not a legal-status task."})
    if task.completed_at:
        raise ValidationError({"detail_message": "This task is already complete."})
    task.status, task.completed_at, task.completed_by = "COMPLETED", timezone.now(), user
    task.save(update_fields=["status", "completed_at", "completed_by", "updated_at"])
    ls = LegalStatus.objects.filter(pk=task.focus_id).first()
    if ls:
        _event(ls, "TASK_COMPLETED", user, ls.workflow_state, ls.workflow_state, task=str(task.pk), code=task.action_code)
    return task


# ── identity numbers (LGL-DOC-06) ──


def unmask(ls, user, subject, related_person_id=None):
    from apps.sysadmin_audit.audit import write_event

    if not can_unmask(user):
        raise PermissionDenied("Your role may not view identity numbers unmasked.")
    if subject == "client":
        value = ls.patient.national_id or ls.patient.passport_number
        model, object_id = "client_registry.patient", ls.patient_id
    elif subject == "applicant":
        person = EmergencyContact.objects.filter(pk=related_person_id, patient=ls.patient).first()
        if person is None:
            raise ValidationError({"related_person_id": "Unknown applicant."})
        value, model, object_id = person.id_number, "client_registry.emergencycontact", person.pk
    else:
        raise ValidationError({"subject": "client or applicant"})
    if legal_config.privacy()["logUnmaskedViews"]:
        write_event(ls.organization_id, "VIEW", model, object_id, {"unmasked": "identity_number", "context": "legal_status", "legal_status": str(ls.pk)})
    return value


# ── rendering: the form as signed / as printed (LGL-DOC-03) ──


def render_snapshot(doc):
    """Every text the form shows, filled from the record — frozen at signature."""
    ls = doc.legal_status
    patient = doc.patient
    form = legal_config.form(doc.template_id, doc.config_version)
    client = client_details(patient)
    facility = facility_profile(patient, ls.episode)
    content = doc.content or {}
    out = {"title": form["title"], "statuteLine": form.get("statuteLine", ""), "configVersion": doc.config_version,
           "facility": facility, "client": {k: client[k] for k in ("full_name", "address", "gender_form", "gender_other_detail", "id_kind", "pronoun")},
           "labels": form.get("labels", {})}
    name = patient.get_full_name()
    if doc.template_id == VOLUNTARY_TEMPLATE:
        out.update({
            "explanatoryText": legal_config.text(form["explanatoryText"]),
            "noticeHeading": legal_config.text(form["noticeHeading"]),
            "noticeText": legal_config.text(form["noticeText"]),
            "noticePurpose": legal_config.text(form["noticePurpose"]),
            "noticeAcknowledgement": legal_config.text(form["noticeAcknowledgement"]),
            "declaration": legal_config.fill(legal_config.text(form["declaration"]), fullName=name,
                                             address=patient.address or "", facilityName=facility["name"]),
        })
    elif doc.template_id == INVOLUNTARY_APPLICATION_TEMPLATE:
        person = EmergencyContact.objects.filter(pk=content.get("applicant_related_person_id")).first()
        chosen = set(content.get("assertions") or [])
        out.update({
            "parts": form["parts"],
            "assertions": [{"code": a["code"], "text": a["text"], "ticked": a["code"] in chosen,
                            "source": "THIRD_PARTY_REPORT", "sourceDetail": person.name if person else ""}
                           for a in form["assertions"]],
            "otherDescription": content.get("other_description", ""),
            "applicant": {"name": person.name, "address": person.address, "phone": person.phone,
                          "relationship": person.relationship, "relationship_detail": person.relationship_detail,
                          "id_present": bool(person.id_number)} if person else {},
            "declaration": legal_config.fill(legal_config.text(form["declaration"]), clientName=name),
        })
    elif doc.template_id == RECOMMENDATION_TEMPLATE:
        exam = content.get("examination_date") or ""
        day = month = yy = ""
        if exam:
            try:
                d = datetime.strptime(exam, "%Y-%m-%d").date()
                day, month, yy = str(d.day), d.strftime("%B"), d.strftime("%y")
            except ValueError:
                pass
        values = {"clientName": name, "practitionerName": doc.signer_name or "", "day": day, "month": month,
                  "yy": yy, "pronoun": pronoun(patient)}
        decls = []
        for decl in form["declarations"]:
            entry = {"number": decl["number"], "lead": decl.get("lead", ""), "text": legal_config.fill(decl["text"], **values)}
            if decl.get("grounds"):
                g = content.get("grounds") or {}
                entry["grounds"] = [{"code": gr["code"], "text": legal_config.fill(gr["text"], **values),
                                     "affirmed": bool((g.get(gr["code"]) or {}).get("affirmed")),
                                     "narrative": (g.get(gr["code"]) or {}).get("narrative", "")} for gr in decl["grounds"]]
            decls.append(entry)
        out.update({"intro": legal_config.fill(legal_config.text(form["intro"]), **values), "declarations": decls,
                    "credential": content.get("credential", {}), "examinationDate": exam})
    elif doc.template_id == NOTICE_TEMPLATE:
        vol = legal_config.form(VOLUNTARY_TEMPLATE, doc.config_version)
        out.update({"noticeHeading": legal_config.text(vol["noticeHeading"]), "noticeText": legal_config.text(vol["noticeText"]),
                    "statement": content.get("statement", ""), "givenAt": content.get("given_at"), "givenTo": content.get("given_to")})
    return out


# ── read model ──


def document_row(doc):
    return {
        "id": str(doc.pk), "document_number": doc.document_number, "template_id": doc.template_id,
        "title": doc.get_template_id_display(), "version": doc.version, "status": doc.status,
        "supersedes": str(doc.supersedes_id) if doc.supersedes_id else None,
        "superseded": doc.superseded_by.exists(), "amendment_reason": doc.amendment_reason,
        "application": str(doc.application_id) if doc.application_id else None,
        "content": {k: v for k, v in (doc.content or {}).items() if k != "credential"},
        "signer_kind": doc.signer_kind, "signer_name": doc.signer_name, "signature_method": doc.signature_method,
        "signed_at": _iso(doc.signed_at), "captured_by": _name(doc.captured_by), "created_by": _name(doc.created_by),
        "created_at": _iso(doc.created_at),
        "examination_encounter_id": str(doc.examination_encounter_id) if doc.examination_encounter_id else None,
    }


def banner_summary(patient):
    """BAN-10 / LGL-DATA-01: legal status + expiry + live notice countdown, as text."""
    ls = legal_status_for(patient)
    if ls is None:
        return None
    notice = active_notice(ls)
    label = {"PENDING": f"{ls.get_category_display().upper()} — APPLICATION PENDING",
             "NOT_ADMITTED": "APPLICATION REJECTED", "ACTIVE": ls.get_category_display().upper(),
             "EXPIRED": "INVOLUNTARY — EXPIRED", "DISCHARGED": "LEGAL STATUS ENDED"}.get(ls.status, ls.get_status_display().upper())
    if ls.status == "ACTIVE" and ls.category == "INVOLUNTARY" and ls.max_expiry_at:
        label += f", expires {facility_time.local_format(ls.max_expiry_at, '%Y-%m-%d')}"
    return {
        "id": str(ls.pk), "category": ls.category, "status": ls.status, "decision": ls.decision,
        "label": label, "max_expiry_at": _iso(ls.max_expiry_at),
        "pending_conversion": bool(ls.status == "ACTIVE" and ls.pending_application_id),
        "notice": {"given_at": _iso(notice.given_at), "earliest_departure_at": _iso(notice.earliest_departure_at),
                   "notice_period_hours": notice.notice_period_hours} if notice else None,
    }


def workspace(patient, user):
    from .services import current_or_latest_episode

    ls = legal_status_for(patient)
    if ls is not None:
        ls = sweep(ls, user=None)
    episode = current_or_latest_episode(patient)
    config = legal_config.load(ls.config_version if ls else None)
    docs = list(LegalDocument.objects.filter(legal_status=ls).select_related("captured_by", "created_by")) if ls else []
    notice = active_notice(ls)
    tasks = CareTask.objects.filter(focus_type=TASK_FOCUS, focus_id=str(ls.pk)) if ls else []
    pending = ls.pending_application if ls else None
    required = legal_config.operational(ls.config_version if ls else None)["requiredRecommendations"]
    return {
        "config": {
            "version": config["version"], "provenance": config["provenance"], "forms": config["forms"],
            "statutes": config["statutes"], "operational": legal_config.operational(ls.config_version if ls else None),
            "rights": config["rights"], "privacy": {"maskIdentityNumbers": config["privacy"]["maskIdentityNumbers"]},
        },
        "episode_id": str(episode.pk) if episode else None,
        "legal_status": None if ls is None else {
            "id": str(ls.pk), "category": ls.category, "status": ls.status, "workflow_state": ls.workflow_state,
            "decision": ls.decision, "decision_by": _name(ls.decision_by), "decision_role": ls.decision_role,
            "decision_at": _iso(ls.decision_at), "decision_reason": ls.decision_reason,
            "effective_from": _iso(ls.effective_from), "max_expiry_at": _iso(ls.max_expiry_at),
            "statutory_basis": ls.statutory_basis, "config_version": ls.config_version,
            "application_document": str(ls.application_document_id) if ls.application_document_id else None,
            "pending_application": str(pending.pk) if pending else None,
            "recommendation_document_ids": [str(r.pk) for r in _recommendations(pending or ls.application_document)]
            if (pending or ls.application_document) else [],
            "required_recommendations": required,
        },
        "banner": banner_summary(patient),
        "documents": [document_row(d) for d in docs],
        "notice": None if notice is None else {
            "id": str(notice.pk), "given_at": _iso(notice.given_at), "given_to": _name(notice.given_to),
            "earliest_departure_at": _iso(notice.earliest_departure_at), "notice_period_hours": notice.notice_period_hours,
            "written_notice_document": str(notice.written_notice_document_id),
            "risk_review_required": bool(notice.risk_review_prompted_at) or active_risk(patient),
            "risk_review_prompt": RISK_REVIEW_PROMPT if (notice.risk_review_prompted_at or active_risk(patient)) else "",
        },
        "tasks": [{"id": str(t.pk), "code": t.action_code, "label": t.action_label, "priority": t.priority,
                   "due_at": _iso(t.due_at), "assignee": _name(t.assignee), "owner": t.owner,
                   "completed_at": _iso(t.completed_at), "completed_by": _name(t.completed_by)} for t in tasks],
        "history": [{"event": e.event, "from_state": e.from_state, "to_state": e.to_state, "actor": _name(e.actor),
                     "actor_role": e.actor_role, "at": _iso(e.at), "detail": e.detail}
                    for e in (ls.history.select_related("actor") if ls else [])],
        "client": client_details(patient),
        "related_persons": [related_person_row(p) for p in EmergencyContact.objects.filter(patient=patient)],
        "next_of_kin_id": str(patient.next_of_kin_id) if patient.next_of_kin_id else None,
        "facility": facility_profile(patient, episode),
        "evidence": evidence_context(patient),
        "capacity": {**{k: v for k, v in capacity_prompt(patient).items() if k != "since"},
                     "confirmation": (lambda c: None if c is None else {
                         "outcome": c.outcome, "assessed_at": _iso(c.assessed_at), "assessed_by": _name(c.assessed_by)})(capacity_confirmation(patient))},
        "encounters": [{"id": str(e.pk), "type": e.encounter_type, "opened_at": _iso(e.opened_at)}
                       for e in Encounter.objects.filter(patient=patient).order_by("-opened_at")[:20]],
        "me": {"is_admitting_officer": is_admitting_officer(user), "can_unmask": can_unmask(user),
               "credential": credential_status(user)},
    }
