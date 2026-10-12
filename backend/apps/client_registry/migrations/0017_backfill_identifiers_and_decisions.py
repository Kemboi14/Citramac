from django.db import migrations
from django.utils import timezone

DOCUMENT_KIND = {
    "NATIONAL_ID": "NATIONAL_ID",
    "PASSPORT": "PASSPORT",
    "REFUGEE_ID": "REFUGEE_ID",
    "ALIEN_ID": "ALIEN_ID",
    "BIRTH_CERTIFICATE": "BIRTH_CERTIFICATE",
}


def forwards(apps, schema_editor):
    ConsentRecord = apps.get_model("client_registry", "ConsentRecord")
    # `decision` defaults to YES; a pre-existing revocation must read as NO.
    ConsentRecord.all_objects.filter(granted=False).update(decision="NO")

    Patient = apps.get_model("client_registry", "Patient")
    PatientIdentifier = apps.get_model("client_registry", "PatientIdentifier")
    seen = set()
    for patient in Patient.all_objects.all().iterator():
        pairs = [
            ("TEMPORARY" if patient.citramac_number.startswith("ER-") else "CITRAMAC",
             patient.citramac_number),
            ("UHID", patient.uhid_number),
            ("NATIONAL_ID", patient.national_id),
            ("PASSPORT", patient.passport_number),
            ("IPRS_UPI", patient.upi),
        ]
        doc_kind = DOCUMENT_KIND.get(patient.id_document_type)
        if doc_kind:
            pairs.append((doc_kind, patient.id_document_number))
        for kind, value in pairs:
            value = (value or "").strip()
            key = (patient.organization_id, kind, value)
            if not value or key in seen:
                continue  # blank, or a value two records already share — leave for review
            seen.add(key)
            PatientIdentifier.all_objects.create(
                organization_id=patient.organization_id,
                patient=patient,
                kind=kind,
                value=value,
                created_at=timezone.now(),
                updated_at=timezone.now(),
            )


class Migration(migrations.Migration):
    dependencies = [
        ("client_registry", "0016_patientidentifier_rls"),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
