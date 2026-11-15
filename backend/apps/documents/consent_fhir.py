"""
FHIR R4 for a signed consent — read-time, built from the consent and its
signatures (no second store). Built with fhir.resources R4B models, as everywhere
else (guide.md 2026-09-18 amendment); checked against the vendored R4 4.0.1
schema and our profiles in tests, and by HL7's validator in CI.

Mapping (owner, 2026-11-13):

| Source | R4 resource | Profile |
|---|---|---|
| care_pathway.VisitConsent, or a signed consent document (CON-01..11) | Consent | citramac-signed-consent |
| documents.PartySignature rows (+ the authorising clinician of a document) | Provenance | citramac-consent-signature-provenance |
| the client | Patient | Kenya Core / base, as elsewhere |

- Consent: patient = the client; performer = whoever gave the consent (the client,
  or a parent / guardian / substitute named as display); scope `treatment` for a
  treatment decision, `patient-privacy` for sharing / communication (HL7
  consentscope, already used by the registration Consent); category = the decision
  or document as text; policyRule = the facility wording's version (text, ppc-1);
  provision permit, or deny for a withdrawal (CON-11). A deferred consent not yet
  obtained is `proposed` with no performer. A consent document's signed PDF is
  named in sourceAttachment (title and creation only — the PDF itself is not
  embedded).
- Provenance: target = the Consent; one agent per signer; one `signature` per
  drawn signature (sigFormat image/png, the PNG as data), typed by a local
  signer-role code; `onBehalfOf` = the client for a guardian / substitute. A
  person unable to sign is an agent whose role states the reason — never a
  signature. The staff witness always signs.

Sensitivity (§3 item 6): R + PSY on the Consent and Provenance (a consent given at
a mental-health / addiction service discloses that care), as on the psychotherapy
note. Consents are not sent to the SHR.

VERIFY (guide.md §6), local until confirmed:
- ISO-ASTM E1762 signature-type codes for Signature.type (the base binding is
  `preferred`; ours are local `urn:citramac:codesystem:signature-role`);
- that a drawn, witnessed signature meets Kenyan e-signature / data-protection
  requirements for each consent (owner / legal counsel);
- our canonical base (urn:citramac: until then).
"""

import base64
import json
import uuid

from fhir.resources.R4B.attachment import Attachment
from fhir.resources.R4B.bundle import Bundle, BundleEntry
from fhir.resources.R4B.codeableconcept import CodeableConcept
from fhir.resources.R4B.coding import Coding
from fhir.resources.R4B.consent import Consent, ConsentProvision
from fhir.resources.R4B.meta import Meta
from fhir.resources.R4B.period import Period
from fhir.resources.R4B.provenance import Provenance, ProvenanceAgent
from fhir.resources.R4B.reference import Reference
from fhir.resources.R4B.signature import Signature

from apps.care_pathway.psychotherapy_fhir import security_labels
from apps.dha_interop.fhir_mapper import build_patient_resource
from apps.dha_interop.fhir_patient import CONSENT_SCOPE_SYSTEM

from .models import PartySignature
from .signatures import ROLE_LABELS, content_sha256, visit_consent_content

PROFILE_BASE = "urn:citramac:StructureDefinition"
CONSENT_PROFILE = f"{PROFILE_BASE}:signed-consent"
PROVENANCE_PROFILE = f"{PROFILE_BASE}:consent-signature-provenance"
SIGNATURE_ROLE_SYSTEM = "urn:citramac:codesystem:signature-role"
SIGNATURE_ROLE_CODES = {
    PartySignature.ROLE_CLIENT: "client",
    PartySignature.ROLE_GUARDIAN: "guardian",
    PartySignature.ROLE_SUBSTITUTE: "substitute-decision-maker",
    PartySignature.ROLE_RELATED_PERSON: "related-person",
    PartySignature.ROLE_WITNESS: "witness",
}
# Decision consents about care itself; the rest are about information sharing.
TREATMENT_DECISIONS = {"ADMISSION", "MEDICATION", "WITHDRAWAL_MGMT", "OTHER"}
TREATMENT_DOCUMENTS = {"DOC-CON-01", "DOC-CON-02", "DOC-CON-03"}
WITHDRAWAL_DOCUMENT = "DOC-CON-11"
SIGNED_DOCUMENT_STATES = ("SIGNED", "RELEASED", "FILED")
_NAMESPACE = uuid.UUID("7d1c2f4e-3b6a-4c8d-9e0f-a1b2c3d4e5f6")


def _ref(pk):
    return f"urn:uuid:{pk}"


def _derived_id(kind, pk):
    return str(uuid.uuid5(_NAMESPACE, f"{kind}:{pk}"))


def _meta(profile):
    return Meta(profile=[profile], security=security_labels())


def _scope(code):
    return CodeableConcept(coding=[Coding(system=CONSENT_SCOPE_SYSTEM, code=code)])


def _signer_reference(row, patient_ref):
    if row.role == PartySignature.ROLE_CLIENT:
        return Reference(reference=patient_ref)
    label = ROLE_LABELS[row.role]
    if row.relationship and row.role != PartySignature.ROLE_WITNESS:
        label = f"{label}, {row.relationship}"
    return Reference(display=f"{row.signer_name} ({label})")


def _role_coding(row):
    return Coding(
        system=SIGNATURE_ROLE_SYSTEM,
        code=SIGNATURE_ROLE_CODES[row.role],
        display=ROLE_LABELS[row.role],
    )


def _on_behalf_of(row, patient_ref):
    if row.role in (PartySignature.ROLE_GUARDIAN, PartySignature.ROLE_SUBSTITUTE):
        return Reference(reference=patient_ref)
    return None


def _provenance(target_pk, consent_ref, patient_ref, rows, extra_agents=()):
    agents, sigs = [], []
    for row in rows:
        who = _signer_reference(row, patient_ref)
        on_behalf = _on_behalf_of(row, patient_ref)
        role = None
        if row.method == PartySignature.METHOD_UNABLE:
            role = [CodeableConcept(text=f"Unable to sign: {row.unable_reason}")]
        agents.append(
            ProvenanceAgent(
                type=CodeableConcept(coding=[_role_coding(row)]),
                role=role,
                who=who,
                onBehalfOf=on_behalf,
            )
        )
        if row.method == PartySignature.METHOD_DRAWN:
            sigs.append(
                Signature(
                    type=[_role_coding(row)],
                    when=row.captured_at.isoformat(),
                    who=who,
                    onBehalfOf=on_behalf,
                    sigFormat="image/png",
                    data=base64.b64encode(bytes(row.image_png)).decode("ascii"),
                )
            )
    agents.extend(extra_agents)
    return Provenance(
        id=_derived_id("signatures", target_pk),
        meta=_meta(PROVENANCE_PROFILE),
        target=[Reference(reference=consent_ref)],
        recorded=max(r.captured_at for r in rows).isoformat(),
        activity=CodeableConcept(text="Consent signed on screen, witnessed"),
        agent=agents,
        signature=sigs,
    )


def _bundle(patient, consent, provenance, bundle_pk):
    patient_ref = _ref(patient.pk)
    entries = [
        BundleEntry(fullUrl=f"urn:uuid:{consent.id}", resource=consent),
        BundleEntry(fullUrl=patient_ref, resource=build_patient_resource(patient)),
    ]
    if provenance is not None:
        entries.append(BundleEntry(fullUrl=f"urn:uuid:{provenance.id}", resource=provenance))
    bundle = Bundle(
        id=_derived_id("bundle", bundle_pk),
        meta=Meta(security=security_labels()),
        type="collection",
        entry=entries,
    )
    return json.loads(bundle.json())


def build_visit_consent_bundle(consent):
    """A decision consent: Consent, Patient and — once signed — the signatures."""
    from apps.care_pathway.services import concept_labels

    patient_ref = _ref(consent.patient_id)
    current = content_sha256(visit_consent_content(consent))
    rows = list(consent.signatures.filter(content_sha256=current).order_by("captured_at"))
    label = concept_labels().get(("capacity-decision", consent.scope), consent.scope)
    if consent.scope == "OTHER" and consent.scope_detail:
        label = f"{label}: {consent.scope_detail}"
    open_deferred = consent.party == "DEFERRED" and not consent.completed_at
    deciders = [r for r in rows if r.role != PartySignature.ROLE_WITNESS]
    resource = Consent(
        id=str(consent.pk),
        meta=_meta(CONSENT_PROFILE),
        status="proposed" if open_deferred else "active",
        scope=_scope("treatment" if consent.scope in TREATMENT_DECISIONS else "patient-privacy"),
        category=[CodeableConcept(text=f"Consent for: {label}")],
        patient=Reference(reference=patient_ref),
        dateTime=(consent.completed_at or consent.recorded_at).isoformat(),
        performer=[_signer_reference(r, patient_ref) for r in deciders] or None,
        policyRule=CodeableConcept(
            text="Decision consent recorded by the treating team (no separate facility wording)"
        ),
        provision=ConsentProvision(type="permit"),
    )
    provenance = _provenance(consent.pk, _ref(consent.pk), patient_ref, rows) if rows else None
    return _bundle(consent.patient, resource, provenance, consent.pk)


def build_document_consent_bundle(doc):
    """A SIGNED consent document: Consent (the facility wording's version, the
    signed PDF named), Patient, and the parties' and witness's signatures with the
    authorising clinician. Raises ValueError for an unsigned document."""
    from apps.care_pathway.services import user_display

    if doc.status not in SIGNED_DOCUMENT_STATES or not doc.signed_at:
        raise ValueError("Only a signed consent document is exported.")
    content = doc.content or {}
    wording = content.get("wording") or {}
    patient_ref = _ref(doc.patient_id)
    rows = list(
        doc.party_signatures.filter(content_sha256=doc.content_hash).order_by("captured_at")
    )
    deciders = [r for r in rows if r.role not in (PartySignature.ROLE_WITNESS,)]
    valid_until = (doc.inputs or {}).get("valid_until")
    resource = Consent(
        id=str(doc.pk),
        meta=_meta(CONSENT_PROFILE),
        status="active",
        scope=_scope("treatment" if doc.template_id in TREATMENT_DOCUMENTS else "patient-privacy"),
        category=[CodeableConcept(text=content.get("title") or doc.template_id)],
        patient=Reference(reference=patient_ref),
        dateTime=doc.signed_at.isoformat(),
        performer=[_signer_reference(r, patient_ref) for r in deciders] or None,
        sourceAttachment=Attachment(
            contentType="application/pdf",
            title=f"{doc.document_number} v{doc.version} (signed)",
            creation=doc.signed_at.isoformat(),
        ),
        policyRule=CodeableConcept(
            text=f"Facility consent wording, version {wording.get('version') or 'not recorded'}"
        ),
        provision=ConsentProvision(
            type="deny" if doc.template_id == WITHDRAWAL_DOCUMENT else "permit",
            period=Period(end=valid_until) if valid_until else None,
        ),
    )
    clinician = ProvenanceAgent(
        type=CodeableConcept(text="Authorising clinician"),
        who=Reference(display=user_display(doc.signed_by)),
    )
    provenance = (
        _provenance(doc.pk, _ref(doc.pk), patient_ref, rows, extra_agents=[clinician])
        if rows
        else None
    )
    return _bundle(doc.patient, resource, provenance, doc.pk)
