"""
HL7 FHIR resource mapping — docs/08-DHA-SHA-INTEGRATION.md §8.1.

Builds real, schema-validated FHIR resources (via the `fhir.resources`
library's R4B models — the technical-correction release of R4, functionally
equivalent for the resource types used here) from internal ORM models. Do
not hand-roll FHIR JSON without schema validation, per the doc's explicit
instruction.
"""

import json

from fhir.resources.R4B.bundle import Bundle, BundleEntry
from fhir.resources.R4B.codeableconcept import CodeableConcept
from fhir.resources.R4B.coding import Coding
from fhir.resources.R4B.composition import Composition, CompositionSection
from fhir.resources.R4B.condition import Condition
from fhir.resources.R4B.dosage import Dosage
from fhir.resources.R4B.humanname import HumanName
from fhir.resources.R4B.identifier import Identifier
from fhir.resources.R4B.medicationrequest import MedicationRequest
from fhir.resources.R4B.patient import Patient as FhirPatient
from fhir.resources.R4B.reference import Reference

_GENDER_MAP = {"MALE": "male", "FEMALE": "female", "OTHER": "other"}


def _urn(resource_type, internal_id):
    """Bundle-local reference urn — resolved to real HIE identifiers on ingest."""
    return f"urn:citramac:{resource_type.lower()}:{internal_id}"


def build_patient_resource(patient):
    fhir_id = str(patient.id)
    name = HumanName(family=patient.last_name, given=[patient.first_name])
    identifiers = []
    if patient.national_id:
        identifiers.append(Identifier(system="urn:citramac:national-id", value=patient.national_id))
    if patient.citramac_number:
        identifiers.append(
            Identifier(system="urn:citramac:citramac-number", value=patient.citramac_number)
        )
    return FhirPatient(
        id=fhir_id,
        identifier=identifiers or None,
        name=[name],
        gender=_GENDER_MAP.get(patient.gender, "unknown"),
        birthDate=patient.date_of_birth,
    )


def build_condition_resource(diagnosis, patient_ref):
    return Condition(
        id=str(diagnosis.id),
        subject=Reference(reference=patient_ref),
        code=CodeableConcept(
            coding=[
                Coding(
                    system="http://id.who.int/icd/release/11/mms",
                    code=diagnosis.icd11_code_id,
                    display=diagnosis.icd11_code.description,
                )
            ]
        ),
    )


def build_medication_request_resource(item, patient_ref):
    return MedicationRequest(
        id=str(item.id),
        status="active",
        intent="order",
        subject=Reference(reference=patient_ref),
        medicationCodeableConcept=CodeableConcept(
            coding=[
                Coding(
                    system="urn:citramac:national-drug-index",
                    code=item.drug_id,
                    display=item.drug.generic_name,
                )
            ]
        ),
        dosageInstruction=[
            Dosage(
                text=" ".join(filter(None, [item.dose, item.route, item.frequency, item.duration]))
                or None
            )
        ],
    )


def build_referral_bundle(referral_packet):
    """
    Composition + Patient + Condition(s) + MedicationRequest(s) referencing
    the encounter's diagnoses/prescriptions — docs/08-DHA-SHA-INTEGRATION.md
    §8.1: "Every E-Referral builds a FHIR Bundle ... and transmits it to the
    National Health Information Exchange (HIE) endpoint." Returns the Bundle
    as a plain JSON-safe dict, the form stored on `ReferralPacket.fhir_bundle_json`
    and transmitted by `hie_client.transmit_referral`.
    """
    encounter = referral_packet.encounter
    patient = encounter.patient
    patient_ref = _urn("Patient", patient.id)

    patient_resource = build_patient_resource(patient)
    entries = [BundleEntry(fullUrl=patient_ref, resource=patient_resource)]

    section_references = []
    for diagnosis in encounter.diagnoses.select_related("icd11_code").all():
        condition_ref = _urn("Condition", diagnosis.id)
        entries.append(
            BundleEntry(
                fullUrl=condition_ref,
                resource=build_condition_resource(diagnosis, patient_ref),
            )
        )
        section_references.append(Reference(reference=condition_ref))

    for prescription in encounter.prescriptions.prefetch_related("items__drug").all():
        for item in prescription.items.all():
            med_ref = _urn("MedicationRequest", item.id)
            entries.append(
                BundleEntry(
                    fullUrl=med_ref,
                    resource=build_medication_request_resource(item, patient_ref),
                )
            )
            section_references.append(Reference(reference=med_ref))

    author_name = "CITRAMAC System"
    if encounter.opened_by_id:
        full_name = f"{encounter.opened_by.first_name} {encounter.opened_by.last_name}".strip()
        if full_name:
            author_name = full_name

    composition = Composition(
        id=str(referral_packet.id),
        status="final",
        type=CodeableConcept(
            coding=[
                Coding(
                    system="http://loinc.org",
                    code="57133-1",
                    display="Referral note",
                )
            ]
        ),
        subject=Reference(reference=patient_ref),
        date=referral_packet.created_at.isoformat(),
        author=[Reference(display=author_name)],
        title=f"Referral to {referral_packet.destination_facility}",
        section=(
            [CompositionSection(title="Clinical Summary", entry=section_references)]
            if section_references
            else None
        ),
    )
    composition_ref = _urn("Composition", referral_packet.id)
    entries.insert(0, BundleEntry(fullUrl=composition_ref, resource=composition))

    bundle = Bundle(type="document", entry=entries)
    # `.json()` (not `.dict()`) so dates serialize to proper FHIR ISO8601
    # strings — `.dict()` leaves native `datetime` objects in the tree,
    # which the plain `models.JSONField` encoder can't serialize on save.
    return json.loads(bundle.json(exclude_none=True))
