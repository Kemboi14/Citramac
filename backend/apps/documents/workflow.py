"""
DOC-WF state machine and DOC-GOV enforcement.

DRAFT → IN_REVIEW → SIGNED (authorized / signed) → RELEASED → FILED, plus
BLOCKED_CONSENT. SIGNED → FILED is allowed for a document that is only filed
in the chart. Every transition writes a DocumentEvent (and the platform
AuditLogEntry via the generic write signal). Signed versions are immutable;
`amend` opens a new version with a reason.
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.accounts.access import active_roles

from . import catalogue, organizer
from .models import (
    SIGNED_STATES,
    STATUS_BLOCKED_CONSENT,
    STATUS_DRAFT,
    STATUS_FILED,
    STATUS_IN_REVIEW,
    STATUS_RELEASED,
    STATUS_SIGNED,
    DisclosureRecord,
    DocumentEvent,
    GeneratedDocument,
)
from .rules import consent_status

TRANSITIONS = {
    "submit": ({STATUS_DRAFT}, STATUS_IN_REVIEW),
    "return": ({STATUS_IN_REVIEW}, STATUS_DRAFT),
    "approve": ({STATUS_IN_REVIEW}, STATUS_IN_REVIEW),
    "sign": ({STATUS_IN_REVIEW}, STATUS_SIGNED),
    "release": ({STATUS_SIGNED}, STATUS_RELEASED),
    "file": ({STATUS_SIGNED, STATUS_RELEASED}, STATUS_FILED),
    "recheck_consent": ({STATUS_BLOCKED_CONSENT}, None),
    "amend": (SIGNED_STATES, STATUS_DRAFT),
}
# Which authorization list governs each action (DOC-GOV-02).
ACTION_PERMISSION = {
    "generate": "generate",
    "edit": "generate",
    "submit": "generate",
    "return": "review",
    "review": "review",
    "approve": "approve",
    "sign": "sign",
    "release": "release",
    "file": "release",
    "recheck_consent": "generate",
    "amend": "generate",
    "view": None,
}


# ── RBAC ──


def role_names(user):
    if not (user and user.is_authenticated):
        return set()
    return {name.lower() for name in active_roles(user).values_list("name", flat=True)}


def in_groups(user, groups):
    """Superusers get no clinical document rights (they are platform staff)."""
    if not (user and user.is_authenticated) or user.is_superuser:
        return False
    wanted = {name.lower() for g in groups for name in catalogue.role_group(g)}
    return bool(role_names(user) & wanted)


def can(user, spec, action):
    perm = ACTION_PERMISSION[action]
    if perm is None:
        auth = spec["authorization"]
        return any(in_groups(user, auth[a]) for a in ("generate", "review", "sign", "release"))
    return in_groups(user, spec["authorization"][perm])


def require(user, spec, action):
    if not can(user, spec, action):
        if spec["authorization"]["prescribingRestricted"]:
            raise PermissionDenied(
                "Prescribing documents are restricted to credentialed prescribers (DOC-GOV-08)."
            )
        raise PermissionDenied(f"Your role may not {action.replace('_', ' ')} {spec['name']}.")


def _roles_label(user):
    return ", ".join(sorted(user.roles.values_list("name", flat=True))) if user else ""


def _event(doc, user, action, from_status, to_status, reason="", **detail):
    return DocumentEvent.objects.create(
        organization=doc.organization,
        document=doc,
        patient=doc.patient,
        action=action,
        from_status=from_status,
        to_status=to_status,
        actor=user,
        actor_roles=_roles_label(user),
        reason=reason,
        detail=detail,
    )


# ── Generation / editing ──


def _apply_organized(doc, spec, user, meta, content):
    doc.content = content
    doc.rule_trace = meta["trace"]
    doc.included_classes = meta["included"]
    doc.excluded_classes = meta["excluded"]
    doc.security_labels = meta["labels"]
    doc.consent_record = meta["consent"]
    doc.block_detail = {
        k: meta[k]
        for k in ("missing", "prompts", "warnings", "blocked", "dynamic", "required_fields")
    }


def _organize(doc, spec, author):
    return organizer.organize(
        spec,
        doc.patient,
        author,
        doc.organization,
        doc.recipient_type,
        doc.inputs,
        doc.recipient_name,
        doc.recipient_organization,
        doc.purpose,
    )


def _check_recipient(spec, recipient_type):
    if recipient_type not in spec["disclosureRules"]["recipientTypes"]:
        raise ValidationError(
            {"recipient_type": "This document cannot be addressed to that recipient type."}
        )


@transaction.atomic
def generate(spec, patient, user, data):
    from apps.care_pathway.services import current_or_latest_episode

    require(user, spec, "generate")
    recipient_type = data.get("recipient_type") or spec["disclosureRules"]["defaultRecipient"]
    _check_recipient(spec, recipient_type)
    if catalogue.is_legal(spec):
        return _generate_legal_release(spec, patient, user, data, recipient_type)
    doc = GeneratedDocument(
        organization=patient.organization,
        patient=patient,
        episode=current_or_latest_episode(patient),
        template_id=spec["documentId"],
        catalogue_version=catalogue.CATALOGUE_VERSION,
        recipient_type=recipient_type,
        recipient_name=(data.get("recipient_name") or "").strip(),
        recipient_organization=(data.get("recipient_organization") or "").strip(),
        purpose=(data.get("purpose") or "").strip(),
        inputs=_clean_inputs(data.get("inputs")),
        author=user,
    )
    if recipient_type == "PATIENT" and not doc.recipient_name:
        doc.recipient_name = patient.get_full_name()
    meta, content = _organize(doc, spec, user)
    _apply_organized(doc, spec, user, meta, content)
    doc.status = STATUS_BLOCKED_CONSENT if meta["blocked"] else STATUS_DRAFT
    doc.blocked_from = STATUS_DRAFT if meta["blocked"] else ""
    doc.save()
    _event(
        doc, user, "generate", "", doc.status, detail_rules=meta["trace"], blocked=meta["blocked"]
    )
    return doc


# Actions a statutory form never takes here: it is reviewed, signed and
# amended in the legal module (LGL-DOC-02 / 04); this module only releases it.
LEGAL_MODULE_ACTIONS = {"edit", "submit", "return", "approve", "sign", "amend"}


def _generate_legal_release(spec, patient, user, data, recipient_type):
    """LGL-DOC-05: a release record for one signed statutory form. It links the
    LegalDocument (the one store of the form) and starts SIGNED, because the
    form was signed in the legal module; release then runs the DOC-CI-06 check
    and writes a DisclosureRecord like every other document."""
    from apps.care_pathway.legal_models import LegalDocument
    from apps.care_pathway.services import current_or_latest_episode

    legal_id = data.get("legal_document_id")
    if not legal_id:
        raise ValidationError(
            {
                "legal_document_id": "Choose the signed statutory form to release — "
                "these forms are completed and signed in the client's Legal status workspace."
            }
        )
    try:
        legal_doc = LegalDocument.objects.select_related("signer_user").get(
            pk=legal_id, patient=patient
        )
    except (LegalDocument.DoesNotExist, ValueError, DjangoValidationError):
        raise ValidationError({"legal_document_id": "No such form for this client."}) from None
    if legal_doc.template_id != spec["documentId"]:
        raise ValidationError({"legal_document_id": "That form is a different document type."})
    if legal_doc.status != "SIGNED":
        raise ValidationError({"legal_document_id": "Only a signed form can be released."})
    if legal_doc.superseded_by.exists():
        raise ValidationError(
            {"legal_document_id": "This version has been amended; release the current version."}
        )
    rp = spec["disclosureRules"]["perRecipient"][recipient_type]
    if rp["excludedClasses"]:
        raise ValidationError(
            {
                "recipient_type": "A statutory form is released whole, and it carries "
                + ", ".join(catalogue.DATA_CLASS_NAMES[c] for c in rp["excludedClasses"])
                + f", which may not be disclosed to {rp['label'].lower()}."
            }
        )
    inputs = _clean_inputs(data.get("inputs"))
    basis = inputs.get("legal_basis") or ""
    if rp["external"]:
        basis = basis if basis in rp["alternativeBases"] else "CONSENT"
    else:
        basis = "INTERNAL_CARE"
    included = [c for c in spec["boundClasses"] if c not in catalogue.NEVER_DISCLOSED]
    sensitivity = ["MH"] + (["SUD"] if "SUBSTANCE_USE" in included else [])
    doc = GeneratedDocument(
        organization=patient.organization,
        patient=patient,
        episode=legal_doc.legal_status.episode or current_or_latest_episode(patient),
        template_id=spec["documentId"],
        catalogue_version=catalogue.CATALOGUE_VERSION,
        recipient_type=recipient_type,
        recipient_name=(data.get("recipient_name") or "").strip(),
        recipient_organization=(data.get("recipient_organization") or "").strip(),
        purpose=(data.get("purpose") or "").strip(),
        inputs=inputs,
        legal_document=legal_doc,
        content={
            "source": catalogue.LEGAL_MODULE_SOURCE,
            "legal_document": {
                "id": str(legal_doc.pk),
                "document_number": legal_doc.document_number,
                "version": legal_doc.version,
                "title": legal_doc.get_template_id_display(),
                "config_version": legal_doc.config_version,
                "signer_kind": legal_doc.signer_kind,
                "signer_name": legal_doc.signer_name,
                "signed_at": legal_doc.signed_at.isoformat() if legal_doc.signed_at else None,
            },
            "recipient": {
                "type": recipient_type,
                "type_label": rp["label"],
                "name": (data.get("recipient_name") or "").strip(),
                "organization": (data.get("recipient_organization") or "").strip(),
            },
            "purpose": (data.get("purpose") or "").strip(),
            "clinician_comment": inputs.get("clinician_comment") or "",
            "legal_basis": basis,
            "legal_basis_reference": inputs.get("legal_basis_reference") or "",
        },
        rule_trace=[],
        included_classes=included,
        excluded_classes=[],
        security_labels={
            "confidentiality": "RESTRICTED",
            "sensitivity": sensitivity,
            "note": "VERIFY: mapping to HL7 DS4P confidentiality / sensitivity codes",
        },
        author=user,
        status=STATUS_SIGNED,
        signed_by=legal_doc.signer_user,
        signed_at=legal_doc.signed_at,
        signer_credentials=f"{legal_doc.get_signer_kind_display()}: {legal_doc.signer_name}".strip(
            ": "
        ),
        # The disclosure is tied to exactly the form as it was signed.
        content_hash=organizer.content_hash(legal_doc.rendered),
    )
    doc.save()
    _event(
        doc,
        user,
        "generate",
        "",
        doc.status,
        legal_document_id=str(legal_doc.pk),
        legal_document_version=legal_doc.version,
    )
    return doc


def _clean_inputs(inputs):
    if inputs is None:
        return {}
    if not isinstance(inputs, dict):
        raise ValidationError({"inputs": "Must be an object."})
    unknown = [k for k in inputs if k not in catalogue.USER_FIELDS and k != "omit"]
    if unknown:
        raise ValidationError({"inputs": f"Unknown field(s): {', '.join(sorted(unknown))}."})
    return inputs


@transaction.atomic
def edit(doc, spec, user, data):
    """Human review / edit of a draft: change the clinician-entered fields, the
    recipient, or omit individual auto-populated items, then re-organize."""
    _not_legal_module_action(spec, "edit")
    require(user, spec, "edit")
    editable = doc.status == STATUS_DRAFT or (
        doc.status == STATUS_BLOCKED_CONSENT and doc.blocked_from == STATUS_DRAFT
    )
    if not editable:
        raise ValidationError({"detail": "Only a draft can be edited."})
    before = doc.status
    if "recipient_type" in data:
        _check_recipient(spec, data["recipient_type"])
        doc.recipient_type = data["recipient_type"]
    for key in ("recipient_name", "recipient_organization", "purpose"):
        if key in data:
            setattr(doc, key, (data.get(key) or "").strip())
    if "inputs" in data:
        doc.inputs = _clean_inputs(data["inputs"])
    meta, content = _organize(doc, spec, doc.author or user)
    _apply_organized(doc, spec, user, meta, content)
    doc.status = STATUS_BLOCKED_CONSENT if meta["blocked"] else STATUS_DRAFT
    doc.blocked_from = STATUS_DRAFT if meta["blocked"] else ""
    doc.save()
    _event(doc, user, "edit", before, doc.status, blocked=meta["blocked"])
    return doc


# ── Transitions ──


def _not_legal_module_action(spec, action):
    if catalogue.is_legal(spec) and action in LEGAL_MODULE_ACTIONS:
        raise ValidationError(
            {
                "detail": "Statutory forms are reviewed, signed and amended in the client's "
                "Legal status workspace (LGL-DOC-02 / 04); here they can only be released."
            }
        )


def _guard(doc, action):
    sources, _ = TRANSITIONS[action]
    if doc.status not in sources:
        raise ValidationError(
            {
                "detail": f"Cannot {action.replace('_', ' ')} a document that is "
                f"{doc.get_status_display().lower()}."
            }
        )


def _not_verify(spec):
    if spec["contentStatus"] == "VERIFY":
        raise ValidationError(
            {
                "detail": "This template needs facility-approved wording before it "
                f"can be authorized ({spec['verifyNote']}). It stays a "
                "structured draft of record data."
            }
        )


@transaction.atomic
def transition(doc, spec, user, action, data):
    if action not in TRANSITIONS:
        raise ValidationError({"action": "Unknown action."})
    _not_legal_module_action(spec, action)
    require(user, spec, action)
    _guard(doc, action)
    reason = (data.get("reason") or "").strip()
    before = doc.status
    now = timezone.now()

    if action == "submit":
        _not_verify(spec)
        missing = doc.block_detail.get("missing") or []
        if missing:
            labels = {f["key"]: f["label"] for f in spec["userEntered"]}
            raise ValidationError(
                {
                    "detail": "Complete the required fields first: "
                    + ", ".join(labels.get(k, k) for k in missing)
                    + "."
                }
            )
        doc.status, doc.submitted_at = STATUS_IN_REVIEW, now
    elif action == "return":
        if not reason:
            raise ValidationError({"reason": "Say what needs changing."})
        doc.status, doc.reviewed_by, doc.reviewed_at = STATUS_DRAFT, None, None
    elif action == "approve":
        if spec["highRisk"] and doc.author_id == user.id:
            raise PermissionDenied(
                "A high-risk document needs review by someone other than its author (DOC-GOV-07)."
            )
        doc.reviewed_by, doc.reviewed_at = user, now
    elif action == "sign":
        _not_verify(spec)
        if spec["highRisk"] and not doc.reviewed_by_id:
            raise ValidationError(
                {
                    "detail": "High-risk documents need an independent review "
                    "before signing (DOC-GOV-07)."
                }
            )
        if not doc.reviewed_by_id:
            doc.reviewed_by, doc.reviewed_at = user, now  # the credentialed signer reviewed it
        doc.status, doc.signed_by, doc.signed_at = STATUS_SIGNED, user, now
        doc.signer_credentials = _roles_label(user)
        doc.content_hash = organizer.content_hash(doc.content)
    elif action == "release":
        return _release(doc, spec, user, data, before)
    elif action == "file":
        doc.status, doc.filed_at, doc.filed_by = STATUS_FILED, now, user
    elif action == "recheck_consent":
        return _recheck(doc, spec, user, before)
    elif action == "amend":
        return _amend(doc, spec, user, reason)
    doc.save()
    _event(doc, user, action, before, doc.status, reason)
    return doc


def _external(doc):
    return catalogue.RECIPIENT_TYPES[doc.recipient_type]["external"]


def release_check(doc, spec):
    """DOC-GOV-04: consent and scope re-checked before every external release.
    Returns (consent_record, problem or None, missing classes)."""
    rp = spec["disclosureRules"]["perRecipient"][doc.recipient_type]
    if not _external(doc):
        return None, None, []
    basis = doc.content.get("legal_basis") or "CONSENT"
    if basis != "CONSENT":
        return None, None, []
    if not rp["consentType"]:
        return None, None, []
    record, problem = consent_status(
        doc.patient, rp["consentType"], doc.recipient_name, doc.recipient_organization
    )
    if record is None:
        return None, problem, []
    optional = [c for c in doc.included_classes if c not in rp["defaultClasses"]]
    missing = [c for c in optional if c not in (record.disclosure_scope or [])]
    if missing:
        return (
            record,
            "The authorization on record no longer covers: "
            + ", ".join(catalogue.DATA_CLASS_NAMES[c] for c in missing)
            + ".",
            missing,
        )
    return record, None, []


def _block(doc, user, before, rp, problem, missing):
    doc.status = STATUS_BLOCKED_CONSENT
    doc.blocked_from = before
    detail = dict(doc.block_detail)
    detail["blocked"] = {
        "rule": "DOC-CI-06",
        "consent_type": rp["consentType"],
        "prompt": "RECORD_AUTHORIZATION",
        "message": f"External release is blocked: {problem} Obtain the client's authorization "
        "and record it, then re-check.",
        "missing_classes": missing,
        "alternative_bases": rp["alternativeBases"],
    }
    doc.block_detail = detail
    doc.save()
    _event(doc, user, "release_blocked", before, doc.status, problem)
    return doc


def _release(doc, spec, user, data, before):
    if not doc.recipient_organization and _external(doc):
        raise ValidationError({"detail": "Name the recipient organisation before release."})
    if not doc.purpose and _external(doc):
        raise ValidationError({"detail": "State the purpose before release."})
    rp = spec["disclosureRules"]["perRecipient"][doc.recipient_type]
    basis = doc.content.get("legal_basis") or ""
    reference = doc.content.get("legal_basis_reference") or ""
    if basis in ("COURT_ORDER", "STATUTORY_DUTY", "EMERGENCY"):
        if not reference:
            raise ValidationError(
                {
                    "detail": "Record the order / duty reference or emergency "
                    "reason for this lawful basis."
                }
            )
        if not in_groups(user, ["SENIOR"]):
            raise PermissionDenied(
                "Release under a lawful basis other than consent needs a senior clinician."
            )
    record, problem, missing = release_check(doc, spec)
    if problem:
        return _block(doc, user, before, rp, problem, missing)
    channel = data.get("channel") or "RECORDED_RELEASE"
    if channel not in dict(DisclosureRecord.CHANNEL_CHOICES):
        raise ValidationError({"channel": "Unknown channel."})
    if channel not in spec["outputs"]:
        raise ValidationError({"channel": "This document cannot be output that way."})
    disclosure = DisclosureRecord.objects.create(
        organization=doc.organization,
        document=doc,
        patient=doc.patient,
        document_number=doc.document_number,
        template_id=doc.template_id,
        document_version=doc.version,
        content_hash=doc.content_hash,
        recipient_type=doc.recipient_type,
        recipient_name=doc.recipient_name,
        recipient_organization=doc.recipient_organization,
        purpose=doc.purpose or spec["trigger"],
        channel=channel,
        legal_basis=basis,
        legal_basis_reference=reference,
        consent_record=record,
        classes_disclosed=list(doc.included_classes),
        released_by=user,
        released_by_roles=_roles_label(user),
    )
    doc.status = STATUS_RELEASED
    doc.save()
    _event(
        doc, user, "release", before, doc.status, disclosure_id=str(disclosure.id), channel=channel
    )
    return doc


def _recheck(doc, spec, user, before):
    target = doc.blocked_from or STATUS_DRAFT
    if target == STATUS_DRAFT:
        meta, content = _organize(doc, spec, doc.author or user)
        _apply_organized(doc, spec, user, meta, content)
        if meta["blocked"]:
            doc.save()
            _event(doc, user, "recheck_consent", before, doc.status, "Still blocked")
            return doc
    else:
        _, problem, _missing = release_check(doc, spec)
        if problem:
            _event(doc, user, "recheck_consent", before, doc.status, problem)
            return doc
        detail = dict(doc.block_detail)
        detail["blocked"] = None
        doc.block_detail = detail
    doc.status, doc.blocked_from = target, ""
    doc.save()
    _event(doc, user, "recheck_consent", before, doc.status)
    return doc


def _amend(doc, spec, user, reason):
    if not reason:
        raise ValidationError({"reason": "Give the reason for the correction."})
    latest = GeneratedDocument.objects.filter(series_id=doc.series_id).order_by("-version").first()
    if latest.pk != doc.pk:
        raise ValidationError({"detail": "Only the latest version can be amended."})
    new = GeneratedDocument(
        organization=doc.organization,
        patient=doc.patient,
        episode=doc.episode,
        template_id=doc.template_id,
        catalogue_version=catalogue.CATALOGUE_VERSION,
        series_id=doc.series_id,
        version=doc.version + 1,
        supersedes=doc,
        correction_reason=reason,
        recipient_type=doc.recipient_type,
        recipient_name=doc.recipient_name,
        recipient_organization=doc.recipient_organization,
        purpose=doc.purpose,
        inputs=dict(doc.inputs),
        author=user,
    )
    meta, content = _organize(new, spec, user)
    _apply_organized(new, spec, user, meta, content)
    new.status = STATUS_BLOCKED_CONSENT if meta["blocked"] else STATUS_DRAFT
    new.blocked_from = STATUS_DRAFT if meta["blocked"] else ""
    new.save()
    _event(
        doc,
        user,
        "amended",
        doc.status,
        doc.status,
        reason,
        new_version=new.version,
        new_id=str(new.id),
    )
    _event(new, user, "amend", "", new.status, reason, supersedes=str(doc.id))
    return new


def allowed_actions(doc, spec, user):
    """What this user may do now — the UI hides anything else (AT-12)."""
    if catalogue.is_legal(spec):
        return [
            action
            for action, (sources, _) in TRANSITIONS.items()
            if action not in LEGAL_MODULE_ACTIONS
            and doc.status in sources
            and can(user, spec, action)
        ]
    out = []
    draftish = doc.status == STATUS_DRAFT
    if draftish and can(user, spec, "edit"):
        out.append("edit")
    for action, (sources, _) in TRANSITIONS.items():
        if doc.status not in sources or not can(user, spec, action):
            continue
        if action in ("submit", "sign") and spec["contentStatus"] == "VERIFY":
            continue
        if action == "approve" and (
            doc.reviewed_by_id or (spec["highRisk"] and doc.author_id == user.id)
        ):
            continue
        if action == "amend":
            latest = (
                GeneratedDocument.objects.filter(series_id=doc.series_id)
                .order_by("-version")
                .values_list("pk", flat=True)
                .first()
            )
            if latest != doc.pk:
                continue
        out.append(action)
    if (
        doc.status == STATUS_BLOCKED_CONSENT
        and doc.blocked_from == STATUS_DRAFT
        and can(user, spec, "edit")
    ):
        out.append("edit")
    return out
