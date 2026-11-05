"""
Consent capture/revocation — docs/09-SECURITY-COMPLIANCE.md §9.5. Every
call writes an immutable ConsentRecord (the audit-defensible history) and
updates the Patient's denormalized "current state" fields (used by
existing reads/serializers) to match the latest record.

CLAUDE.md §4 "Consent and sensitivity before capture": a record states what
was permitted (`consent_type`), the decision (yes / no / restricted to the
treating facility / not asked), the purpose and how long it lasts.
"""

from django.utils import timezone

from .models import ConsentRecord

HIE_GENERAL = "DATA_SHARING_HIE"
HIE_MENTAL_HEALTH = "MENTAL_HEALTH_HIE"
HIE_SUBSTANCE_USE = "SUBSTANCE_USE_HIE"
FAMILY_INVOLVEMENT = "FAMILY_INVOLVEMENT"


def capture_consent(
    patient,
    user,
    granted,
    consent_text_version,
    consent_text_snapshot,
    *,
    consent_type=HIE_GENERAL,
    decision=None,
    purpose="",
    valid_until=None,
    recipient="",
    disclosure_scope=None,
):
    if decision is None:
        decision = "YES" if granted else "NO"
    record = ConsentRecord.objects.create(
        organization=patient.organization,
        patient=patient,
        consent_type=consent_type,
        granted=granted,
        decision=decision,
        purpose=purpose,
        valid_until=valid_until,
        consent_text_version=consent_text_version,
        consent_text_snapshot=consent_text_snapshot,
        captured_by=user,
        recipient=recipient,
        disclosure_scope=list(disclosure_scope or []),
    )
    if consent_type == HIE_GENERAL:
        patient.consent_data_sharing = granted
        patient.consent_captured_at = timezone.now()
        patient.save(update_fields=["consent_data_sharing", "consent_captured_at"])
    return record


def current_record(patient, consent_type):
    """The latest unexpired ConsentRecord of this type, or None."""
    now = timezone.now()
    record = (
        ConsentRecord.all_objects.filter(patient=patient, consent_type=consent_type)
        .order_by("-captured_at")
        .first()
    )
    if record is None or (record.valid_until and record.valid_until <= now):
        return None
    return record


def current_decision(patient, consent_type):
    """The latest unexpired decision for this consent type, else NOT_ASKED."""
    now = timezone.now()
    record = (
        ConsentRecord.all_objects.filter(patient=patient, consent_type=consent_type)
        .order_by("-captured_at")
        .first()
    )
    if record is None:
        return "NOT_ASKED"
    if record.valid_until and record.valid_until <= now:
        return "NOT_ASKED"
    return record.decision


def may_send_to_hie(patient, consent_type=HIE_GENERAL):
    """Fail safe: only an explicit YES releases data to the HIE. NOT_ASKED, NO
    and RESTRICTED (treating facility only) all withhold it."""
    return current_decision(patient, consent_type) == "YES"


# ── Appointment messages (owner decisions 2026-11-05) ──
# The client agrees, per channel, to SMS / email about their own appointments.
# Fail safe like the HIE: only an explicit YES lets a message go; NOT_ASKED
# and NO send nothing. Both decisions snapshot the facility's own
# APPOINTMENT_MESSAGES wording (care_pathway.ConsentTemplate) — the system
# never writes consent text (CLAUDE.md §6).
APPOINTMENT_SMS = "APPOINTMENT_SMS"
APPOINTMENT_EMAIL = "APPOINTMENT_EMAIL"
APPOINTMENT_TYPES = {"sms": APPOINTMENT_SMS, "email": APPOINTMENT_EMAIL}
APPOINTMENT_TEMPLATE = "APPOINTMENT_MESSAGES"


def appointment_wording(organization_id=None):
    """The facility's active APPOINTMENT_MESSAGES wording, or None if not set."""
    from apps.care_pathway.models import ConsentTemplate

    templates = ConsentTemplate.objects.filter(consent_type=APPOINTMENT_TEMPLATE, active=True)
    if organization_id is not None:
        templates = ConsentTemplate.all_objects.filter(
            organization_id=organization_id, consent_type=APPOINTMENT_TEMPLATE, active=True
        )
    return templates.order_by("-created_at").first()


def capture_appointment_consent(patient, user, decisions):
    """Record {"sms": "YES"|"NO", "email": ...} against the active wording.
    NOT_ASKED / blank leaves that channel unrecorded."""
    from rest_framework.exceptions import ValidationError

    wanted = {
        channel: decisions.get(channel)
        for channel in APPOINTMENT_TYPES
        if decisions.get(channel) not in (None, "", "NOT_ASKED")
    }
    if not wanted:
        return []
    for channel, decision in wanted.items():
        if decision not in ("YES", "NO"):
            raise ValidationError({"appointment_messages": f"Unknown decision for {channel}."})
    template = appointment_wording(patient.organization_id)
    if template is None:
        raise ValidationError(
            {
                "appointment_messages": "Your Org Admin hasn't set the facility's wording for "
                "appointment messages (Consent Wording), so the client's answer can't be recorded."
            }
        )
    return [
        capture_consent(
            patient,
            user,
            decision == "YES",
            template.version,
            template.text,
            consent_type=APPOINTMENT_TYPES[channel],
            decision=decision,
            purpose="Messages about the client's own appointments",
        )
        for channel, decision in wanted.items()
    ]


def appointment_channels(patient):
    """{"sms": decision, "email": decision} — current decisions per channel."""
    return {
        channel: current_decision(patient, consent_type)
        for channel, consent_type in APPOINTMENT_TYPES.items()
    }
