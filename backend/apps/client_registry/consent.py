"""
Consent capture/revocation — docs/09-SECURITY-COMPLIANCE.md §9.5. Every
call writes an immutable ConsentRecord (the audit-defensible history) and
updates the Patient's denormalized "current state" fields (used by
existing reads/serializers) to match the latest record.
"""

from django.utils import timezone

from .models import ConsentRecord


def capture_consent(patient, user, granted, consent_text_version, consent_text_snapshot):
    record = ConsentRecord.objects.create(
        organization=patient.organization,
        patient=patient,
        granted=granted,
        consent_text_version=consent_text_version,
        consent_text_snapshot=consent_text_snapshot,
        captured_by=user,
    )
    patient.consent_data_sharing = granted
    patient.consent_captured_at = timezone.now()
    patient.save(update_fields=["consent_data_sharing", "consent_captured_at"])
    return record
