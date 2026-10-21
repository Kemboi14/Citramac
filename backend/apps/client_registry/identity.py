"""
Identity services — identifiers, duplicate detection, temporary→permanent merge.

CLAUDE.md §4: identifiers are sliced, never overwritten; a local business
identifier exists before any network call; a local number cannot reconcile a
person across sites, so national identifiers sit beside it, each with its own
kind (and, in FHIR, its own `system`).
"""

from django.apps import apps as django_apps
from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import IdentifierSequence, Patient, PatientIdentifier

# Registration `id_document_type` → identifier kind.
DOCUMENT_KIND = {
    "NATIONAL_ID": PatientIdentifier.KIND_NATIONAL_ID,
    "PASSPORT": PatientIdentifier.KIND_PASSPORT,
    "REFUGEE_ID": PatientIdentifier.KIND_REFUGEE,
    "ALIEN_ID": PatientIdentifier.KIND_ALIEN,
    "BIRTH_CERTIFICATE": PatientIdentifier.KIND_BIRTH_CERT,
}


# Temporary (unidentified / unknown-identity) numbers. New ones are
# CIT-ER-000001…; ER-YYYYMM<org>-NNN numbers issued before 2026-10 are kept
# unchanged (project owner decision) and are still temporary.
TEMPORARY_SEQUENCE = "CIT-ER"
TEMPORARY_PREFIXES = ("CIT-ER-", "ER-")


def is_temporary_number(number):
    return bool(number) and number.startswith(TEMPORARY_PREFIXES)


def _next_temporary_number():
    """CIT-ER-000001, CIT-ER-000002, … — one series for the deployment, because
    `citramac_number` is unique across organisations and every temporary number
    shares one FHIR identifier system. The row lock serialises allocation; the
    increment commits or rolls back with the registration that took it, so an
    issued number is never handed out again."""
    with transaction.atomic():
        sequence, _ = IdentifierSequence.objects.select_for_update().get_or_create(
            name=TEMPORARY_SEQUENCE
        )
        sequence.last_value += 1
        sequence.save(update_fields=["last_value"])
    return f"{TEMPORARY_SEQUENCE}-{sequence.last_value:06d}"


def generate_citramac_number(organization, temporary=False):
    """
    Local business identifier, generated before any network call. Permanent
    numbers: a transaction-scoped advisory lock per prefix makes the
    read-then-assign race-free; the highest existing suffix (not the count) is
    used so a gap can never produce a duplicate. Temporary numbers come from
    the CIT-ER sequence.
    """
    if temporary:
        return _next_temporary_number()
    prefix = f"{timezone.now():%Y%m}{organization.slug[:4].upper()}"
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [prefix])
        highest = 0
        for number in Patient.all_objects.filter(
            citramac_number__startswith=f"{prefix}-"
        ).values_list("citramac_number", flat=True):
            tail = number.rsplit("-", 1)[-1]
            if tail.isdigit():
                highest = max(highest, int(tail))
        return f"{prefix}-{highest + 1:03d}"


def record_identifier(patient, kind, value, *, verified_source="", verified_at=None):
    """Add an identifier to the person. Returns (identifier, created). A value
    already held by the same person is a no-op; one held by someone else
    raises — the caller decides whether that is a duplicate to merge."""
    value = (value or "").strip()
    if not value:
        return None, False
    existing = PatientIdentifier.all_objects.filter(
        organization_id=patient.organization_id,
        kind=kind,
        value=value,
        superseded_at__isnull=True,
    ).first()
    if existing:
        if existing.patient_id == patient.pk:
            return existing, False
        raise ValidationError(
            {
                "identifier": f"{dict(PatientIdentifier.KIND_CHOICES)[kind]} {value} already "
                "belongs to another client record. Search for that client and use their record.",
                "duplicate_of": str(existing.patient_id),
            }
        )
    identifier = PatientIdentifier.objects.create(
        organization_id=patient.organization_id,
        patient=patient,
        kind=kind,
        value=value,
        verified_at=verified_at,
        verified_by_source=verified_source,
    )
    return identifier, True


def sync_identifiers(patient):
    """Mirror the legacy single-value fields into the identifier slices, so the
    FHIR mapper and duplicate search read one place. Idempotent."""
    if patient.citramac_number:
        kind = (
            PatientIdentifier.KIND_TEMPORARY
            if is_temporary_number(patient.citramac_number)
            else PatientIdentifier.KIND_CITRAMAC
        )
        record_identifier(patient, kind, patient.citramac_number)
    for kind, value in (
        (PatientIdentifier.KIND_UHID, patient.uhid_number),
        (PatientIdentifier.KIND_NATIONAL_ID, patient.national_id),
        (PatientIdentifier.KIND_PASSPORT, patient.passport_number),
        (PatientIdentifier.KIND_IPRS, patient.upi),
    ):
        record_identifier(patient, kind, value)
    doc_kind = DOCUMENT_KIND.get(patient.id_document_type)
    if doc_kind and patient.id_document_number:
        record_identifier(patient, doc_kind, patient.id_document_number)


def find_duplicates(
    organization_id,
    *,
    identifiers=None,
    last_name="",
    date_of_birth=None,
    gender="",
    phone="",
    exclude_patient_id=None,
):
    """
    Candidate duplicates, strongest first. `exact` = a recorded identifier
    already belongs to someone (block creation); `probable` = same date of
    birth + sex and a matching surname or phone (warn, let the clinician
    decide). Returns a list of {"patient", "match", "reason"}.
    """
    found = {}
    base = Patient.all_objects.filter(organization_id=organization_id, merged_into__isnull=True)
    if exclude_patient_id:
        base = base.exclude(pk=exclude_patient_id)

    for kind, value in (identifiers or {}).items():
        if not value:
            continue
        hit = PatientIdentifier.all_objects.filter(
            organization_id=organization_id,
            kind=kind,
            value=str(value).strip(),
            superseded_at__isnull=True,
        )
        if exclude_patient_id:
            hit = hit.exclude(patient_id=exclude_patient_id)
        for row in hit.select_related("patient"):
            found.setdefault(
                row.patient_id,
                {"patient": row.patient, "match": "exact", "reason": f"Same {kind.lower()}"},
            )

    if date_of_birth and gender:
        query = Q()
        if last_name:
            query |= Q(last_name__iexact=last_name.strip())
        if phone:
            query |= Q(contact_phone=phone.strip())
        if query:
            for patient in base.filter(date_of_birth=date_of_birth, gender=gender).filter(query):
                found.setdefault(
                    patient.pk,
                    {
                        "patient": patient,
                        "match": "probable",
                        "reason": "Same date of birth and sex, matching surname or phone",
                    },
                )
    return sorted(found.values(), key=lambda item: item["match"] != "exact")


@transaction.atomic
def merge_patients(user, temporary, permanent):
    """
    Merge a temporary (unidentified / unknown) record into an existing
    permanent one. Every clinical row is re-pointed to the permanent record;
    the temporary record survives as a stub with `merged_into` set (FHIR
    `Patient.link` type replaced-by), and its identifiers move across marked
    superseded so the old emergency number still resolves to the person.
    """
    if temporary.pk == permanent.pk:
        raise ValidationError({"detail": "A record cannot be merged into itself."})
    if temporary.identity_status == Patient.IDENTITY_IDENTIFIED:
        raise ValidationError({"detail": "Only a temporary record can be merged away."})
    if permanent.identity_status != Patient.IDENTITY_IDENTIFIED:
        raise ValidationError({"detail": "Merge target must be an identified record."})
    if temporary.merged_into_id or permanent.merged_into_id:
        raise ValidationError({"detail": "One of these records has already been merged."})
    if temporary.organization_id != permanent.organization_id:
        raise ValidationError({"detail": "Records belong to different organisations."})

    now = timezone.now()
    moved = {}
    for model in django_apps.get_models():
        if model is Patient or model is PatientIdentifier:
            continue
        for field in model._meta.get_fields():
            if (
                field.is_relation
                and field.many_to_one
                and getattr(field, "related_model", None) is Patient
                and not field.auto_created
            ):
                count = model._base_manager.filter(**{field.name: temporary}).update(
                    **{field.name: permanent}
                )
                if count:
                    moved[f"{model._meta.label}.{field.name}"] = count

    for identifier in PatientIdentifier.all_objects.filter(patient=temporary):
        identifier.patient = permanent
        identifier.superseded_at = now
        identifier.save(update_fields=["patient", "superseded_at", "updated_at"])

    temporary.merged_into = permanent
    temporary.merged_at = now
    temporary.next_of_kin = None
    temporary.save(update_fields=["merged_into", "merged_at", "next_of_kin", "updated_at"])
    return {"surviving_patient_id": str(permanent.pk), "moved": moved}
