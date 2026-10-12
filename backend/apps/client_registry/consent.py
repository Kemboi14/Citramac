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
    )
    if consent_type == HIE_GENERAL:
        patient.consent_data_sharing = granted
        patient.consent_captured_at = timezone.now()
        patient.save(update_fields=["consent_data_sharing", "consent_captured_at"])
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
