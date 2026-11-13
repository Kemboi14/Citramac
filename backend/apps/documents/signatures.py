"""
Electronic signatures on consents (owner decisions 2026-11-13).

Who signs:
- a decision consent (care_pathway.VisitConsent): the party giving it — the
  client, a parent / guardian or a substitute decision-maker — and the staff
  witness. A deferred (emergency) consent is signed when it is completed.
- a consent document (catalogue CON-01..11): the client, or a parent / guardian
  when the client is a minor (a substitute decision-maker may sign instead of an
  adult client); the named family member / caregiver as well on CON-04; and the
  staff witness. The clinician's own authorisation stays the document's "sign"
  step, and it is refused until every required signature matches the content.

How: drawn on screen and witnessed by the staff member present, who signs as
themselves. A party who cannot sign has the reason recorded instead, still
witnessed. Every signature is bound to the SHA-256 of what was signed, so a
document changed after signing must be signed again. Rows are append-only and
every capture is in the audit trail, with the image only as a fingerprint.

VERIFY (owner / legal counsel, CLAUDE.md §6): that a drawn, witnessed signature
meets Kenyan electronic-signature and data-protection consent requirements for
each of these consents. No statute is cited here.
"""

import base64
import binascii
import hashlib
import io
import json

from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError

from .models import GeneratedDocument, PartySignature

MAX_IMAGE_BYTES = 200_000
MAX_IMAGE_SIDE = 2000
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MINOR_AGE = 18

PARTY_ROLE = {
    "PATIENT": PartySignature.ROLE_CLIENT,
    "GUARDIAN": PartySignature.ROLE_GUARDIAN,
    "SUBSTITUTE": PartySignature.ROLE_SUBSTITUTE,
}
DECISION_ROLES = (
    PartySignature.ROLE_CLIENT,
    PartySignature.ROLE_GUARDIAN,
    PartySignature.ROLE_SUBSTITUTE,
)
ROLE_LABELS = dict(PartySignature.ROLE_CHOICES)
# The family-involvement consent document is also signed by the family member.
RELATED_PERSON_TEMPLATES = {"DOC-CON-04"}


def _sha256(data):
    return hashlib.sha256(data).hexdigest()


def content_sha256(content):
    return _sha256(json.dumps(content, sort_keys=True, default=str).encode("utf-8"))


def decode_png(value):
    """A drawn signature as PNG bytes, from a `data:image/png;base64,` URL.
    Refuses anything that is not a small, real PNG with something drawn on it."""
    prefix = "data:image/png;base64,"
    if not isinstance(value, str) or not value.startswith(prefix):
        raise ValidationError({"image": "Draw the signature."})
    try:
        data = base64.b64decode(value[len(prefix) :], validate=True)
    except (binascii.Error, ValueError):
        raise ValidationError({"image": "The signature image could not be read."}) from None
    if len(data) > MAX_IMAGE_BYTES or not data.startswith(PNG_MAGIC):
        raise ValidationError({"image": "The signature image could not be read."})
    from PIL import Image, UnidentifiedImageError

    try:
        with Image.open(io.BytesIO(data)) as probe:
            probe.verify()
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            if width > MAX_IMAGE_SIDE or height > MAX_IMAGE_SIDE:
                raise ValidationError({"image": "The signature image is too large."})
            rgba = image.convert("RGBA")
    except (UnidentifiedImageError, OSError, SyntaxError):
        raise ValidationError({"image": "The signature image could not be read."}) from None
    # Something must be drawn: an opaque pixel that is not near-white.
    alpha = rgba.getchannel("A")
    ink = Image.eval(rgba.convert("L"), lambda v: 255 if v < 200 else 0)
    from PIL import ImageChops

    if ImageChops.multiply(ink, alpha.point(lambda v: 255 if v > 0 else 0)).getbbox() is None:
        raise ValidationError({"image": "The signature is empty — draw it in the box."})
    return data


def _name(user):
    return (user.get_full_name() or user.email) if user else ""


def _build(target, patient, user, role, sig, content_hash, *, allow_unable):
    """An unsaved PartySignature from one signature payload."""
    sig = sig if isinstance(sig, dict) else {}
    row = PartySignature(
        organization_id=patient.organization_id,
        patient=patient,
        role=role,
        content_sha256=content_hash,
        captured_by=user,
        **target,
    )
    if role == PartySignature.ROLE_WITNESS:
        # The witness is the signed-in staff member, signing as themselves.
        row.signer_user, row.signer_name = user, _name(user)
    else:
        row.signer_name = str(sig.get("name") or "").strip()[:150]
        row.relationship = str(sig.get("relationship") or "").strip()[:100]
        if not row.signer_name:
            raise ValidationError({"signatures": f"Record the {ROLE_LABELS[role].lower()}'s name."})
        person_id = sig.get("related_person_id")
        if person_id:
            from apps.client_registry.models import EmergencyContact

            person = EmergencyContact.objects.filter(pk=person_id, patient=patient).first()
            if person is None:
                raise ValidationError(
                    {"signatures": "Choose one of the client's recorded contacts."}
                )
            row.related_person = person
            row.relationship = row.relationship or person.relationship
    unable = str(sig.get("unable_reason") or "").strip()
    if unable:
        if not allow_unable or role == PartySignature.ROLE_WITNESS:
            raise ValidationError({"signatures": "The staff witness must sign."})
        if len(unable) < 5:
            raise ValidationError({"signatures": "Say why they cannot sign."})
        row.method, row.unable_reason = PartySignature.METHOD_UNABLE, unable[:500]
    else:
        data = decode_png(sig.get("image"))
        row.method, row.image_png, row.image_sha256 = (
            PartySignature.METHOD_DRAWN,
            data,
            _sha256(data),
        )
    return row


def _save(row, user):
    # Audited by the trail's own save signal: role, method, target and both
    # hashes; the image is kept there only as a fingerprint (CLINICAL_CONTENT_FIELDS).
    row.save()
    return row


# ── decision consents (VisitConsent) ──


def visit_consent_content(consent):
    """What a decision consent's signatures attest to."""
    return {
        "patient": str(consent.patient_id),
        "scope": consent.scope,
        "scope_detail": consent.scope_detail,
        "party": consent.party,
        "given_by_name": consent.given_by_name,
        "recorded_at": consent.recorded_at.isoformat(),
    }


def sign_visit_consent(consent, user, signatures, party):
    """Record the deciding party's and the witness's signatures together.
    `party` is who decides now (the consent's own party, or the party completing
    a deferred consent)."""
    if not isinstance(signatures, dict):
        raise ValidationError({"signatures": "The consent must be signed."})
    content_hash = content_sha256(visit_consent_content(consent))
    patient = consent.patient
    party_sig = dict(signatures.get("party") or {})
    if party == "PATIENT":
        party_sig["name"] = patient.get_full_name()
    elif not party_sig.get("name"):
        party_sig["name"] = consent.given_by_name
    target = {"visit_consent": consent}
    rows = [
        _build(
            target, patient, user, PARTY_ROLE[party], party_sig, content_hash, allow_unable=True
        ),
        _build(
            target,
            patient,
            user,
            PartySignature.ROLE_WITNESS,
            signatures.get("witness"),
            content_hash,
            allow_unable=False,
        ),
    ]
    return [_save(row, user) for row in rows]


# ── consent documents (GeneratedDocument CON-01..11) ──


def is_consent_document(spec):
    return spec["category"] == "CON"


def _is_minor(patient):
    return patient.age_years is not None and patient.age_years < MINOR_AGE


def document_requirements(doc, spec):
    """The signatures the document needs, each satisfied or not by a signature on
    its current content. Empty for a document that is not a consent."""
    if not is_consent_document(spec):
        return []
    current = content_sha256(doc.content)
    roles = set(doc.party_signatures.filter(content_sha256=current).values_list("role", flat=True))
    if _is_minor(doc.patient):
        needed = [
            ("decision", [PartySignature.ROLE_GUARDIAN], "Parent / guardian (client is a minor)")
        ]
    else:
        needed = [
            (
                "decision",
                [PartySignature.ROLE_CLIENT, PartySignature.ROLE_SUBSTITUTE],
                "Client (or their substitute decision-maker)",
            )
        ]
    if doc.template_id in RELATED_PERSON_TEMPLATES:
        needed.append(
            ("related", [PartySignature.ROLE_RELATED_PERSON], "Family member / caregiver involved")
        )
    needed.append(("witness", [PartySignature.ROLE_WITNESS], "Staff witness"))
    return [
        {"key": key, "label": label, "roles": any_of, "satisfied": bool(roles & set(any_of))}
        for key, any_of, label in needed
    ]


def allowed_roles(doc, spec):
    if not is_consent_document(spec):
        return []
    roles = [
        PartySignature.ROLE_CLIENT,
        PartySignature.ROLE_GUARDIAN,
        PartySignature.ROLE_SUBSTITUTE,
    ]
    if doc.template_id in RELATED_PERSON_TEMPLATES:
        roles.append(PartySignature.ROLE_RELATED_PERSON)
    return roles + [PartySignature.ROLE_WITNESS]


def missing_signatures(doc, spec):
    return [r["label"] for r in document_requirements(doc, spec) if not r["satisfied"]]


@transaction.atomic
def sign_document(doc, spec, user, data):
    """One party's signature, with the witness's, on the document as it is now."""
    from . import workflow

    doc = GeneratedDocument.objects.select_for_update().get(pk=doc.pk)
    if not is_consent_document(spec):
        raise ValidationError({"detail": "Only consent documents are signed by the client."})
    if not (workflow.can(user, spec, "generate") or workflow.can(user, spec, "sign")):
        raise PermissionDenied(f"Your role may not take signatures on {spec['name']}.")
    if doc.status not in ("DRAFT", "IN_REVIEW"):
        raise ValidationError(
            {"detail": "Signatures are taken on a draft, before the document is authorised."}
        )
    if not workflow.content_ready(spec, doc):
        raise ValidationError(
            {
                "detail": "Set the facility's wording for this document first "
                "(Org Admin → Consent wording)."
            }
        )
    role = data.get("role")
    if role not in allowed_roles(doc, spec) or role == PartySignature.ROLE_WITNESS:
        raise ValidationError({"role": "Choose who is signing."})
    if role == PartySignature.ROLE_CLIENT and _is_minor(doc.patient):
        raise ValidationError(
            {"role": "The client is a minor — their parent or guardian signs this consent."}
        )
    party = dict(data.get("party") or {})
    if role == PartySignature.ROLE_CLIENT:
        party["name"] = doc.patient.get_full_name()
    if role == PartySignature.ROLE_RELATED_PERSON and not party.get("related_person_id"):
        raise ValidationError(
            {"signatures": "Choose the family member / caregiver from the client's contacts."}
        )
    content_hash = content_sha256(doc.content)
    target = {"document": doc}
    rows = [
        _build(target, doc.patient, user, role, party, content_hash, allow_unable=True),
        _build(
            target,
            doc.patient,
            user,
            PartySignature.ROLE_WITNESS,
            data.get("witness"),
            content_hash,
            allow_unable=False,
        ),
    ]
    saved = [_save(row, user) for row in rows]
    workflow.record_party_signature(doc, user, role)
    return saved


# ── display ──


def image_data_url(row):
    if not row.image_png:
        return ""
    return "data:image/png;base64," + base64.b64encode(bytes(row.image_png)).decode("ascii")


def signature_row(row, current_hash=None, with_image=False):
    out = {
        "id": str(row.pk),
        "role": row.role,
        "role_label": ROLE_LABELS[row.role],
        "signer_name": row.signer_name,
        "relationship": row.relationship,
        "method": row.method,
        "unable_reason": row.unable_reason,
        "captured_at": row.captured_at.isoformat(),
        "captured_by": _name(row.captured_by),
        "current": current_hash is None or row.content_sha256 == current_hash,
    }
    if with_image:
        out["image"] = image_data_url(row)
    return out
