"""
Patient-side FHIR resources: Patient (sliced identifiers), RelatedPerson
(next of kin), Consent (HIE sharing decisions) and Provenance (registration).

CLAUDE.md rules applied here:
- §4 identifiers sliced, each with its own `system`; the system URI comes from
  settings, never from code. A national identifier with no configured system is
  *omitted* from outbound FHIR and reported in `omitted` so the caller can log
  it — nothing is sent under an invented URI (§6).
- §4 consent and security labels: `meta.security` on Patient; Consent built
  from the append-only ConsentRecord history.
- §3 item 4: Provenance says who recorded the registration, when, for whom.
- Built with `fhir.resources.R4B` per the documented 2026-09-18 exception and
  checked against the vendored R4 4.0.1 schema by the conformance tests.
"""

import logging

from django.conf import settings
from fhir.resources.R4B.address import Address
from fhir.resources.R4B.codeableconcept import CodeableConcept
from fhir.resources.R4B.coding import Coding
from fhir.resources.R4B.consent import Consent, ConsentProvision
from fhir.resources.R4B.contactpoint import ContactPoint
from fhir.resources.R4B.humanname import HumanName
from fhir.resources.R4B.identifier import Identifier
from fhir.resources.R4B.meta import Meta
from fhir.resources.R4B.patient import Patient as FhirPatient
from fhir.resources.R4B.patient import PatientContact, PatientLink
from fhir.resources.R4B.period import Period
from fhir.resources.R4B.provenance import Provenance, ProvenanceAgent
from fhir.resources.R4B.reference import Reference
from fhir.resources.R4B.relatedperson import RelatedPerson

logger = logging.getLogger(__name__)

_GENDER = {"MALE": "male", "FEMALE": "female", "OTHER": "other"}
CONFIDENTIALITY_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-Confidentiality"
CONSENT_SCOPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/consentscope"
V2_RELATIONSHIP_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0131"

# Our own namespaces. Used only when FHIR_LOCAL_SYSTEM_BASE is unset, and
# preserving what the system already emitted; flagged for the project owner.
_LOCAL_FALLBACK = {
    "CITRAMAC": "urn:citramac:citramac-number",
    "TEMPORARY": "urn:citramac:temporary-number",
}


def identifier_system(kind, organization=None):
    """The configured `system` for an identifier kind, or None if not configured."""
    base = (getattr(settings, "FHIR_LOCAL_SYSTEM_BASE", "") or "").rstrip("/")
    if kind in ("CITRAMAC", "TEMPORARY"):
        suffix = "citramac-number" if kind == "CITRAMAC" else "temporary-number"
        return f"{base}/{suffix}" if base else _LOCAL_FALLBACK[kind]
    if kind == "UHID":
        if not base or organization is None:
            return None  # a facility UHID without a per-org namespace is ambiguous
        return f"{base}/uhid/{organization.slug}"
    return (settings.FHIR_NATIONAL_IDENTIFIER_SYSTEMS.get(kind) or "") or None


def _identifiers(patient):
    """(fhir identifiers, omitted descriptions). Superseded identifiers are kept
    but marked `use=old`, so an emergency number still resolves after a merge."""
    out, omitted = [], []
    for row in patient.identifiers.all():
        system = identifier_system(row.kind, patient.organization)
        if not system:
            omitted.append(f"{row.kind}: no FHIR system configured")
            continue
        out.append(
            Identifier(
                system=system,
                value=row.value,
                use="old" if row.superseded_at else ("temp" if row.kind == "TEMPORARY" else "usual"),
                type=CodeableConcept(text=row.get_kind_display()),
            )
        )
    return out, omitted


def _names(patient):
    names = []
    if patient.first_name or patient.last_name:
        given = [patient.first_name] if patient.first_name else []
        given += patient.middle_other_names.split() if patient.middle_other_names else []
        names.append(
            HumanName(use="official", family=patient.last_name or None, given=given or None)
        )
    else:
        # Unidentified / unknown: a temporary name, never a blank HumanName.
        if patient.identity_description:
            text = f"{patient.identity_description} ({patient.citramac_number})"
        else:
            text = patient.get_full_name()
        names.append(HumanName(use="temp", text=text))
    if patient.preferred_name:
        names.append(HumanName(use="usual", text=patient.preferred_name))
    return names


def _contact_points(patient):
    points = []
    if patient.contact_phone:
        points.append(ContactPoint(system="phone", value=patient.contact_phone, use="mobile"))
    if patient.contact_email:
        points.append(ContactPoint(system="email", value=patient.contact_email))
    return points


def _relationship(contact):
    if contact.contact_role == "BROUGHT_BY":
        # The person who brought an emergency arrival in is not next of kin;
        # text only — no relationship code is asserted for them.
        detail = f" — {contact.relationship}" if contact.relationship else ""
        return CodeableConcept(text=f"Brought the client to the facility{detail}")
    text = "Guardian" if contact.is_guardian else (contact.relationship or "Next of kin")
    coding = []
    if not contact.is_guardian:
        # HL7 v2 table 0131 "N" = next-of-kin. VERIFY against the national IG.
        coding = [Coding(system=V2_RELATIONSHIP_SYSTEM, code="N", display="Next-of-Kin")]
    return CodeableConcept(coding=coding or None, text=text)


def build_patient_resource(patient):
    """Returns (Patient, omitted) — `omitted` lists identifiers withheld for want
    of a configured system URI, for the caller to log."""
    identifiers, omitted = _identifiers(patient)
    contacts = []
    for contact in patient.emergency_contacts.all():
        points = []
        if contact.phone:
            points.append(ContactPoint(system="phone", value=contact.phone))
        if contact.email:
            points.append(ContactPoint(system="email", value=contact.email))
        contacts.append(
            PatientContact(
                relationship=[_relationship(contact)],
                name=HumanName(text=contact.name),
                telecom=points or None,
            )
        )
    address = None
    if patient.address or patient.county:
        address = [Address(text=patient.address or None, district=patient.county or None)]
    links = None
    if patient.merged_into_id:
        links = [
            PatientLink(
                other=Reference(reference=f"Patient/{patient.merged_into_id}"),
                type="replaced-by",
            )
        ]
    security = [
        Coding(
            system=CONFIDENTIALITY_SYSTEM,
            code=settings.FHIR_PSYCH_CONFIDENTIALITY_CODE,
        )
    ]
    resource = FhirPatient(
        id=str(patient.id),
        meta=Meta(security=security),
        active=patient.merged_into_id is None,
        identifier=identifiers or None,
        name=_names(patient),
        telecom=_contact_points(patient) or None,
        # NOT_STATED and NOT_SAID ("Prefer not to say") → unknown. Pronouns,
        # disability, employment and occupation stay local (owner decision).
        # VERIFY: Patient.maritalStatus (system
        # http://terminology.hl7.org/CodeSystem/v3-MaritalStatus) is not emitted
        # until the local → v3 code mapping is confirmed against the national IG.
        gender=_GENDER.get(patient.gender, "unknown"),
        birthDate=patient.date_of_birth,
        address=address,
        contact=contacts or None,
        link=links,
    )
    return resource, omitted


def build_related_person(contact, patient_ref):
    points = []
    if contact.phone:
        points.append(ContactPoint(system="phone", value=contact.phone))
    if contact.email:
        points.append(ContactPoint(system="email", value=contact.email))
    return RelatedPerson(
        id=str(contact.id),
        patient=Reference(reference=patient_ref),
        relationship=[_relationship(contact)],
        name=[HumanName(text=contact.name)],
        telecom=points or None,
    )


def build_hie_consent(record):
    """FHIR Consent from one ConsentRecord. NOT_ASKED is never emitted (there
    is no decision to carry); RESTRICTED is a `deny` toward the HIE so the
    fail-safe direction is withholding — the nuance is kept in category text."""
    if record.decision == "NOT_ASKED":
        return None
    label = record.get_consent_type_display()
    permit = record.decision == "YES"
    if record.decision == "RESTRICTED":
        label = f"{label} — restricted to the treating facility"
    period = Period(end=record.valid_until.isoformat()) if record.valid_until else None
    return Consent(
        id=str(record.id),
        status="active",
        scope=CodeableConcept(
            coding=[Coding(system=CONSENT_SCOPE_SYSTEM, code="patient-privacy")]
        ),
        category=[CodeableConcept(text=label)],
        patient=Reference(reference=f"Patient/{record.patient_id}"),
        dateTime=record.captured_at.isoformat(),
        performer=[Reference(reference=f"Patient/{record.patient_id}")],
        policyRule=None,
        provision=ConsentProvision(
            type="permit" if permit else "deny",
            period=period,
        ),
    )


def build_registration_provenance(patient, user, recorded_at):
    """Who recorded the registration, when, for whom (CLAUDE.md §3 item 4)."""
    name = (user.get_full_name() if hasattr(user, "get_full_name") else "") or str(user)
    return Provenance(
        id=f"prov-{patient.id}",
        target=[Reference(reference=f"Patient/{patient.id}")],
        recorded=recorded_at.isoformat(),
        agent=[
            ProvenanceAgent(
                type=CodeableConcept(text="author"),
                who=Reference(display=name),
            )
        ],
    )
