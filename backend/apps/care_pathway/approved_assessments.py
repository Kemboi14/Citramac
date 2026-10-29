"""
The assessments an organisation has approved for clinical use (QA, 2026-10-29;
owner decision: per organisation, Org Admin attests with the clinical lead's
name, none approved by default).

- TRAUMA — spec 6.1 "tenant-approved trauma assessment where clinically
  appropriate". Trauma symptoms recommend the approved tool; with none
  approved, the tool is shown as not approved and cannot be started.
- BENZO_WITHDRAWAL — triage spec item 9: benzodiazepine withdrawal opens the
  facility-configured assessment. CIWA-Ar is an alcohol scale; it is offered
  here only behind an explicit confirmation that its use for benzodiazepines
  is clinically approved, and is never the default.

Append-only (ApprovedAssessment): every change is a new row and an audit
entry. Configuration, not patient data — no FHIR resource.
"""

from django.db import transaction
from rest_framework.exceptions import ValidationError

from apps.sysadmin_audit.audit import write_event
from apps.sysadmin_audit.models import AuditLogEntry

from . import instruments
from .models import ApprovedAssessment

ATTEST = (
    "I confirm our clinical lead named here has approved this assessment for this use in our "
    "organisation, and that we hold any licence it needs."
)
CIWA_FOR_BENZO = (
    "CIWA-Ar is validated for alcohol withdrawal. I confirm our clinical lead has explicitly "
    "approved it as our benzodiazepine withdrawal protocol."
)

PURPOSES = {
    "TRAUMA": {
        "title": "Trauma assessment",
        "what": "Recommended at intake when trauma symptoms are recorded, where clinically "
        "appropriate.",
        "options": {"PCL5": {}},
    },
    "BENZO_WITHDRAWAL": {
        "title": "Benzodiazepine withdrawal assessment",
        "what": "Recommended when benzodiazepine / sedative withdrawal is suspected or "
        "identified, with a psychiatric review.",
        "options": {"CIWA": {"confirm": CIWA_FOR_BENZO}},
    },
}


def current(purpose):
    """The organisation's current approval row for `purpose` (RLS scopes it), or None."""
    return ApprovedAssessment.objects.filter(purpose=purpose).order_by("-approved_at").first()


def instrument_for(purpose):
    """The approved instrument code, or "" when none is approved."""
    row = current(purpose)
    return row.instrument if row else ""


def names():
    """{purpose: instrument name or ""} — what triage shows in its banner."""
    out = {}
    for purpose in PURPOSES:
        code = instrument_for(purpose)
        out[purpose] = instruments.INSTRUMENTS[code]["name"] if code else ""
    return out


def requires_approval(instrument):
    """The purpose whose approval an instrument needs before it can be started
    from a trigger, or None (PCL-5 is only ever a trauma tool)."""
    return "TRAUMA" if instrument == "PCL5" else None


def is_approved(instrument):
    purpose = requires_approval(instrument)
    return purpose is None or instrument_for(purpose) == instrument


def payload(user_can_edit):
    out = []
    for purpose, spec in PURPOSES.items():
        row = current(purpose)
        out.append(
            {
                "purpose": purpose,
                "title": spec["title"],
                "what": spec["what"],
                "options": [
                    {
                        "code": code,
                        "name": instruments.INSTRUMENTS[code]["title"],
                        "confirm": option.get("confirm", ""),
                    }
                    for code, option in spec["options"].items()
                ],
                "instrument": row.instrument if row else "",
                "clinical_lead": row.clinical_lead if row else "",
                "approved_by": (
                    row.approved_by.get_full_name() if row and row.approved_by_id else ""
                ),
                "approved_at": row.approved_at.isoformat() if row else None,
            }
        )
    return {"purposes": out, "attest": ATTEST, "can_edit": user_can_edit}


@transaction.atomic
def approve(user, purpose, instrument, clinical_lead="", attest=False, confirm=False):
    spec = PURPOSES.get(purpose)
    if spec is None:
        raise ValidationError({"purpose": "Unknown purpose."})
    instrument = instrument or ""
    clinical_lead = (clinical_lead or "").strip()
    attestation = ""
    if instrument:
        option = spec["options"].get(instrument)
        if option is None:
            raise ValidationError({"instrument": "Not an assessment offered for this use."})
        if len(clinical_lead) < 3:
            raise ValidationError({"clinical_lead": "Name the clinical lead who approved it."})
        if attest is not True:
            raise ValidationError({"attest": ATTEST})
        attestation = ATTEST
        if option.get("confirm"):
            if confirm is not True:
                raise ValidationError({"confirm": option["confirm"]})
            attestation = f"{ATTEST} {option['confirm']}"
    before = instrument_for(purpose)
    row = ApprovedAssessment.objects.create(
        organization_id=user.organization_id,
        purpose=purpose,
        instrument=instrument,
        clinical_lead=clinical_lead if instrument else "",
        attestation=attestation,
        approved_by=user,
    )
    write_event(
        row.organization_id,
        AuditLogEntry.ACTION_UPDATE,
        "care_pathway.approvedassessment",
        row.id,
        {
            "purpose": purpose,
            "instrument": [before, instrument],
            "clinical_lead": row.clinical_lead,
            "attestation": attestation,
        },
    )
    return row
