"""
Right-to-Erasure execution — docs/09-SECURITY-COMPLIANCE.md §9.5.
"""

from django.conf import settings
from django.utils import timezone

from apps.sysadmin_audit.audit import write_entry
from apps.sysadmin_audit.models import AuditLogEntry

from .models import ErasureRequest, Patient

PII_FIELDS = [
    "first_name",
    "last_name",
    "middle_other_names",
    "national_id",
    "passport_number",
    "contact_phone",
    "contact_email",
    "address",
    "county",
    "upi",
    "uhid_number",
]
ERASED_PLACEHOLDER = "[ERASED]"


def check_retention_conflict(patient):
    """
    A statutory minimum retention period can override an erasure request —
    §9.5: flag the conflict rather than silently refusing or complying.
    Returns a human-readable conflict detail, or None if erasure can
    proceed freely.
    """
    minimum_years = getattr(settings, "CLINICAL_RECORD_MINIMUM_RETENTION_YEARS", 7)
    cutoff = timezone.now() - timezone.timedelta(days=365 * minimum_years)
    recent_encounter = (
        patient.encounters.filter(opened_at__gt=cutoff).order_by("-opened_at").first()
    )
    if recent_encounter:
        return (
            f"Patient has a clinical encounter from {recent_encounter.opened_at:%Y-%m-%d}, "
            f"within the {minimum_years}-year statutory minimum retention period for "
            "clinical records. Erasure cannot proceed until this conflict is resolved or "
            "explicitly overridden by a compliance officer."
        )
    return None


def execute_erasure(erasure_request, override_retention_conflict=False):
    """
    Requires both sign-offs already recorded on `erasure_request` (checked
    by the caller/view, not here, so this function has one job).
    """
    patient = erasure_request.patient
    conflict = check_retention_conflict(patient)
    if conflict and not override_retention_conflict:
        erasure_request.status = ErasureRequest.STATUS_RETENTION_CONFLICT
        erasure_request.retention_conflict_detail = conflict
        erasure_request.save(update_fields=["status", "retention_conflict_detail"])
        return erasure_request

    # Patient.objects.filter(...).update(...) — deliberately NOT instance.save().
    # A normal save() fires the generic write-audit signal
    # (apps.sysadmin_audit.signals), which would record the patient's
    # PRE-erasure PII values in that entry's field_diff forever, defeating
    # the entire point of an erasure request. .update() bypasses signals.
    anonymized = {field: "" for field in PII_FIELDS}
    anonymized["first_name"] = ERASED_PLACEHOLDER
    anonymized["last_name"] = ERASED_PLACEHOLDER
    Patient.objects.filter(pk=patient.pk).update(**anonymized)

    erasure_request.status = ErasureRequest.STATUS_COMPLETED
    erasure_request.completed_at = timezone.now()
    if conflict:
        erasure_request.retention_conflict_detail = f"Overridden: {conflict}"
    erasure_request.save(update_fields=["status", "completed_at", "retention_conflict_detail"])

    # The audit record of the erasure itself (§9.5) — names which fields
    # were erased, never their prior values.
    write_entry(
        patient,
        AuditLogEntry.ACTION_ERASURE,
        {"fields_erased": PII_FIELDS, "note": "prior values are not retained in the audit trail"},
    )
    return erasure_request
