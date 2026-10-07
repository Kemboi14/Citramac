"""
Right-to-Erasure execution — docs/09-SECURITY-COMPLIANCE.md §9.5.

Erasure is the one lawful exception to "archive, never delete", and it is
still an anonymization in place, not a deletion: the clinical and financial
record stays (it has its own statutory retention), with everything that
identifies the person removed from it.
"""

from datetime import date

from django.utils import timezone

from apps.sysadmin_audit.audit import write_entry
from apps.sysadmin_audit.models import AuditLogEntry

from .models import Attachment, EmergencyContact, ErasureRequest, InsuranceCoverage, Patient

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
    "occupation",
    "insurer_details",
    "referral_source",
    "preferred_name",
    "identity_description",
    "id_document_number",
]
ERASED_PLACEHOLDER = "[ERASED]"

# Kept deliberately: `citramac_number` is the internal pseudonymous key that
# links the remaining clinical rows together, and carries no personal data.
EMERGENCY_CONTACT_PII = {"name": ERASED_PLACEHOLDER, "phone": "", "email": "", "address": ""}
INSURANCE_PII = {"policy_number": "", "corporate_account": ""}


def check_retention_conflict(patient):
    """
    A statutory minimum retention period, a legal hold, or ongoing care can
    each override an erasure request — §9.5: flag the conflict rather than
    silently refusing or complying. The statutory minimum is timed from the
    last clinical activity anywhere in the record (apps.retention.services
    — mental health, lab, pharmacy, ward and financial rows, not just
    encounters), and uses the organization's effective retention periods.
    Returns a human-readable conflict, or None.
    """
    from apps.retention.services import clinical_retention_for_patient, is_in_active_care

    if patient.legal_hold:
        return (
            "This client record is on legal hold "
            f"({patient.legal_hold_reason or 'no reason recorded'}). Erasure cannot proceed "
            "while the hold is in place."
        )
    retention = clinical_retention_for_patient(patient)
    if retention is not None and retention.retention_ends_on > timezone.localdate():
        return (
            f"This client's last clinical activity was on "
            f"{timezone.localtime(retention.last_activity_at):%Y-%m-%d}, within the "
            f"{retention.retention_years}-year statutory minimum retention period for this "
            f"record, which runs until {retention.retention_ends_on:%Y-%m-%d}. Erasure cannot "
            "proceed until this conflict is resolved or explicitly overridden by a compliance "
            "officer."
        )
    if is_in_active_care(patient):
        return (
            "This client has an open encounter or a current admission. Erasure cannot proceed "
            "while care is ongoing."
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

    # QuerySet.update() throughout — deliberately NOT instance.save(). A
    # normal save() fires the generic write-audit signal
    # (apps.sysadmin_audit.signals), which would record the pre-erasure
    # values in that entry's field_diff forever, defeating the request.
    anonymized = {field: "" for field in PII_FIELDS}
    anonymized["first_name"] = ERASED_PLACEHOLDER
    anonymized["last_name"] = ERASED_PLACEHOLDER
    # Exact date of birth is a strong quasi-identifier; the year alone keeps
    # age-banded clinical reporting meaningful.
    anonymized["date_of_birth"] = (
        date(patient.date_of_birth.year, 1, 1) if patient.date_of_birth else None
    )
    anonymized["photo"] = None
    if patient.photo:
        patient.photo.delete(save=False)
    Patient.all_objects.filter(pk=patient.pk).update(**anonymized)

    contacts = EmergencyContact.all_objects.filter(patient=patient).update(**EMERGENCY_CONTACT_PII)
    coverages = InsuranceCoverage.all_objects.filter(patient=patient).update(**INSURANCE_PII)

    # Identity documents (ID/passport scans) are personal data, not clinical
    # record: their files are removed. Every other attachment is part of the
    # clinical record and stays.
    identity_documents = list(Attachment.all_objects.filter(patient=patient, category="IDENTITY"))
    for attachment in identity_documents:
        if attachment.file:
            attachment.file.delete(save=False)
    Attachment.all_objects.filter(pk__in=[a.pk for a in identity_documents]).update(
        file="", description=ERASED_PLACEHOLDER, tags=[], doc_status="ARCHIVED"
    )

    erasure_request.status = ErasureRequest.STATUS_COMPLETED
    erasure_request.completed_at = timezone.now()
    if conflict:
        erasure_request.retention_conflict_detail = f"Overridden: {conflict}"
    erasure_request.save(update_fields=["status", "completed_at", "retention_conflict_detail"])

    # The audit record of the erasure itself (§9.5) — names what was
    # erased, never the prior values.
    write_entry(
        patient,
        AuditLogEntry.ACTION_ERASURE,
        {
            "fields_erased": PII_FIELDS + ["date_of_birth (reduced to year)", "photo"],
            "emergency_contacts_erased": contacts,
            "insurance_coverages_erased": coverages,
            "identity_documents_removed": len(identity_documents),
            "note": "prior values are not retained in the audit trail",
        },
    )
    return erasure_request
