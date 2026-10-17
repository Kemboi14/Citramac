"""
Conditional intelligence DOC-CI-01…08 as rule-engine cases.

Each rule is data: an ID, a `when` predicate and a `then` effect over a
`Draft` (the evaluation state). The engine runs every rule in order and keeps
a trace of what fired and why, stored on the document so every inclusion and
exclusion is explainable (DOC objective: "traceable to source data").

Rules decide which data classes a document may carry, which user fields are
required, and whether external release is blocked. They never write clinical
wording (RULE-13).
"""

from django.utils import timezone

from . import catalogue
from .bindings import monitoring_codes_for

AUTHORIZED_NECESSARY = "AUTHORIZED_NECESSARY"
# Categories whose documents report a past admission even when the client is
# no longer admitted (discharge, insurance, reports, legal, admission/transfer).
PAST_ADMISSION_CATEGORIES = {"DIS", "INS", "RPT", "LEG", "ADM", "TRF"}


class Draft:
    def __init__(
        self, spec, recipient_type, inputs, record, recipient_name="", recipient_organization=""
    ):
        self.spec = spec
        self.recipient_type = recipient_type
        self.rp = spec["disclosureRules"]["perRecipient"][recipient_type]
        self.inputs = inputs or {}
        self.record = record
        self.recipient_name = recipient_name
        self.recipient_organization = recipient_organization
        self.bound = list(spec["boundClasses"])
        self.external = self.rp["external"]
        self.include = set()
        self.excluded = {}  # class → reason
        self.requested = set()  # optional classes the clinician asked for
        self.required_extra = set()
        self.optional_override = set()
        self.prompts = []
        self.warnings = []
        self.blocked = None
        self.dynamic = []
        self.trace = []
        self.consent = None
        self.consent_problem = ""
        self.basis = ""
        self.unauthorized = set()  # requested classes the authorization does not cover

    # ── authorization ──

    def authorizes(self, cls):
        """May this optional class be disclosed to this recipient?"""
        if not self.external:
            return True
        if self.basis in ("COURT_ORDER", "STATUTORY_DUTY", "EMERGENCY"):
            return True  # clinician's recorded selection under a stated lawful basis
        if self.consent is None:
            return False
        return cls in (self.consent.disclosure_scope or [])

    def add(self, cls, reason_rule):
        if cls not in self.bound or cls in catalogue.NEVER_DISCLOSED:
            return
        if cls in self.include:
            return
        allowed = (
            cls in self.rp["defaultClasses"]
            or cls in self.rp["authorizableClasses"]
            or not self.external
        )
        if not allowed:
            self.excluded[cls] = f"{reason_rule}: not disclosable to {self.rp['label']}"
            return
        if self.external and cls not in self.rp["defaultClasses"] and not self.authorizes(cls):
            self.unauthorized.add(cls)
            self.excluded[cls] = f"{reason_rule}: not covered by the authorization on record"
            return
        self.include.add(cls)
        self.excluded.pop(cls, None)

    def exclude(self, cls, reason):
        if cls in self.bound:
            self.include.discard(cls)
            self.excluded[cls] = reason


def consent_status(patient, consent_type, recipient_name="", recipient_organization=""):
    """(record or None, problem text). Fail safe: only a current YES counts;
    a consent naming a recipient applies only to that recipient."""
    from apps.client_registry.consent import current_record

    record = current_record(patient, consent_type)
    if record is None:
        return None, "No current authorization of this type is on record."
    if record.decision != "YES":
        return None, f"The client's decision on record is “{record.get_decision_display()}”."
    if record.recipient:
        wanted = {x.strip().lower() for x in (recipient_name, recipient_organization) if x}
        if record.recipient.strip().lower() not in wanted:
            return None, (
                f"The authorization on record names “{record.recipient}”, not this recipient."
            )
    return record, ""


# ── Rule cases ──


def _setup(d):
    """Base inclusion before any rule: internal / self recipients get every
    bound class; external recipients only the recipient type's defaults."""
    for cls in d.bound:
        if cls in catalogue.NEVER_DISCLOSED:
            continue
        if not d.external or cls in d.rp["defaultClasses"]:
            d.include.add(cls)
        else:
            d.excluded[cls] = "Not included by default for this recipient (DOC-GOV-03)"
    requested = d.inputs.get("include_classes")
    if isinstance(requested, list):
        d.requested = {c for c in requested if c in d.rp["authorizableClasses"]}
    basis = d.inputs.get("legal_basis") or ""
    if d.external:
        d.basis = basis if basis in d.rp["alternativeBases"] else "CONSENT"
    else:
        d.basis = "SUBJECT_ACCESS" if d.recipient_type == "PATIENT" else "INTERNAL_CARE"


def _ci06_when(d):
    return d.external and d.basis == "CONSENT" and bool(d.rp["consentType"])


def _ci06_then(d):
    record, problem = consent_status(
        d.record.patient, d.rp["consentType"], d.recipient_name, d.recipient_organization
    )
    d.consent = record
    if record is None:
        d.consent_problem = problem
        d.blocked = {
            "rule": "DOC-CI-06",
            "consent_type": d.rp["consentType"],
            "message": f"External release is blocked: {problem} Obtain the client's authorization "
            "and record it before this document can progress.",
            "prompt": "RECORD_AUTHORIZATION",
            "alternative_bases": d.rp["alternativeBases"],
        }
        d.prompts.append(d.blocked["message"])
        return "blocked — consent absent"
    return f"consent on record ({record.consent_type}, {record.captured_at:%Y-%m-%d})"


def _ci08_when(d):
    return "referral_destination" in d.spec["flags"]


def _ci08_then(d):
    dest = d.inputs.get("referral_destination") or ""
    if dest not in catalogue.REFERRAL_DESTINATIONS:
        return "no destination selected yet"
    recommended = catalogue.REFERRAL_DESTINATIONS[dest]
    if "include_classes" not in d.inputs:
        # Offer, not force (RULE-05): recommended classes are pre-selected and
        # the clinician may change them.
        d.requested |= {c for c in recommended if c in d.rp["authorizableClasses"]}
    if not d.external:
        # Minimum necessary even internally: the referral carries the
        # recommended / selected content, not the whole record.
        keep = (
            set(catalogue.RECIPIENT_TYPES["TREATING_CLINICIAN"]["default"])
            | d.requested
            | (set(recommended) if "include_classes" not in d.inputs else set())
        )
        for cls in list(d.include):
            if cls not in keep:
                d.exclude(cls, "DOC-CI-08: not needed by the receiving discipline")
    for key in catalogue.REFERRAL_DESTINATION_FIELDS.get(dest, []):
        d.required_extra.add(key)
    d.dynamic.append({"rule": "DOC-CI-08", "destination": dest, "recommended": recommended})
    return f"destination {dest}: recommended {', '.join(recommended)}"


def _ci05_when(d):
    return d.recipient_type in ("TREATING_CLINICIAN", "RECEIVING_FACILITY")


def _ci05_then(d):
    for cls in sorted(d.requested):
        if cls == "DIAGNOSIS":
            continue  # decided by DOC-CI-02
        d.add(cls, "DOC-CI-05")
    offered = [
        c
        for c in ("DIAGNOSIS", "MEDICATION", "ALLERGY", "INVESTIGATIONS", "ASSESSMENTS", "RISK")
        if c in d.rp["authorizableClasses"]
    ]
    included = ", ".join(sorted(d.include & set(offered))) or "none"
    return f"offered {', '.join(offered) or 'nothing'}; included {included}"


def _ci04_when(d):
    return d.recipient_type == "EMPLOYER"


def _ci04_then(d):
    for cls in list(d.include):
        if cls not in d.rp["defaultClasses"] and cls != "DIAGNOSIS":
            d.exclude(cls, "DOC-CI-04: employer receives necessary functional information only")
    for cls in (
        "PSYCHOTHERAPY",
        "SUBSTANCE_USE",
        "RISK",
        "MEDICATION",
        "ASSESSMENTS",
        "CLINICAL_SUMMARY",
        "LEGAL_STATUS",
        "TREATMENT_PLAN",
    ):
        if cls in d.bound:
            d.exclude(cls, "DOC-CI-04: not disclosed to an employer")
    return "functional information only; psychotherapy content and unnecessary diagnoses excluded"


def _generic_requested_when(d):
    return d.external and d.recipient_type not in (
        "TREATING_CLINICIAN",
        "RECEIVING_FACILITY",
        "EMPLOYER",
    )


def _generic_requested_then(d):
    for cls in sorted(d.requested - {"DIAGNOSIS"}):
        d.add(cls, "DOC-GOV-03")
    return f"requested {', '.join(sorted(d.requested)) or 'nothing'}"


def _ci02_when(d):
    return d.external and "DIAGNOSIS" in d.bound


def _ci02_then(d):
    wanted = d.inputs.get("diagnosis_disclosure") == AUTHORIZED_NECESSARY or (
        "DIAGNOSIS" in d.requested
        and d.recipient_type in ("TREATING_CLINICIAN", "RECEIVING_FACILITY")
    )
    if not wanted:
        d.exclude("DIAGNOSIS", "DOC-CI-02: diagnosis disclosure not authorized / not necessary")
        return "diagnosis excluded (not marked authorized and necessary)"
    if "DIAGNOSIS" not in d.rp["authorizableClasses"] and "DIAGNOSIS" not in d.rp["defaultClasses"]:
        d.exclude("DIAGNOSIS", "DOC-CI-02: diagnosis is not disclosable to this recipient")
        return "diagnosis excluded (recipient type)"
    if not d.authorizes("DIAGNOSIS"):
        d.unauthorized.add("DIAGNOSIS")
        d.exclude("DIAGNOSIS", "DOC-CI-02: the authorization on record does not cover diagnoses")
        d.warnings.append(
            "Diagnosis was marked necessary but the client's authorization does not "
            "cover diagnoses — it has been excluded."
        )
        return "diagnosis excluded (authorization scope)"
    d.include.add("DIAGNOSIS")
    d.excluded.pop("DIAGNOSIS", None)
    return "diagnosis included (authorized and necessary)"


def _ci03_when(d):
    return "risk_relevant" in d.spec["flags"] and d.record.has_current_risk


def _ci03_then(d):
    d.required_extra.add("immediate_safety_requirements")
    if "RISK" not in d.bound:
        return "safety requirements required"
    if d.external and not d.authorizes("RISK"):
        d.unauthorized.add("RISK")
        d.blocked = d.blocked or {
            "rule": "DOC-CI-03",
            "consent_type": d.rp["consentType"],
            "message": "Current risk must accompany this transfer / referral, but the "
            "authorization on record does not cover risk information. Record an "
            "authorization that covers it (or an applicable lawful basis).",
            "prompt": "RECORD_AUTHORIZATION",
            "missing_classes": ["RISK"],
            "alternative_bases": d.rp["alternativeBases"],
        }
        d.exclude("RISK", "DOC-CI-03: required but not authorized")
        return "risk required but not authorized — blocked"
    d.include.add("RISK")
    d.excluded.pop("RISK", None)
    return "current risk summary included; immediate safety requirements required"


def _ci01_when(d):
    return "ADMISSION" in d.bound


def _ci01_then(d):
    if d.record.current_admission:
        d.add("ADMISSION", "DOC-CI-01") if d.external else d.include.add("ADMISSION")
        if (
            d.external
            and "ADMISSION" in d.rp["authorizableClasses"]
            and "ADMISSION" not in d.include
        ):
            return "client admitted; admission not authorized for this recipient"
        return "client currently admitted — admission dates populate"
    if d.spec["category"] in PAST_ADMISSION_CATEGORIES and d.record.latest_admission:
        return "not currently admitted — latest admission reported"
    d.exclude("ADMISSION", "DOC-CI-01: client is not currently admitted")
    return "not currently admitted — admission fields omitted"


def _ci07_when(d):
    return "medication_monitoring" in d.spec["flags"]


def _ci07_then(d):
    items = {str(i.pk): i for i in d.record.active_prescription_items}
    chosen = d.inputs.get("monitoring") or []
    groups = []
    for entry in chosen if isinstance(chosen, list) else []:
        item = items.get(str(entry.get("item_id")))
        if item is None:
            continue
        configured = monitoring_codes_for(item.drug_id)
        selected = [c for c in entry.get("codes", []) if isinstance(c, str)]
        codes = list(dict.fromkeys(configured + selected))
        groups.append(
            {
                "item_id": str(item.pk),
                "medication": f"{item.drug.generic_name} {item.drug.strength}".strip(),
                "indication": entry.get("indication") or item.indication or "",
                "configured_codes": configured,
                "codes": codes,
                "baseline_or_follow_up": entry.get("phase") or "",
            }
        )
    d.dynamic.append(
        {
            "rule": "DOC-CI-07",
            "available": [
                {
                    "item_id": k,
                    "medication": f"{i.drug.generic_name} {i.drug.strength}".strip(),
                    "indication": i.indication,
                    "configured_codes": monitoring_codes_for(i.drug_id),
                }
                for k, i in items.items()
            ],
            "groups": groups,
        }
    )
    if not groups:
        d.prompts.append("Select the medication(s) to monitor and the investigations for each.")
        return "no medication selected"
    return f"{len(groups)} medication group(s)"


RULES = [
    {"id": "DOC-CI-06", "when": _ci06_when, "then": _ci06_then},
    {"id": "DOC-CI-08", "when": _ci08_when, "then": _ci08_then},
    {"id": "DOC-CI-05", "when": _ci05_when, "then": _ci05_then},
    {"id": "DOC-GOV-03", "when": _generic_requested_when, "then": _generic_requested_then},
    {"id": "DOC-CI-04", "when": _ci04_when, "then": _ci04_then},
    {"id": "DOC-CI-02", "when": _ci02_when, "then": _ci02_then},
    {"id": "DOC-CI-03", "when": _ci03_when, "then": _ci03_then},
    {"id": "DOC-CI-01", "when": _ci01_when, "then": _ci01_then},
    {"id": "DOC-CI-07", "when": _ci07_when, "then": _ci07_then},
]


def evaluate(draft):
    _setup(draft)
    for rule in RULES:
        fired = bool(rule["when"](draft))
        outcome = rule["then"](draft) if fired else ""
        draft.trace.append(
            {
                "rule": rule["id"],
                "fired": fired,
                "outcome": outcome,
                "at": timezone.now().isoformat(),
            }
        )
    if draft.external and draft.unauthorized and not draft.blocked and draft.basis == "CONSENT":
        draft.warnings.append(
            "Not covered by the authorization on record and therefore excluded: "
            + ", ".join(catalogue.DATA_CLASS_NAMES[c] for c in sorted(draft.unauthorized))
        )
    return draft
