"""
X-13 deterministic draft organizer — no LLM. It arranges record data and the
clinician's own entries into the template's sections (RULE-13: organizes,
never invents). Every value carries its source and time (RULE-03/04).
"""

import hashlib
import json

from django.utils import timezone

from . import catalogue, rules
from .bindings import BINDINGS, RecordContext, lab_results_for_codes

GOVERNANCE_FIELDS = {
    "recipient_name",
    "recipient_organization",
    "purpose",
    "legal_basis",
    "legal_basis_reference",
    "diagnosis_disclosure",
    "include_classes",
    "monitoring",
    "consent_scope",
    "referral_destination",
}


def _display_input(field, value, record):
    if value in (None, "", []):
        return None
    if field["type"] == "classes":
        return [catalogue.DATA_CLASS_NAMES.get(v, v) for v in value]
    if field["type"] == "valueset":
        from .bindings import _concept

        return _concept(field["valueset"], value)
    return value


def organize(
    spec,
    patient,
    author,
    organization,
    recipient_type,
    inputs,
    recipient_name="",
    recipient_organization="",
    purpose="",
):
    """Return (draft, content) — the rule evaluation and the organized content."""
    record = RecordContext(patient, author, organization)
    draft = rules.evaluate(
        rules.Draft(spec, recipient_type, inputs, record, recipient_name, recipient_organization)
    )

    omit = set(inputs.get("omit") or [])
    sections = {}
    for row in spec["autoPopulated"]:
        cls = row["class"]
        if cls not in draft.include or row["key"] in omit:
            continue
        value = BINDINGS[row["key"]]["resolve"](record)
        sections.setdefault(cls, []).append(
            {
                "key": row["key"],
                "label": row["label"],
                "value": value["value"] if value else None,
                "source": value["source"] if value else "",
                "recorded_at": value["recorded_at"] if value else None,
                "origin": value["origin"] if value else "",
            }
        )

    monitoring = []
    for block in draft.dynamic:
        if block.get("rule") != "DOC-CI-07":
            continue
        for group in block["groups"]:
            results = lab_results_for_codes(record, group["codes"]) if group["codes"] else None
            monitoring.append({**group, "latest_results": results["value"] if results else []})

    required = {f["key"] for f in spec["userEntered"] if f["required"]} | draft.required_extra
    if not draft.external:
        required -= {
            "recipient_organization",
            "purpose",
            "diagnosis_disclosure",
            "legal_basis",
            "legal_basis_reference",
        }
    fields = {f["key"]: f for f in spec["userEntered"]}
    for key in draft.required_extra:
        if key not in fields:
            fields[key] = catalogue._field(key, {"cat": spec["category"], "nn": 0, "flags": []})
    values = dict(inputs)
    values.update(
        {
            "recipient_name": recipient_name,
            "recipient_organization": recipient_organization,
            "purpose": purpose,
        }
    )
    missing = sorted(k for k in required if values.get(k) in (None, "", []))
    if "monitoring" in required and not monitoring:
        missing = sorted(set(missing) | {"monitoring"})

    request = []
    for key, field in fields.items():
        if key in GOVERNANCE_FIELDS or key == "clinician_comment":
            continue
        shown = _display_input(field, values.get(key), record)
        if shown is not None:
            request.append(
                {"key": key, "label": field["label"], "value": shown, "source": "CLINICIAN_ENTRY"}
            )

    subject = sections.pop("IDENTITY", [])
    facility = {i["key"].split(".")[1]: i["value"] for i in sections.pop("FACILITY", [])}
    author_rows = {i["key"].split(".")[1]: i["value"] for i in sections.pop("CLINICIAN", [])}
    ordered = [
        {"class": cls, "title": catalogue.DATA_CLASS_NAMES[cls], "items": sections[cls]}
        for cls in catalogue.CLASS_ORDER
        if cls in sections
    ]
    sensitivity = ["MH"]
    if "SUBSTANCE_USE" in draft.include:
        sensitivity.append("SUD")
    content = {
        "title": spec["name"],
        "template_id": spec["documentId"],
        "category": spec["categoryName"],
        "organized_at": timezone.now().isoformat(),
        "organizer": "deterministic-template-v1 (X-13, no AI)",
        "facility": facility,
        "author": {"name": author_rows.get("name"), "credentials": author_rows.get("credentials")},
        "recipient": {
            "type": recipient_type,
            "type_label": draft.rp["label"],
            "name": recipient_name,
            "organization": recipient_organization,
        },
        "purpose": purpose,
        "subject": subject,
        "sections": ordered,
        "request": request,
        "monitoring": monitoring,
        "clinician_comment": inputs.get("clinician_comment") or "",
        "legal_basis": draft.basis,
        "legal_basis_reference": inputs.get("legal_basis_reference") or "",
        "verify_notice": spec["verifyNote"],
    }
    meta = {
        "missing": missing,
        "prompts": draft.prompts,
        "warnings": draft.warnings,
        "blocked": draft.blocked,
        "trace": draft.trace,
        "included": sorted(draft.include, key=catalogue.CLASS_ORDER.index),
        "excluded": [{"class": c, "reason": r} for c, r in sorted(draft.excluded.items())],
        "consent": draft.consent,
        "dynamic": draft.dynamic,
        "labels": {
            "confidentiality": "RESTRICTED",
            "sensitivity": sensitivity,
            "note": "VERIFY: mapping to HL7 DS4P confidentiality / sensitivity codes",
        },
        "required_fields": sorted(required),
    }
    return meta, content


def content_hash(content):
    return hashlib.sha256(
        json.dumps(content, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()
