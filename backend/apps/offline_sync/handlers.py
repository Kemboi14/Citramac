"""
Entity-specific apply logic for the offline sync push endpoint —
docs/08-DHA-SHA-INTEGRATION.md §8.5. Only the two "core clinical entry
screens" explicitly named in the doc are wired here: Vital Signs (Triage)
and SOAP Notes. Prescriptions offline entry is a documented extension
point, not implemented — applying a stale offline prescription needs
allergy/interaction re-checks against current data, which doesn't make
sense to run against a payload written while disconnected.
"""

from apps.clinical_encounter.models import SoapNote
from apps.triage.models import VitalSigns

VITALS_FIELDS = [
    "systolic_bp",
    "diastolic_bp",
    "heart_rate",
    "respiratory_rate",
    "temperature_c",
    "spo2",
    "height_cm",
    "weight_kg",
    "esi_acuity_level",
]
SOAP_NOTE_FIELDS = ["subjective", "objective", "assessment", "plan"]


def apply_vitals(organization, user, encounter_id, payload, server_entity_id=None):
    fields = {key: payload[key] for key in VITALS_FIELDS if key in payload}
    if server_entity_id:
        instance = VitalSigns.objects.get(pk=server_entity_id)
        for key, value in fields.items():
            setattr(instance, key, value)
        instance.save()
    else:
        instance = VitalSigns.objects.create(
            organization=organization, encounter_id=encounter_id, recorded_by=user, **fields
        )
    return instance.id


def apply_soap_note(organization, user, encounter_id, payload, server_entity_id=None):
    fields = {key: payload[key] for key in SOAP_NOTE_FIELDS if key in payload}
    if server_entity_id:
        instance = SoapNote.objects.get(pk=server_entity_id)
        for key, value in fields.items():
            setattr(instance, key, value)
        instance.save()  # raises PermissionError if already signed/locked
    else:
        instance = SoapNote.objects.create(
            organization=organization, encounter_id=encounter_id, author=user, **fields
        )
    return instance.id


ENTITY_HANDLERS = {"VITALS": apply_vitals, "SOAP_NOTE": apply_soap_note}
