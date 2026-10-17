"""
Section 6 allergy record (INT-06, DATA-04; mockup v4 allergyEditor / secAllergy).

One store: client_registry.AllergyRecord, one row per substance (FHIR
AllergyIntolerance). Nothing is deleted — "remove" resolves or refutes a record so
the history stays. Type, severity and the record's source of information are
codes of served value sets (`allergy-type`, `allergy-severity`,
`allergy-info-source`).
"""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.client_registry.models import AllergyRecord, Patient

from .models import LocalConcept

EDITABLE = ("substance", "reaction", "allergy_type", "severity")


def _name(user):
    return (user.get_full_name() or user.get_username()) if user else ""


def payload(patient):
    """The allergy record as the intake section shows it. Refuted rows are kept in the
    store but not listed; resolved rows are listed so a clinician can see the history."""
    return {
        "status": patient.allergy_status,
        "info_source": patient.allergy_info_source,
        "confirmed_at": patient.allergy_confirmed_at,
        "confirmed_by": _name(patient.allergy_confirmed_by) if patient.allergy_confirmed_by_id else "",
        "records": [
            {
                "id": str(a.id),
                "substance": a.substance,
                "reaction": a.reaction,
                "allergy_type": a.allergy_type,
                "severity": a.severity,
                "clinical_status": a.clinical_status,
                "verification_status": a.verification_status,
                "source": a.source,
                "noted_at": a.noted_at,
                "recorded_by": _name(a.recorded_by) if a.recorded_by_id else "",
            }
            for a in patient.allergy_records.exclude(verification_status="REFUTED").select_related("recorded_by")
        ],
    }


def _check_code(valueset, code, field, message):
    if not LocalConcept.objects.filter(valueset_id=valueset, code=code, active=True).exists():
        raise ValidationError({field: message})


def _clean(data, partial):
    cleaned = {}
    for field in EDITABLE:
        if field not in data:
            continue
        value = str(data.get(field) or "").strip()
        cleaned[field] = value
    if not partial or "substance" in cleaned:
        if not cleaned.get("substance"):
            raise ValidationError({"substance": "Name the substance, medicine or class."})
    if not partial or "allergy_type" in cleaned:
        cleaned.setdefault("allergy_type", "ALLERGY")
        if cleaned["allergy_type"] not in dict(AllergyRecord.TYPE_CHOICES):
            raise ValidationError({"allergy_type": "Choose allergy, intolerance or ADR."})
    if cleaned.get("severity"):
        _check_code("allergy-severity", cleaned["severity"], "severity", "Choose the severity.")
    return cleaned


@transaction.atomic
def add_record(patient, user, data):
    """A clinician records a reaction: it is confirmed by being clinician-entered."""
    cleaned = _clean(data, partial=False)
    AllergyRecord.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        source="CLINICIAN",
        verification_status="CONFIRMED",
        recorded_by=user,
        **cleaned,
    )
    if patient.allergy_status != "ACTIVE_ALLERGIES":
        patient.allergy_status = "ACTIVE_ALLERGIES"
        patient.save(update_fields=["allergy_status", "updated_at"])
    return payload(patient)


@transaction.atomic
def update_record(record, user, data):
    """Edit type / severity / reaction, or change status: ACTIVE, RESOLVED (no longer
    applies) or REFUTED (was never this reaction). Removing is one of the last two."""
    cleaned = _clean(data, partial=True)
    status = data.get("status")
    if status is not None:
        if status == "ACTIVE":
            record.clinical_status = "ACTIVE"
            if record.verification_status == "REFUTED":
                record.verification_status = "CONFIRMED"
        elif status == "RESOLVED":
            record.clinical_status = "RESOLVED"
        elif status == "REFUTED":
            record.verification_status = "REFUTED"
        else:
            raise ValidationError({"status": "Use ACTIVE, RESOLVED or REFUTED."})
    for field, value in cleaned.items():
        setattr(record, field, value)
    record.recorded_by = user
    record.save()
    patient = record.patient
    # Nothing active left: the status is asked again rather than assumed (mockup).
    if not patient.allergy_records.exclude(verification_status="REFUTED").exclude(
        clinical_status="RESOLVED"
    ).exists() and patient.allergy_status == "ACTIVE_ALLERGIES":
        patient.allergy_status = "UNKNOWN"
        patient.save(update_fields=["allergy_status", "updated_at"])
    return payload(patient)


@transaction.atomic
def update_status(patient, user, data):
    """Allergy status, the record's source of information, and "Confirm — unchanged"."""
    fields = []
    if "status" in data:
        if data["status"] not in dict(Patient.ALLERGY_STATUS_CHOICES):
            raise ValidationError({"status": "Unknown allergy status."})
        patient.allergy_status = data["status"]
        fields.append("allergy_status")
    if "info_source" in data:
        source = str(data.get("info_source") or "")
        if source:
            _check_code("allergy-info-source", source, "info_source", "Choose the source of information.")
        patient.allergy_info_source = source
        fields.append("allergy_info_source")
    if data.get("confirm"):
        if patient.allergy_status == "UNKNOWN":
            raise ValidationError({"confirm": "Record the allergy status before confirming it."})
        # The clinician confirms the record as it stands — client-reported rows included.
        patient.allergy_records.filter(verification_status="UNCONFIRMED").update(
            verification_status="CONFIRMED", recorded_by=user, updated_at=timezone.now()
        )
        patient.allergy_confirmed_at = timezone.now()
        patient.allergy_confirmed_by = user
        fields += ["allergy_confirmed_at", "allergy_confirmed_by"]
    if fields:
        patient.save(update_fields=[*fields, "updated_at"])
    return payload(patient)
