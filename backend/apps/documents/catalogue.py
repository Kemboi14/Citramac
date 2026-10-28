"""
CITRAMAC document catalogue — master prompt §6 DOC-CAT / DOC-SPEC, as data.

One registry: 14 categories, 111 document types — 108 with IDs `DOC-<CAT>-<nn>`
plus the three statutory mental-health forms of LGL-DOC-01 (`DOC-LEG-STAT-*-KE`),
which keep the legal module's IDs. Each
template is a plain dict carrying all ten DOC-SPEC fields (documentId,
category, trigger, autoPopulated, userEntered, conditionalRules,
disclosureRules, authorization, outputs, filingAudit). There is no component
or code path per document: the organizer (organizer.py), the rule engine
(rules.py) and the workflow (workflow.py) read these dicts.

Nothing here is clinical or legal wording. A template whose output needs
facility-approved or legal text (consent forms, statutory forms, rights
statements, payer forms, tariffs, prescription format) is marked
`content_status = "VERIFY"`: it can be generated only as a structured draft
of record data and cannot be submitted, signed or released until the
facility supplies approved wording.
"""


CATALOGUE_VERSION = "2026-10-17.1"

CATEGORIES = [
    ("WRK", "Work & Employment"),
    ("EDU", "School & University"),
    ("REF", "Referrals & Consultations"),
    ("INV", "Investigations & Diagnostics"),
    ("MED", "Medication"),
    ("ADM", "Admission & Treatment"),
    ("TRF", "Transfer & Continuity"),
    ("DIS", "Discharge & Aftercare"),
    ("CON", "Consent & Information Sharing"),
    ("FAM", "Family & Caregiver"),
    ("RPT", "Clinical Reports & Summaries"),
    ("INS", "Insurance, EAP & Funding"),
    ("LEG", "Legal, Statutory & Safeguarding"),
    ("PAT", "Patient Communications"),
]
CATEGORY_NAMES = dict(CATEGORIES)

# ── Data classes: the unit of disclosure control (DOC-GOV-03) ──
# Every auto-populated binding belongs to exactly one class; what a document
# may carry is decided per class, never per field.
DATA_CLASSES = [
    ("IDENTITY", "Client identification"),
    ("CONTACT", "Client contact details"),
    ("OCCUPATION", "Occupation / current study"),
    ("ADMINISTRATIVE", "Attendance and treatment dates"),
    ("ADMISSION", "Admission details"),
    ("LEGAL_STATUS", "Legal admission status"),
    ("FUNCTIONAL", "Functional impact"),
    ("CLINICAL_SUMMARY", "Presenting concern and clinical impression"),
    ("DIAGNOSIS", "Diagnoses"),
    ("MEDICATION", "Medications"),
    ("ALLERGY", "Allergies and adverse reactions"),
    ("RISK", "Current risk"),
    ("ASSESSMENTS", "Assessment results"),
    ("INVESTIGATIONS", "Investigations"),
    ("SUBSTANCE_USE", "Substance use"),
    ("TREATMENT_PLAN", "Treatment plan"),
    ("SAFETY_PLAN", "Safety plan"),
    ("DISCHARGE", "Discharge"),
    ("CAPACITY", "Decision-specific capacity"),
    ("CONSENT", "Consent status"),
    ("FAMILY", "Family / next of kin"),
    ("INSURANCE", "Insurance / funding"),
    ("APPOINTMENTS", "Appointments"),
    ("PSYCHOTHERAPY", "Psychotherapy session content"),
    ("CLINICIAN", "Clinician"),
    ("FACILITY", "Facility"),
]
DATA_CLASS_NAMES = dict(DATA_CLASSES)
CLASS_ORDER = [code for code, _ in DATA_CLASSES]

# Never placed in any generated document, internal or external — psychotherapy
# session content is not bound by any template (DOC-CI-04, DOC-GOV-03).
NEVER_DISCLOSED = ["PSYCHOTHERAPY"]
# Sensitive MH / SUD classes: never disclosed externally merely because they
# exist (DOC-GOV-03) — only when the recipient type allows them and they are
# explicitly authorized.
SENSITIVE_CLASSES = [
    "LEGAL_STATUS",
    "CLINICAL_SUMMARY",
    "DIAGNOSIS",
    "MEDICATION",
    "RISK",
    "ASSESSMENTS",
    "INVESTIGATIONS",
    "SUBSTANCE_USE",
    "TREATMENT_PLAN",
    "SAFETY_PLAN",
    "DISCHARGE",
    "CAPACITY",
    "PSYCHOTHERAPY",
]
# Always present on a document: who wrote it and where (DOC-GOV-05).
ALWAYS_BOUND = [
    "author.name",
    "author.credentials",
    "facility.name",
    "facility.branch",
    "facility.address",
    "facility.phone",
    "facility.email",
]

# ── Recipient types: disclosure profiles (DOC-CI-02/04/05/06) ──
# external  — leaving the treating team; triggers the consent check (DOC-GOV-04)
# consent_type — the client_registry.ConsentRecord type that authorizes it
# default — classes included with the authorization alone
# authorizable — classes the clinician may add, each needing explicit
#   authorization (in the consent's disclosure_scope or, under an alternative
#   legal basis, the clinician's recorded selection)
# alternative_bases — lawful bases other than consent this recipient type can
#   rely on; which ones a template permits is set per template.
_ALL_CLINICAL = [c for c in CLASS_ORDER if c not in NEVER_DISCLOSED]
_CORE = ["IDENTITY", "CLINICIAN", "FACILITY"]
RECIPIENT_TYPES = {
    "EMPLOYER": {
        "label": "Employer",
        "external": True,
        "consent_type": "EMPLOYER_COMMUNICATION",
        "default": _CORE + ["OCCUPATION", "ADMINISTRATIVE", "ADMISSION", "FUNCTIONAL"],
        "authorizable": ["DIAGNOSIS"],
    },
    "SCHOOL": {
        "label": "School / university",
        "external": True,
        "consent_type": "SCHOOL_COMMUNICATION",
        "default": _CORE + ["OCCUPATION", "ADMINISTRATIVE", "ADMISSION", "FUNCTIONAL"],
        "authorizable": ["DIAGNOSIS", "TREATMENT_PLAN"],
    },
    "TREATING_CLINICIAN": {
        "label": "Treating clinician (external)",
        "external": True,
        "consent_type": "RELEASE_OF_INFORMATION",
        "default": _CORE + ["CONTACT", "ADMINISTRATIVE"],
        "authorizable": [
            "ADMISSION",
            "LEGAL_STATUS",
            "FUNCTIONAL",
            "CLINICAL_SUMMARY",
            "DIAGNOSIS",
            "MEDICATION",
            "ALLERGY",
            "RISK",
            "ASSESSMENTS",
            "INVESTIGATIONS",
            "SUBSTANCE_USE",
            "TREATMENT_PLAN",
            "SAFETY_PLAN",
            "DISCHARGE",
            "CAPACITY",
            "FAMILY",
            "OCCUPATION",
            "APPOINTMENTS",
        ],
    },
    "RECEIVING_FACILITY": {
        "label": "Receiving facility",
        "external": True,
        "consent_type": "RELEASE_OF_INFORMATION",
        "default": _CORE + ["CONTACT", "ADMINISTRATIVE"],
        "authorizable": [
            "ADMISSION",
            "LEGAL_STATUS",
            "FUNCTIONAL",
            "CLINICAL_SUMMARY",
            "DIAGNOSIS",
            "MEDICATION",
            "ALLERGY",
            "RISK",
            "ASSESSMENTS",
            "INVESTIGATIONS",
            "SUBSTANCE_USE",
            "TREATMENT_PLAN",
            "SAFETY_PLAN",
            "DISCHARGE",
            "CAPACITY",
            "FAMILY",
            "APPOINTMENTS",
        ],
    },
    "INTERNAL_TEAM": {
        "label": "Internal care team",
        "external": False,
        "consent_type": "",
        "default": _ALL_CLINICAL,
        "authorizable": [],
    },
    "DIAGNOSTIC_SERVICE": {
        "label": "Facility diagnostic service (laboratory / ECG / imaging)",
        "external": False,
        "consent_type": "",
        "default": _ALL_CLINICAL,
        "authorizable": [],
    },
    "PATIENT": {
        "label": "Client (self)",
        "external": False,
        "consent_type": "",
        "default": _ALL_CLINICAL,
        "authorizable": [],
    },
    "FAMILY": {
        "label": "Family / caregiver",
        "external": True,
        "consent_type": "FAMILY_INVOLVEMENT",
        "default": _CORE + ["ADMINISTRATIVE", "APPOINTMENTS", "FAMILY"],
        "authorizable": [
            "ADMISSION",
            # LGL-DOC-05 names the family as a recipient of a signed voluntary-
            # admission form; still only with the client's explicit authorization.
            "LEGAL_STATUS",
            "FUNCTIONAL",
            "TREATMENT_PLAN",
            "SAFETY_PLAN",
            "MEDICATION",
            "DIAGNOSIS",
            "DISCHARGE",
        ],
    },
    "INSURER": {
        "label": "Insurer / funder",
        "external": True,
        "consent_type": "RELEASE_OF_INFORMATION",
        "default": _CORE + ["ADMINISTRATIVE", "INSURANCE"],
        "authorizable": [
            "ADMISSION",
            "DIAGNOSIS",
            "TREATMENT_PLAN",
            "ASSESSMENTS",
            "RISK",
            "MEDICATION",
            "DISCHARGE",
            "FUNCTIONAL",
            "SUBSTANCE_USE",
        ],
    },
    "EAP": {
        "label": "Employee assistance programme",
        "external": True,
        "consent_type": "RELEASE_OF_INFORMATION",
        "default": _CORE + ["OCCUPATION", "ADMINISTRATIVE"],
        "authorizable": ["FUNCTIONAL"],
    },
    "LEGAL": {
        "label": "Court / legal representative",
        "external": True,
        "consent_type": "RELEASE_OF_INFORMATION",
        "default": _CORE + ["ADMINISTRATIVE"],
        "authorizable": [
            "ADMISSION",
            "LEGAL_STATUS",
            "FUNCTIONAL",
            "CLINICAL_SUMMARY",
            "DIAGNOSIS",
            "MEDICATION",
            "RISK",
            "ASSESSMENTS",
            "SUBSTANCE_USE",
            "CAPACITY",
            "TREATMENT_PLAN",
        ],
        "alternative_bases": ["COURT_ORDER"],
    },
    "STATUTORY_AUTHORITY": {
        "label": "Statutory / safeguarding authority",
        "external": True,
        "consent_type": "RELEASE_OF_INFORMATION",
        "default": _CORE + ["ADMINISTRATIVE"],
        "authorizable": [
            "CONTACT",
            "ADMISSION",
            "LEGAL_STATUS",
            "FUNCTIONAL",
            "CLINICAL_SUMMARY",
            "DIAGNOSIS",
            "MEDICATION",
            "RISK",
            "ASSESSMENTS",
            "SUBSTANCE_USE",
            "CAPACITY",
            "FAMILY",
        ],
        "alternative_bases": ["STATUTORY_DUTY"],
    },
    "COMMUNITY_SERVICE": {
        "label": "Community / social service",
        "external": True,
        "consent_type": "RELEASE_OF_INFORMATION",
        "default": _CORE + ["CONTACT"],
        "authorizable": ["FUNCTIONAL", "FAMILY", "APPOINTMENTS", "OCCUPATION"],
    },
}

# Lawful bases recorded on every release (DisclosureRecord.legal_basis).
# ASSUMPTION / VERIFY: which statutory provisions make COURT_ORDER,
# STATUTORY_DUTY and EMERGENCY lawful bases in this jurisdiction (OQ-11) —
# the system records the clinician's stated reference, it cites no statute.
LEGAL_BASES = {
    "CONSENT": "Client authorization on record",
    "SUBJECT_ACCESS": "Release to the client (subject of the record)",
    "INTERNAL_CARE": "Internal use by the treating team",
    "COURT_ORDER": "Court order / legal process (reference required)",
    "STATUTORY_DUTY": "Statutory or safeguarding duty (reference required)",
    "EMERGENCY": "Emergency — immediate risk to life or health (reason required)",
}

# ── Referral destinations (DOC-CI-08) ──
# ASSUMPTION: the recommended data classes per receiving discipline are a
# conservative default needing clinical-governance sign-off; they are offers
# the clinician confirms (RULE-05), and still subject to authorization.
REFERRAL_DESTINATIONS = {
    "PSYCHIATRIST": [
        "CLINICAL_SUMMARY",
        "DIAGNOSIS",
        "MEDICATION",
        "ALLERGY",
        "RISK",
        "ASSESSMENTS",
        "SUBSTANCE_USE",
    ],
    "PSYCHOLOGIST": ["CLINICAL_SUMMARY", "DIAGNOSIS", "ASSESSMENTS", "RISK", "FUNCTIONAL"],
    "PHYSICIAN": ["DIAGNOSIS", "MEDICATION", "ALLERGY", "INVESTIGATIONS"],
    "ADDICTION_SPECIALIST": ["SUBSTANCE_USE", "MEDICATION", "ASSESSMENTS", "RISK", "ALLERGY"],
    "NEUROLOGIST": ["CLINICAL_SUMMARY", "DIAGNOSIS", "MEDICATION", "INVESTIGATIONS", "ALLERGY"],
    "DIETITIAN": ["ALLERGY", "MEDICATION", "INVESTIGATIONS"],
    "OCCUPATIONAL_THERAPIST": ["FUNCTIONAL", "OCCUPATION", "DIAGNOSIS"],
    "PHYSIOTHERAPIST": ["FUNCTIONAL", "ALLERGY"],
    "SOCIAL_WORKER": ["FUNCTIONAL", "FAMILY", "CONTACT", "OCCUPATION"],
    "FAMILY_THERAPIST": ["FAMILY", "FUNCTIONAL"],
    "OTHER_SPECIALIST": ["DIAGNOSIS", "MEDICATION", "ALLERGY"],
}
REFERRAL_DESTINATION_FIELDS = {
    # Destination-specific extra fields (labels only — no clinical content).
    "OTHER_SPECIALIST": ["specialty_name"],
}

# ── Authorization profiles (DOC-GOV-02 / 07 / 08) ──
# Each names authorisation groups; each group is a permission (group_permission)
# that the Org Admin grants to roles in Roles & Permissions (X-02 RBAC).
AUTH_PROFILES = {
    "clinical": {
        "generate": ["CLINICAL_STAFF"],
        "review": ["CREDENTIALED"],
        "approve": ["CREDENTIALED"],
        "sign": ["CREDENTIALED"],
        "release": ["RELEASE_OFFICERS", "CREDENTIALED"],
    },
    "medical": {
        "generate": ["CLINICAL_STAFF"],
        "review": ["MEDICAL"],
        "approve": ["MEDICAL"],
        "sign": ["MEDICAL"],
        "release": ["RELEASE_OFFICERS", "CREDENTIALED"],
    },
    "nursing": {
        "generate": ["NURSING", "PRESCRIBERS"],
        "review": ["NURSING", "CREDENTIALED"],
        "approve": ["NURSING", "CREDENTIALED"],
        "sign": ["NURSING", "CREDENTIALED"],
        "release": ["RELEASE_OFFICERS", "CREDENTIALED"],
    },
    "prescribing": {
        "generate": ["PRESCRIBERS"],
        "review": ["PRESCRIBERS"],
        "approve": ["PRESCRIBERS"],
        "sign": ["PRESCRIBERS"],
        "release": ["PRESCRIBERS"],
    },
    "high_risk": {
        "generate": ["CREDENTIALED"],
        "review": ["SENIOR"],
        "approve": ["SENIOR"],
        "sign": ["SENIOR"],
        "release": ["RELEASE_OFFICERS", "SENIOR"],
    },
    # ASSUMPTION: an administrative communication with no clinical content may be
    # authorized by records / front-desk staff as well as clinicians.
    "administrative": {
        "generate": ["ADMIN_STAFF", "CLINICAL_STAFF"],
        "review": ["ADMIN_STAFF", "CREDENTIALED"],
        "approve": ["ADMIN_STAFF", "CREDENTIALED"],
        "sign": ["ADMIN_STAFF", "CREDENTIALED"],
        "release": ["ADMIN_STAFF", "RELEASE_OFFICERS", "CREDENTIALED"],
    },
    # LGL-DOC-02: statutory forms. "sign" is empty on purpose — the applicant /
    # practitioner / admitting-officer signatures are taken by the legal module
    # (authorization.signingRoles); this module only releases a signed form.
    "statutory_legal": {
        "generate": ["CREDENTIALED"],
        "review": ["SENIOR"],
        "approve": ["SENIOR"],
        "sign": [],
        "release": ["RELEASE_OFFICERS", "SENIOR"],
    },
    "financial": {
        "generate": ["BILLING", "ADMIN_STAFF"],
        "review": ["BILLING"],
        "approve": ["BILLING"],
        "sign": ["BILLING"],
        "release": ["BILLING", "RELEASE_OFFICERS"],
    },
}


def group_permission(name):
    """The permission that puts a person in an authorisation group
    (apps.accounts.catalogue.DOCUMENT_GROUP_PERMISSIONS). PRESCRIBERS is the
    prescribing permission itself (DOC-GOV-08), so prescribing documents follow
    the one prescribing policy."""
    from apps.accounts.catalogue import DOCUMENT_GROUP_PERMISSIONS

    return DOCUMENT_GROUP_PERMISSIONS[name]


# ── User-entered fields (DOC-SPEC #5): only what cannot be derived ──
# type: text | textarea | date | datetime | valueset | multi_valueset | classes |
#       monitoring
USER_FIELDS = {
    "recipient_name": ("Recipient (person)", "text"),
    "recipient_organization": ("Recipient organisation", "text"),
    "purpose": ("Purpose of this document", "text"),
    "legal_basis": ("Lawful basis for release", "valueset", "doc-legal-basis"),
    "legal_basis_reference": ("Order / duty reference", "text"),
    "diagnosis_disclosure": ("Diagnosis disclosure", "valueset", "doc-diagnosis-disclosure"),
    "include_classes": ("Information to include", "classes"),
    "clinician_comment": ("Clinician comment (optional)", "textarea"),
    "period_from": ("From", "date"),
    "period_to": ("To", "date"),
    "extension_period": ("Extension period requested", "text"),
    "extension_reason": ("Reason an extension is needed", "textarea"),
    "examinations": ("Examination(s) concerned", "text"),
    "deferment_period": ("Deferment requested until", "text"),
    "return_date": ("Return date", "date"),
    "review_date": ("Review date", "date"),
    "restrictions": ("Restrictions / adjustments advised", "textarea"),
    "plan_schedule": ("Phased schedule", "textarea"),
    "accommodations": ("Accommodations recommended", "textarea"),
    "limitations": ("Functional limitations observed", "textarea"),
    "expected_duration": ("Expected duration", "text"),
    "assessment_question": ("Question to be answered", "textarea"),
    "clinician_opinion": ("Clinician opinion", "textarea"),
    "recommended_load": ("Recommended academic load", "textarea"),
    "rationale": ("Clinical rationale", "textarea"),
    "plan_details": ("Support plan", "textarea"),
    "referral_destination": ("Refer to", "valueset", "doc-referral-destination"),
    "specialty_name": ("Specialty", "text"),
    "referral_reason": ("Reason for referral", "textarea"),
    "referral_question": ("Specific question for the receiving clinician", "textarea"),
    "urgency": ("Urgency", "valueset", "doc-urgency"),
    "immediate_safety_requirements": ("Immediate safety requirements", "textarea"),
    "support_needed": ("Support needed", "textarea"),
    "level_of_care_requested": ("Level of care requested", "text"),
    "clinical_question": ("Clinical question / indication", "textarea"),
    "examination_requested": ("Examination requested", "text"),
    "monitoring": ("Medication-monitoring investigations", "monitoring"),
    "action_required": ("Action required", "textarea"),
    "prescription_note": ("Note to dispenser", "textarea"),
    "reconciliation_notes": ("Reconciliation decisions", "textarea"),
    "instructions": ("Instructions", "textarea"),
    "changes": ("What changed and why", "textarea"),
    "review_findings": ("Review findings", "textarea"),
    "next_review_date": ("Next review date", "date"),
    "progress_summary": ("Progress summary", "textarea"),
    "mdt_discussion": ("MDT discussion and decisions", "textarea"),
    "completion_date": ("Completion date", "date"),
    "transfer_reason": ("Reason for transfer", "textarea"),
    "handover_notes": ("Handover notes", "textarea"),
    "risks_explained": ("Risks explained to the client", "textarea"),
    "client_statement": ("Client's stated reasons", "textarea"),
    "follow_up_offered": ("Follow-up offered", "textarea"),
    "follow_up_plan": ("Follow-up plan", "textarea"),
    "relapse_plan": ("Relapse-prevention plan", "textarea"),
    "aftercare_plan": ("Aftercare plan", "textarea"),
    "consent_scope": ("Information covered", "classes"),
    "valid_until": ("Valid until", "date"),
    "procedure": ("Procedure / test", "text"),
    "source_organization": ("Organisation holding the information", "text"),
    "information_requested": ("Information requested", "textarea"),
    "meeting_datetime": ("Meeting date and time", "datetime"),
    "meeting_purpose": ("Purpose of the meeting", "textarea"),
    "update_summary": ("Update", "textarea"),
    "topics": ("Topics", "textarea"),
    "reintegration_plan": ("Reintegration plan", "textarea"),
    "risk_formulation": ("Risk formulation", "textarea"),
    "management_plan": ("Risk management plan", "textarea"),
    "requested_service": ("Service requested", "textarea"),
    "justification": ("Clinical justification", "textarea"),
    "report_question": ("Question(s) the report answers", "textarea"),
    "concern_details": ("Concern", "textarea"),
    "actions_taken": ("Actions taken", "textarea"),
    "incident_datetime": ("Date and time of incident", "datetime"),
    "incident_description": ("What happened", "textarea"),
    "immediate_actions": ("Immediate actions", "textarea"),
    "records_enclosed": ("Records enclosed", "textarea"),
    "request_date": ("Date of request", "date"),
}

# ── Binding bundles (keys resolve in bindings.py) ──
ID = ["patient.full_name", "patient.date_of_birth", "patient.citramac_number", "patient.mrn"]
CONTACT = ["patient.contact"]
OCC = ["patient.occupation", "intake.current_study"]
ATT = ["episode.period_start", "episode.period_end", "attendance.summary"]
ATTENDED = ["appointments.attended"]
ADM = ["admission.admitted_at", "admission.discharged_at", "admission.ward"]
LEGAL = ["admission.legal_status"]
FUNC = [
    "intake.work_function",
    "intake.study_work_impact",
    "intake.self_care",
    "intake.social_function",
]
CLIN = ["intake.presenting_concern", "intake.clinical_impression"]
DX = ["diagnoses.active"]
MED = ["medications.active"]
MEDHX = ["medications.history"]
MAR = ["mar.recent"]
ALG = ["allergies.current"]
RISK = ["risk.triage_priority", "risk.active_alerts", "risk.intake_level"]
ASM = ["assessments.latest"]
ASM_SERIES = ["assessments.series"]
LAB = ["labs.recent_results"]
LABORD = ["labs.open_orders"]
LABABN = ["labs.unacknowledged_abnormal"]
SUD = ["substance.intake_summary"]
PLAN = ["careplan.goals", "careplan.activities", "careplan.review_date"]
SAFE = ["safetyplan.latest"]
DIS = ["discharge.latest"]
CAP = ["capacity.latest"]
CONS = ["consents.current"]
FAM = ["family.contacts"]
INS = ["insurance.coverage"]
APPT = ["appointments.upcoming"]
MISSED = ["appointments.missed"]
HIST = ["episode.status_history", "encounters.recent"]

DEFAULT_OUTPUTS = ["PRINT", "PDF", "RECORDED_RELEASE"]
INTERNAL_OUTPUTS = ["PRINT", "PDF", "FILE_IN_CHART"]


def _t(
    cat,
    nn,
    name,
    *,
    trigger,
    binds,
    fields=(),
    recipients,
    profile="clinical",
    high_risk=False,
    verify=None,
    flags=(),
    tags=(),
    alternative_bases=(),
):
    return {
        "cat": cat,
        "nn": nn,
        "name": name,
        "trigger": trigger,
        "binds": list(binds),
        "fields": list(fields),
        "recipients": list(recipients),
        "profile": profile,
        "high_risk": high_risk,
        "verify": verify,
        "flags": list(flags),
        "tags": list(tags),
        "alternative_bases": list(alternative_bases),
    }


_CERT = "VERIFY: facility-approved wording for this form/statement is not in the repository"
_EMP = ["EMPLOYER", "PATIENT"]
_SCH = ["SCHOOL", "PATIENT"]

_RAW = [
    # 1 — Work & Employment
    _t(
        "WRK",
        1,
        "Medical certificate / sick-off note",
        profile="medical",
        trigger="Client is unfit for work for a period and needs certified absence.",
        binds=ID + OCC + ATT + ADM + FUNC + DX,
        fields=["period_from", "period_to", "clinician_comment"],
        recipients=_EMP,
        tags=["sick note", "sick leave", "certificate", "employer"],
    ),
    _t(
        "WRK",
        2,
        "Medical leave recommendation",
        profile="medical",
        trigger="Clinician recommends a period of leave from work.",
        binds=ID + OCC + ATT + ADM + FUNC + DX,
        fields=["period_from", "period_to", "clinician_comment"],
        recipients=_EMP,
        tags=["leave", "employer"],
    ),
    _t(
        "WRK",
        3,
        "Medical leave extension",
        profile="medical",
        trigger="An existing period of medical leave needs extending.",
        binds=ID + OCC + ATT + ADM + FUNC + DX,
        fields=["period_from", "period_to", "extension_reason", "clinician_comment"],
        recipients=_EMP,
        tags=["leave", "extension", "employer"],
    ),
    _t(
        "WRK",
        4,
        "Return-to-work letter",
        trigger="Client is ready to resume work, with or without adjustments.",
        binds=ID + OCC + ATT + ADM + FUNC + DX,
        fields=["return_date", "restrictions", "review_date", "clinician_comment"],
        recipients=_EMP,
        tags=["return to work", "fit note", "employer"],
    ),
    _t(
        "WRK",
        5,
        "Graduated return-to-work plan",
        trigger="Client returns to work through a phased schedule.",
        binds=ID + OCC + ATT + FUNC + DX,
        fields=["return_date", "plan_schedule", "review_date", "clinician_comment"],
        recipients=_EMP,
        tags=["phased return", "employer"],
    ),
    _t(
        "WRK",
        6,
        "Workplace accommodation recommendation",
        trigger="Client needs workplace adjustments to work safely.",
        binds=ID + OCC + FUNC + DX,
        fields=["accommodations", "review_date", "clinician_comment"],
        recipients=_EMP,
        tags=["adjustments", "reasonable accommodation", "employer"],
    ),
    _t(
        "WRK",
        7,
        "Functional limitations report",
        trigger="Employer or client needs the client's current functional limitations described.",
        binds=ID + OCC + ATT + FUNC + DX,
        fields=["limitations", "expected_duration", "clinician_comment"],
        recipients=_EMP,
        tags=["function", "capacity for work", "employer"],
    ),
    _t(
        "WRK",
        8,
        "Fitness-for-duty assessment / referral",
        profile="medical",
        trigger="Employer asks whether the client is fit for their duties.",
        binds=ID + OCC + ATT + FUNC + DX,
        fields=["assessment_question", "clinician_opinion", "review_date"],
        recipients=["EMPLOYER", "TREATING_CLINICIAN", "PATIENT"],
        tags=["fitness for duty", "occupational health", "employer"],
    ),
    _t(
        "WRK",
        9,
        "Treatment / appointment attendance confirmation",
        profile="administrative",
        trigger="Client needs proof of attending treatment or appointments.",
        binds=ID + ATT + ATTENDED,
        fields=["clinician_comment"],
        recipients=["EMPLOYER", "SCHOOL", "PATIENT"],
        tags=["attendance", "proof", "employer"],
    ),
    # 2 — School & University
    _t(
        "EDU",
        1,
        "Medical absence letter",
        trigger="Client was or will be absent from school / university for health reasons.",
        binds=ID + OCC + ATT + ADM + FUNC + DX,
        fields=["period_from", "period_to", "clinician_comment"],
        recipients=_SCH,
        tags=["absence", "school", "university", "student"],
    ),
    _t(
        "EDU",
        2,
        "Academic extension request",
        trigger="Client needs more time for coursework because of their condition (DOC-UX-03).",
        binds=ID + OCC + ATT + ADM + FUNC + DX,
        fields=["extension_period", "clinician_comment"],
        recipients=_SCH,
        tags=["extension", "coursework", "deadline", "student"],
    ),
    _t(
        "EDU",
        3,
        "Examination deferment request",
        trigger="Client cannot sit scheduled examinations for health reasons.",
        binds=ID + OCC + ATT + ADM + FUNC + DX,
        fields=["examinations", "deferment_period", "clinician_comment"],
        recipients=_SCH,
        tags=["exams", "deferral", "student"],
    ),
    _t(
        "EDU",
        4,
        "Medical leave from studies",
        trigger="Clinician recommends a period of leave from studies.",
        binds=ID + OCC + ATT + ADM + FUNC + DX,
        fields=["period_from", "period_to", "clinician_comment"],
        recipients=_SCH,
        tags=["leave", "student"],
    ),
    _t(
        "EDU",
        5,
        "Return-to-school / university letter",
        trigger="Client is ready to resume studies.",
        binds=ID + OCC + ATT + ADM + FUNC + DX,
        fields=["return_date", "restrictions", "review_date", "clinician_comment"],
        recipients=_SCH,
        tags=["return", "student"],
    ),
    _t(
        "EDU",
        6,
        "Academic accommodation recommendation",
        trigger="Client needs academic adjustments to study safely.",
        binds=ID + OCC + FUNC + DX,
        fields=["accommodations", "review_date", "clinician_comment"],
        recipients=_SCH,
        tags=["adjustments", "disability services", "student"],
    ),
    _t(
        "EDU",
        7,
        "Reduced academic-load recommendation",
        trigger="Client should temporarily carry a reduced study load.",
        binds=ID + OCC + FUNC + DX,
        fields=["recommended_load", "period_from", "period_to", "clinician_comment"],
        recipients=_SCH,
        tags=["part-time", "load", "student"],
    ),
    _t(
        "EDU",
        8,
        "Temporary withdrawal recommendation",
        trigger="Clinician recommends temporary withdrawal from studies.",
        binds=ID + OCC + ATT + ADM + FUNC + DX,
        fields=["period_from", "rationale", "clinician_comment"],
        recipients=_SCH,
        tags=["withdrawal", "interruption", "student"],
    ),
    _t(
        "EDU",
        9,
        "Student reintegration / support plan",
        trigger="Client is returning to studies and needs a support plan.",
        binds=ID + OCC + FUNC + PLAN + DX,
        fields=["plan_details", "review_date"],
        recipients=_SCH,
        tags=["reintegration", "support plan", "student"],
    ),
    _t(
        "EDU",
        10,
        "Referral to school / university counselling or support",
        trigger="Client would benefit from on-campus counselling or support services.",
        binds=ID + OCC + CONTACT + FUNC,
        fields=["referral_reason", "support_needed"],
        recipients=["SCHOOL"],
        tags=["counselling", "student support", "referral"],
    ),
    # 3 — Referrals & Consultations
    _t(
        "REF",
        1,
        "Clinical / specialist referral",
        flags=["referral_destination"],
        trigger="Client needs assessment or care from another discipline.",
        binds=ID
        + CONTACT
        + OCC
        + ATT
        + CLIN
        + FUNC
        + DX
        + MED
        + ALG
        + RISK
        + ASM
        + LAB
        + SUD
        + FAM,
        fields=["referral_destination", "referral_reason", "referral_question", "urgency"],
        recipients=["TREATING_CLINICIAN", "INTERNAL_TEAM"],
        tags=["referral", "consultation", "specialist"],
    ),
    _t(
        "REF",
        2,
        "Emergency referral",
        high_risk=True,
        profile="high_risk",
        flags=["risk_relevant"],
        alternative_bases=["EMERGENCY"],
        trigger="Client needs immediate care elsewhere because of acute risk.",
        binds=ID + CONTACT + LEGAL + CLIN + DX + MED + ALG + RISK + SUD + FAM,
        fields=["referral_reason", "immediate_safety_requirements", "urgency"],
        recipients=["TREATING_CLINICIAN", "RECEIVING_FACILITY"],
        tags=["emergency", "urgent referral"],
    ),
    _t(
        "REF",
        3,
        "Second-opinion request",
        trigger="Treating clinician or client requests a second opinion.",
        binds=ID + ATT + CLIN + DX + MED + ALG + ASM + RISK,
        fields=["referral_question", "urgency"],
        recipients=["TREATING_CLINICIAN", "INTERNAL_TEAM"],
        tags=["second opinion", "consultation"],
    ),
    _t(
        "REF",
        4,
        "Community / social-service referral",
        trigger="Client needs community or social support.",
        binds=ID + CONTACT + OCC + FUNC + FAM + APPT,
        fields=["referral_reason", "support_needed"],
        recipients=["COMMUNITY_SERVICE"],
        tags=["social services", "community", "housing", "referral"],
    ),
    _t(
        "REF",
        5,
        "Higher-level-of-care referral",
        flags=["risk_relevant"],
        trigger="Client needs a more intensive level of care.",
        binds=ID + CONTACT + ADM + LEGAL + CLIN + DX + MED + ALG + RISK + ASM + SUD,
        fields=["level_of_care_requested", "referral_reason", "immediate_safety_requirements"],
        recipients=["RECEIVING_FACILITY", "INTERNAL_TEAM"],
        tags=["step up", "level of care", "referral"],
    ),
    # 4 — Investigations & Diagnostics
    _t(
        "INV",
        1,
        "Laboratory requisition",
        trigger="Laboratory tests have been ordered and need a requisition.",
        binds=ID + LABORD + MED + ALG + DX,
        fields=["clinical_question", "urgency"],
        recipients=["DIAGNOSTIC_SERVICE"],
        tags=["lab", "blood test", "requisition"],
    ),
    _t(
        "INV",
        2,
        "Toxicology / drug-screen requisition",
        trigger="A toxicology or drug screen has been ordered.",
        binds=ID + LABORD + MED,
        fields=["clinical_question", "urgency"],
        recipients=["DIAGNOSTIC_SERVICE"],
        tags=["toxicology", "urine drug screen", "lab"],
    ),
    _t(
        "INV",
        3,
        "Medication-monitoring investigations",
        flags=["medication_monitoring"],
        trigger="A medication needs laboratory monitoring for this client.",
        binds=ID + MED + LAB + ALG,
        fields=["monitoring", "clinical_question"],
        recipients=["DIAGNOSTIC_SERVICE"],
        tags=["monitoring", "lab", "medication"],
    ),
    _t(
        "INV",
        4,
        "ECG request",
        trigger="An ECG is needed.",
        binds=ID + MED + ALG,
        fields=["clinical_question", "urgency"],
        recipients=["DIAGNOSTIC_SERVICE"],
        tags=["ecg", "cardiac", "qtc"],
    ),
    _t(
        "INV",
        5,
        "Imaging / radiology request",
        trigger="Imaging is needed.",
        binds=ID + ALG + DX,
        fields=["examination_requested", "clinical_question", "urgency"],
        recipients=["DIAGNOSTIC_SERVICE"],
        tags=["imaging", "radiology", "x-ray", "ct", "mri"],
    ),
    _t(
        "INV",
        6,
        "Diagnostic results summary",
        trigger="Results need summarising for the client or another clinician.",
        binds=ID + LAB,
        fields=["clinician_comment"],
        recipients=["PATIENT", "TREATING_CLINICIAN", "INTERNAL_TEAM"],
        tags=["results", "lab results"],
    ),
    _t(
        "INV",
        7,
        "Abnormal / critical result notification",
        high_risk=True,
        profile="high_risk",
        trigger="A validated result is abnormal or critical and needs action.",
        binds=ID + LABABN + MED,
        fields=["action_required"],
        recipients=["INTERNAL_TEAM", "TREATING_CLINICIAN", "PATIENT"],
        tags=["critical result", "abnormal", "alert"],
    ),
    # 5 — Medication
    _t(
        "MED",
        1,
        "Prescription / e-prescription",
        profile="prescribing",
        flags=["prescribing"],
        verify=_CERT + " (statutory prescription content and prescriber registration number)",
        trigger="A prescriber issues a prescription (where legally permitted and authorized).",
        binds=ID + ALG + MED,
        fields=["prescription_note"],
        recipients=["PATIENT", "INTERNAL_TEAM"],
        tags=["prescription", "rx", "e-prescription"],
    ),
    _t(
        "MED",
        2,
        "Current medication list",
        trigger="Client or another clinician needs the current medication list.",
        binds=ID + ALG + MED,
        recipients=["PATIENT", "TREATING_CLINICIAN", "INTERNAL_TEAM"],
        tags=["medication list", "meds"],
    ),
    _t(
        "MED",
        3,
        "Medication reconciliation report",
        profile="medical",
        trigger="Medications were reconciled at a transition of care.",
        binds=ID + ALG + MED + MEDHX,
        fields=["reconciliation_notes"],
        recipients=["INTERNAL_TEAM", "TREATING_CLINICIAN"],
        tags=["reconciliation", "meds"],
    ),
    _t(
        "MED",
        4,
        "Medication administration record",
        profile="nursing",
        trigger="The inpatient medication administration record is needed.",
        binds=ID + ALG + MED + MAR,
        recipients=["INTERNAL_TEAM", "RECEIVING_FACILITY"],
        tags=["mar", "administration"],
    ),
    _t(
        "MED",
        5,
        "Patient medication instructions",
        trigger="Client needs written instructions for their medicines.",
        binds=ID + ALG + MED,
        fields=["instructions"],
        recipients=["PATIENT", "FAMILY"],
        tags=["instructions", "how to take"],
    ),
    _t(
        "MED",
        6,
        "Medication change / discontinuation summary",
        profile="medical",
        trigger="A medication was started, changed or stopped.",
        binds=ID + ALG + MED + MEDHX,
        fields=["changes"],
        recipients=["PATIENT", "TREATING_CLINICIAN", "INTERNAL_TEAM"],
        tags=["change", "discontinuation", "stop"],
    ),
    # 6 — Admission & Treatment
    _t(
        "ADM",
        1,
        "Admission confirmation",
        profile="administrative",
        trigger="Client has been admitted and needs confirmation of admission.",
        binds=ID + ADM + ATT,
        recipients=["PATIENT", "FAMILY", "EMPLOYER", "INSURER"],
        tags=["admission", "confirmation"],
    ),
    _t(
        "ADM",
        2,
        "Admission / initial clinical summary",
        trigger="Admission summary for the treating team or an external clinician.",
        binds=ID + ADM + LEGAL + CLIN + DX + MED + ALG + RISK + ASM + SUD,
        recipients=["INTERNAL_TEAM", "TREATING_CLINICIAN"],
        tags=["admission", "summary"],
    ),
    _t(
        "ADM",
        3,
        "Treatment plan",
        trigger="The current treatment plan is needed in document form.",
        binds=ID + PLAN + DX + RISK,
        recipients=["INTERNAL_TEAM", "PATIENT", "FAMILY"],
        tags=["care plan", "treatment plan"],
    ),
    _t(
        "ADM",
        4,
        "Treatment-plan review",
        trigger="The treatment plan was reviewed.",
        binds=ID + PLAN + ASM,
        fields=["review_findings", "next_review_date"],
        recipients=["INTERNAL_TEAM", "PATIENT"],
        tags=["care plan review"],
    ),
    _t(
        "ADM",
        5,
        "Treatment progress report",
        trigger="Progress needs reporting to the team, the client or a third party.",
        binds=ID + ATT + PLAN + ASM,
        fields=["progress_summary"],
        recipients=["INTERNAL_TEAM", "TREATING_CLINICIAN", "PATIENT", "INSURER", "FAMILY"],
        tags=["progress", "report"],
    ),
    _t(
        "ADM",
        6,
        "Multidisciplinary case summary",
        trigger="Case summary for an MDT meeting.",
        binds=ID + CLIN + DX + MED + RISK + ASM + PLAN,
        fields=["mdt_discussion"],
        recipients=["INTERNAL_TEAM"],
        tags=["mdt", "case summary"],
    ),
    _t(
        "ADM",
        7,
        "Programme / treatment participation confirmation",
        profile="administrative",
        trigger="Client needs confirmation of participation in a programme.",
        binds=ID + ATT + ATTENDED,
        recipients=["EMPLOYER", "SCHOOL", "PATIENT", "INSURER", "EAP"],
        tags=["participation", "programme", "attendance"],
    ),
    _t(
        "ADM",
        8,
        "Treatment completion letter / certificate",
        trigger="Client has completed a treatment programme.",
        binds=ID + ATT + DIS,
        fields=["completion_date", "clinician_comment"],
        recipients=["PATIENT", "EMPLOYER", "SCHOOL", "INSURER"],
        tags=["completion", "certificate"],
    ),
    # 7 — Transfer & Continuity
    _t(
        "TRF",
        1,
        "Inter-facility transfer",
        flags=["risk_relevant"],
        trigger="Client is transferring to another facility.",
        binds=ID
        + CONTACT
        + ADM
        + LEGAL
        + CLIN
        + DX
        + MED
        + ALG
        + RISK
        + ASM
        + LAB
        + SUD
        + FAM
        + SAFE,
        fields=["transfer_reason", "immediate_safety_requirements"],
        recipients=["RECEIVING_FACILITY"],
        tags=["transfer", "inter-facility"],
    ),
    _t(
        "TRF",
        2,
        "Internal transfer / handover",
        flags=["risk_relevant"],
        trigger="Client moves between wards, teams or services in this facility.",
        binds=ID + ADM + LEGAL + CLIN + DX + MED + ALG + RISK + ASM + SUD + SAFE,
        fields=["transfer_reason", "handover_notes", "immediate_safety_requirements"],
        recipients=["INTERNAL_TEAM"],
        tags=["handover", "internal transfer"],
    ),
    _t(
        "TRF",
        3,
        "Emergency transfer",
        high_risk=True,
        profile="high_risk",
        flags=["risk_relevant"],
        alternative_bases=["EMERGENCY"],
        trigger="Client needs emergency transfer for urgent care.",
        binds=ID + CONTACT + ADM + LEGAL + CLIN + DX + MED + ALG + RISK + SUD + FAM,
        fields=["transfer_reason", "immediate_safety_requirements"],
        recipients=["RECEIVING_FACILITY"],
        tags=["emergency", "transfer"],
    ),
    _t(
        "TRF",
        4,
        "Transfer to higher / lower level of care",
        flags=["risk_relevant"],
        trigger="Client steps up or down to a different level of care.",
        binds=ID + ADM + LEGAL + CLIN + DX + MED + ALG + RISK + ASM + PLAN,
        fields=["level_of_care_requested", "transfer_reason", "immediate_safety_requirements"],
        recipients=["RECEIVING_FACILITY", "INTERNAL_TEAM"],
        tags=["step up", "step down", "level of care"],
    ),
    _t(
        "TRF",
        5,
        "Continuity-of-care clinical summary",
        trigger="Another provider will continue the client's care.",
        binds=ID + ATT + CLIN + DX + MED + ALG + RISK + ASM + PLAN + APPT,
        recipients=["TREATING_CLINICIAN", "RECEIVING_FACILITY", "PATIENT"],
        tags=["continuity", "summary", "handover"],
    ),
    # 8 — Discharge & Aftercare
    _t(
        "DIS",
        1,
        "Discharge summary",
        profile="medical",
        trigger="Client is discharged from an admission.",
        binds=ID + ADM + LEGAL + DIS + DX + MED + ALG + RISK + APPT,
        recipients=["PATIENT", "TREATING_CLINICIAN", "INTERNAL_TEAM"],
        tags=["discharge", "summary"],
    ),
    _t(
        "DIS",
        2,
        "Discharge instructions",
        trigger="Client needs written instructions on discharge.",
        binds=ID + ALG + MED + APPT,
        fields=["instructions"],
        recipients=["PATIENT", "FAMILY"],
        tags=["discharge", "instructions"],
    ),
    _t(
        "DIS",
        3,
        "Discharge medication list",
        trigger="Client needs the medication list on discharge.",
        binds=ID + ALG + MED,
        recipients=["PATIENT", "TREATING_CLINICIAN", "FAMILY"],
        tags=["discharge", "medication list"],
    ),
    _t(
        "DIS",
        4,
        "Against-medical-advice discharge documentation",
        high_risk=True,
        profile="high_risk",
        trigger="Client leaves against medical advice.",
        binds=ID + ADM + LEGAL + RISK + CAP,
        fields=["risks_explained", "client_statement", "follow_up_offered"],
        recipients=["INTERNAL_TEAM"],
        tags=["ama", "self-discharge", "against advice"],
    ),
    _t(
        "DIS",
        5,
        "Follow-up / continuing-care plan",
        trigger="Client needs a written follow-up plan.",
        binds=ID + APPT + PLAN,
        fields=["follow_up_plan"],
        recipients=["PATIENT", "TREATING_CLINICIAN", "FAMILY"],
        tags=["follow-up", "aftercare"],
    ),
    _t(
        "DIS",
        6,
        "Relapse-prevention plan",
        trigger="Client and clinician agreed a relapse-prevention plan.",
        binds=ID + PLAN + SUD,
        fields=["relapse_plan"],
        recipients=["PATIENT", "FAMILY"],
        tags=["relapse prevention", "recovery"],
    ),
    _t(
        "DIS",
        7,
        "Safety / crisis plan",
        trigger="Client needs a copy of their safety / crisis plan.",
        binds=ID + SAFE,
        recipients=["PATIENT", "FAMILY", "INTERNAL_TEAM"],
        tags=["safety plan", "crisis plan"],
    ),
    _t(
        "DIS",
        8,
        "Aftercare plan",
        trigger="Client needs a written aftercare plan.",
        binds=ID + APPT + PLAN,
        fields=["aftercare_plan"],
        recipients=["PATIENT", "FAMILY", "TREATING_CLINICIAN"],
        tags=["aftercare"],
    ),
    # 9 — Consent & Information Sharing (all need facility consent wording)
    _t(
        "CON",
        1,
        "General consent for treatment",
        verify=_CERT,
        trigger="Client consents to treatment.",
        binds=ID + CONTACT + CONS,
        fields=["valid_until"],
        recipients=["PATIENT"],
        tags=["consent", "treatment"],
    ),
    _t(
        "CON",
        2,
        "Telemedicine consent",
        verify=_CERT,
        trigger="Client consents to care by telemedicine.",
        binds=ID + CONTACT + CONS,
        fields=["valid_until"],
        recipients=["PATIENT"],
        tags=["consent", "telehealth", "video"],
    ),
    _t(
        "CON",
        3,
        "Specific procedure / testing consent",
        verify=_CERT,
        trigger="Client consents to a specific procedure or test.",
        binds=ID + CONS,
        fields=["procedure"],
        recipients=["PATIENT"],
        tags=["consent", "procedure", "test"],
    ),
    _t(
        "CON",
        4,
        "Consent to involve family / caregiver",
        verify=_CERT,
        trigger="Client decides whether family may be involved.",
        binds=ID + FAM + CONS,
        fields=["consent_scope", "valid_until"],
        recipients=["PATIENT"],
        tags=["consent", "family", "caregiver"],
    ),
    _t(
        "CON",
        5,
        "Authorization to release medical information",
        verify=_CERT,
        trigger="Client authorizes release of information to a named recipient.",
        binds=ID + CONS,
        fields=["consent_scope", "valid_until"],
        recipients=["PATIENT"],
        tags=["authorization", "release", "roi"],
    ),
    _t(
        "CON",
        6,
        "Request / authorization to obtain medical information",
        verify=_CERT,
        trigger="Facility needs the client's records from another provider.",
        binds=ID + CONS,
        fields=["source_organization", "information_requested", "valid_until"],
        recipients=["PATIENT"],
        tags=["authorization", "obtain records"],
    ),
    _t(
        "CON",
        7,
        "Reciprocal exchange-of-information authorization",
        verify=_CERT,
        trigger="Client authorizes two-way exchange with another provider.",
        binds=ID + CONS,
        fields=["consent_scope", "valid_until"],
        recipients=["PATIENT"],
        tags=["authorization", "exchange"],
    ),
    _t(
        "CON",
        8,
        "Consent to communicate with employer",
        verify=_CERT,
        trigger="Client decides whether the facility may communicate with their employer.",
        binds=ID + OCC + CONS,
        fields=["consent_scope", "valid_until"],
        recipients=["PATIENT"],
        tags=["consent", "employer"],
    ),
    _t(
        "CON",
        9,
        "Consent to communicate with school / university",
        verify=_CERT,
        trigger="Client decides whether the facility may communicate with their school.",
        binds=ID + OCC + CONS,
        fields=["consent_scope", "valid_until"],
        recipients=["PATIENT"],
        tags=["consent", "school", "university"],
    ),
    _t(
        "CON",
        10,
        "Electronic communication consent",
        verify=_CERT,
        trigger="Client decides how they may be contacted electronically.",
        binds=ID + CONTACT + CONS,
        fields=["valid_until"],
        recipients=["PATIENT"],
        tags=["consent", "sms", "email"],
    ),
    _t(
        "CON",
        11,
        "Withdrawal / revocation of consent",
        verify=_CERT,
        trigger="Client withdraws a consent or authorization.",
        binds=ID + CONS,
        recipients=["PATIENT"],
        tags=["withdrawal", "revocation", "consent"],
    ),
    # 10 — Family & Caregiver
    _t(
        "FAM",
        1,
        "Request for collateral information",
        trigger="Team needs information from family or a caregiver.",
        binds=ID + FAM,
        fields=["information_requested"],
        recipients=["FAMILY"],
        tags=["collateral", "family"],
    ),
    _t(
        "FAM",
        2,
        "Family meeting invitation",
        profile="administrative",
        trigger="Family is invited to a meeting with the team.",
        binds=ID + FAM + APPT,
        fields=["meeting_datetime", "meeting_purpose"],
        recipients=["FAMILY"],
        tags=["family meeting", "invitation"],
    ),
    _t(
        "FAM",
        3,
        "Family treatment / update communication",
        trigger="Family is updated on the client's care, as the client permits.",
        binds=ID + FAM + ATT + ADM + PLAN,
        fields=["update_summary"],
        recipients=["FAMILY"],
        tags=["family update"],
    ),
    _t(
        "FAM",
        4,
        "Family education / support letter",
        verify="VERIFY: facility-approved family education content is not in the repository",
        trigger="Family needs education or support information.",
        binds=ID + FAM,
        fields=["topics"],
        recipients=["FAMILY"],
        tags=["psychoeducation", "family support"],
    ),
    _t(
        "FAM",
        5,
        "Caregiver / home-care instructions",
        trigger="Caregiver needs instructions for care at home.",
        binds=ID + FAM + ALG + MED + SAFE + APPT,
        fields=["instructions"],
        recipients=["FAMILY"],
        tags=["caregiver", "home care", "instructions"],
    ),
    _t(
        "FAM",
        6,
        "Family reintegration plan",
        trigger="Client is reintegrating with family after treatment.",
        binds=ID + FAM + PLAN,
        fields=["reintegration_plan"],
        recipients=["FAMILY", "PATIENT"],
        tags=["reintegration", "family"],
    ),
    # 11 — Clinical Reports & Summaries
    _t(
        "RPT",
        1,
        "Comprehensive clinical summary",
        trigger="A full clinical summary is needed.",
        binds=ID + ATT + ADM + LEGAL + CLIN + FUNC + DX + MED + ALG + RISK + ASM + LAB + SUD + PLAN,
        recipients=["INTERNAL_TEAM", "TREATING_CLINICIAN", "PATIENT"],
        tags=["summary", "clinical summary"],
    ),
    _t(
        "RPT",
        2,
        "Psychiatric / mental-health assessment report",
        trigger="A mental-health assessment needs reporting.",
        binds=ID + CLIN + FUNC + DX + MED + RISK + ASM,
        fields=["clinician_opinion"],
        recipients=["INTERNAL_TEAM", "TREATING_CLINICIAN", "PATIENT"],
        tags=["psychiatric report", "assessment"],
    ),
    _t(
        "RPT",
        3,
        "Substance-use assessment report",
        trigger="A substance-use assessment needs reporting.",
        binds=ID + SUD + ASM + RISK + LAB,
        fields=["clinician_opinion"],
        recipients=["INTERNAL_TEAM", "TREATING_CLINICIAN", "PATIENT"],
        tags=["substance use", "addiction", "assessment"],
    ),
    _t(
        "RPT",
        4,
        "Risk assessment report",
        high_risk=True,
        profile="high_risk",
        flags=["risk_relevant"],
        trigger="A formal risk assessment needs reporting.",
        binds=ID + RISK + ASM + SAFE,
        fields=["risk_formulation", "management_plan"],
        recipients=["INTERNAL_TEAM", "TREATING_CLINICIAN"],
        tags=["risk", "risk assessment"],
    ),
    _t(
        "RPT",
        5,
        "Diagnostic summary",
        trigger="The client's diagnoses need summarising.",
        binds=ID + DX,
        fields=["clinician_comment"],
        recipients=["INTERNAL_TEAM", "TREATING_CLINICIAN", "PATIENT"],
        tags=["diagnosis", "summary"],
    ),
    _t(
        "RPT",
        6,
        "Progress summary",
        trigger="Progress over a period needs summarising.",
        binds=ID + ATT + ASM + PLAN,
        fields=["progress_summary"],
        recipients=["INTERNAL_TEAM", "TREATING_CLINICIAN", "PATIENT"],
        tags=["progress"],
    ),
    _t(
        "RPT",
        7,
        "Outcome / ROM report",
        trigger="Routine outcome measures need reporting.",
        binds=ID + ASM_SERIES,
        fields=["clinician_comment"],
        recipients=["INTERNAL_TEAM", "TREATING_CLINICIAN", "PATIENT"],
        tags=["outcomes", "rom", "scores"],
    ),
    _t(
        "RPT",
        8,
        "Chronological episode-of-care report",
        trigger="A chronology of the episode of care is needed.",
        binds=ID + ATT + HIST + ADM + APPT,
        recipients=["INTERNAL_TEAM", "TREATING_CLINICIAN", "PATIENT"],
        tags=["chronology", "timeline", "episode"],
    ),
    # 12 — Insurance, EAP & Funding
    _t(
        "INS",
        1,
        "Preauthorization request",
        verify="VERIFY: payer form, payload requirements and benefit / tariff codes",
        trigger="Treatment needs payer preauthorization.",
        binds=ID + INS + ADM + DX + PLAN,
        fields=["requested_service"],
        recipients=["INSURER"],
        tags=["preauth", "preauthorization", "insurance"],
    ),
    _t(
        "INS",
        2,
        "Medical-necessity / treatment justification",
        profile="medical",
        trigger="Payer asks why treatment is necessary.",
        binds=ID + INS + DX + RISK + ASM + PLAN,
        fields=["justification"],
        recipients=["INSURER"],
        tags=["medical necessity", "justification", "insurance"],
    ),
    _t(
        "INS",
        3,
        "Continued-stay authorization request",
        verify="VERIFY: payer form, payload requirements and benefit / tariff codes",
        trigger="An admission needs authorization to continue.",
        binds=ID + INS + ADM + ASM + PLAN,
        fields=["justification"],
        recipients=["INSURER"],
        tags=["continued stay", "insurance"],
    ),
    _t(
        "INS",
        4,
        "Insurer clinical report",
        trigger="Payer requests a clinical report.",
        binds=ID + INS + ATT + DX + ASM + PLAN,
        fields=["clinician_comment"],
        recipients=["INSURER"],
        tags=["insurer report", "insurance"],
    ),
    _t(
        "INS",
        5,
        "Claim-supporting clinical summary",
        trigger="A claim needs a supporting clinical summary.",
        binds=ID + INS + ATT + ADM + DX,
        fields=["clinician_comment"],
        recipients=["INSURER"],
        tags=["claim", "insurance"],
    ),
    _t(
        "INS",
        6,
        "Discharge notification",
        profile="administrative",
        trigger="Payer must be told of the client's discharge.",
        binds=ID + INS + ADM + DIS,
        recipients=["INSURER"],
        tags=["discharge", "insurance"],
    ),
    _t(
        "INS",
        7,
        "EAP participation / attendance report",
        profile="administrative",
        trigger="Employee assistance programme needs participation confirmed.",
        binds=ID + OCC + ATT + ATTENDED + FUNC,
        recipients=["EAP"],
        tags=["eap", "attendance"],
    ),
    _t(
        "INS",
        8,
        "Invoice / pro-forma / statement of services",
        profile="financial",
        verify="VERIFY: tariff / fund codes and the facility's invoice format",
        trigger="Client or payer needs a statement of services.",
        binds=ID + INS + ATT,
        recipients=["INSURER", "PATIENT"],
        tags=["invoice", "pro-forma", "statement", "billing"],
    ),
    # 13 — Legal, Statutory & Safeguarding (all high-risk: DOC-GOV-07)
    _t(
        "LEG",
        1,
        "Formal medical / clinical report",
        high_risk=True,
        profile="high_risk",
        trigger="A formal report is requested about the client.",
        binds=ID + ATT + ADM + LEGAL + CLIN + FUNC + DX + MED + RISK + CAP,
        fields=["report_question", "clinician_opinion"],
        recipients=["LEGAL", "STATUTORY_AUTHORITY", "TREATING_CLINICIAN"],
        alternative_bases=["COURT_ORDER", "STATUTORY_DUTY"],
        tags=["medical report", "formal report", "legal"],
    ),
    _t(
        "LEG",
        2,
        "Court-requested report",
        high_risk=True,
        profile="high_risk",
        trigger="A court has requested a report.",
        binds=ID + ATT + ADM + LEGAL + CLIN + FUNC + DX + MED + RISK + CAP + SUD,
        fields=["report_question", "clinician_opinion"],
        recipients=["LEGAL"],
        alternative_bases=["COURT_ORDER"],
        tags=["court", "legal"],
    ),
    _t(
        "LEG",
        3,
        "Response to authorized legal information request",
        high_risk=True,
        profile="high_risk",
        trigger="An authorized legal request for information was received.",
        binds=ID + ATT + ADM + DX + MED,
        fields=["information_requested"],
        recipients=["LEGAL"],
        alternative_bases=["COURT_ORDER"],
        tags=["legal request", "subpoena", "legal"],
    ),
    _t(
        "LEG",
        4,
        "Safeguarding / protection report",
        high_risk=True,
        profile="high_risk",
        verify="VERIFY: the configured safeguarding pathway's reporting form",
        trigger="A safeguarding concern must be reported.",
        binds=ID + CONTACT + FAM + RISK,
        fields=["concern_details", "actions_taken"],
        recipients=["STATUTORY_AUTHORITY", "INTERNAL_TEAM"],
        alternative_bases=["STATUTORY_DUTY"],
        tags=["safeguarding", "child protection", "adult protection"],
    ),
    _t(
        "LEG",
        5,
        "Capacity assessment report",
        high_risk=True,
        profile="high_risk",
        trigger="A decision-specific capacity assessment needs reporting.",
        binds=ID + CAP + LEGAL,
        fields=["clinician_opinion"],
        recipients=["INTERNAL_TEAM", "LEGAL", "STATUTORY_AUTHORITY"],
        alternative_bases=["COURT_ORDER", "STATUTORY_DUTY"],
        tags=["capacity", "legal"],
    ),
    _t(
        "LEG",
        6,
        "Statutory mental-health documentation",
        high_risk=True,
        profile="high_risk",
        verify="VERIFY: statutory form wording and current statute sections (OQ-11, OQ-12)",
        trigger="Statutory mental-health paperwork is required.",
        binds=ID + ADM + LEGAL,
        recipients=["STATUTORY_AUTHORITY", "INTERNAL_TEAM"],
        alternative_bases=["STATUTORY_DUTY"],
        tags=["statutory", "mental health act", "legal"],
    ),
    _t(
        "LEG",
        7,
        "Serious incident / adverse-event report",
        high_risk=True,
        profile="high_risk",
        verify="VERIFY: the facility's incident-reporting form and notification duties",
        trigger="A serious incident or adverse event occurred.",
        binds=ID + ADM + RISK,
        fields=["incident_datetime", "incident_description", "immediate_actions"],
        recipients=["INTERNAL_TEAM", "STATUTORY_AUTHORITY"],
        alternative_bases=["STATUTORY_DUTY"],
        tags=["incident", "adverse event", "serious incident"],
    ),
    _t(
        "LEG",
        8,
        "Injury / accident report",
        high_risk=True,
        profile="high_risk",
        verify="VERIFY: the facility's injury / accident reporting form",
        trigger="A client was injured or involved in an accident.",
        binds=ID + ADM + ALG + MED,
        fields=["incident_datetime", "incident_description", "immediate_actions"],
        recipients=["INTERNAL_TEAM", "STATUTORY_AUTHORITY"],
        alternative_bases=["STATUTORY_DUTY"],
        tags=["injury", "accident"],
    ),
    _t(
        "LEG",
        9,
        "Death-related clinical documentation",
        high_risk=True,
        profile="high_risk",
        verify="VERIFY: statutory death notification forms and required content",
        trigger="A client has died.",
        binds=ID + ADM + LEGAL + DX + MED,
        fields=["incident_datetime", "incident_description"],
        recipients=["STATUTORY_AUTHORITY", "INTERNAL_TEAM"],
        alternative_bases=["STATUTORY_DUTY"],
        tags=["death", "mortality"],
    ),
    # 14 — Patient Communications
    _t(
        "PAT",
        1,
        "Appointment confirmation / instructions",
        profile="administrative",
        trigger="Client needs confirmation of an appointment.",
        binds=ID + CONTACT + APPT,
        fields=["instructions"],
        recipients=["PATIENT"],
        tags=["appointment", "confirmation"],
    ),
    _t(
        "PAT",
        2,
        "Welcome / orientation letter",
        profile="administrative",
        verify="VERIFY: facility orientation content",
        trigger="New client needs orientation information.",
        binds=ID + CONTACT + APPT,
        recipients=["PATIENT"],
        tags=["welcome", "orientation"],
    ),
    _t(
        "PAT",
        3,
        "Patient rights and responsibilities",
        profile="administrative",
        verify="VERIFY: rights text from facility configuration only (OQ-23)",
        trigger="Client must be given their rights and responsibilities.",
        binds=ID,
        recipients=["PATIENT"],
        tags=["rights", "responsibilities"],
    ),
    _t(
        "PAT",
        4,
        "Individual treatment schedule",
        trigger="Client needs their treatment schedule.",
        binds=ID + APPT + PLAN,
        recipients=["PATIENT"],
        tags=["schedule", "timetable"],
    ),
    _t(
        "PAT",
        5,
        "Follow-up reminder",
        profile="administrative",
        trigger="Client has an upcoming follow-up.",
        binds=ID + CONTACT + APPT,
        recipients=["PATIENT"],
        tags=["reminder", "follow-up"],
    ),
    _t(
        "PAT",
        6,
        "Missed-appointment communication",
        profile="administrative",
        trigger="Client missed an appointment.",
        binds=ID + CONTACT + MISSED + APPT,
        fields=["clinician_comment"],
        recipients=["PATIENT"],
        tags=["missed", "dna", "no show"],
    ),
    _t(
        "PAT",
        7,
        "Lost-to-follow-up / re-engagement letter",
        trigger="Client has disengaged and the team wants to re-engage them.",
        binds=ID + CONTACT + MISSED + ATT,
        fields=["clinician_comment"],
        recipients=["PATIENT"],
        tags=["re-engagement", "lost to follow-up"],
    ),
    _t(
        "PAT",
        8,
        "Patient-requested record / summary cover letter",
        profile="administrative",
        trigger="Client asked for a copy of their record or a summary.",
        binds=ID + CONTACT,
        fields=["records_enclosed", "request_date"],
        recipients=["PATIENT"],
        tags=["record request", "subject access", "cover letter"],
    ),
]

# ── Statutory mental-health forms (LGL-DOC-01 / 02 / 05) ──
# The three Kenyan MHA forms are authored, signed, amended and printed by the
# legal-status module (apps.care_pathway.legal_status — the one store for them,
# LegalDocument). The catalogue lists them so they are found under LEG and so
# their *release* runs through this module's workflow: DOC-CI-06 consent /
# authorization check and a DisclosureRecord (LGL-DOC-05). A GeneratedDocument
# for one of them is a release record linked to the signed LegalDocument; it
# carries no copy of the form. Their DOC-SPEC text is the one the legal module
# serves (jurisdiction config `documentTemplates`, GET care/legal/templates/).
LEGAL_MODULE_SOURCE = "LEGAL_MODULE"
_LEGAL_RECIPIENTS = ["LEGAL", "RECEIVING_FACILITY", "STATUTORY_AUTHORITY"]
_LEGAL_RAW = [
    {
        "doc_id": "DOC-LEG-STAT-VOL-KE",
        "name": "Application for Voluntary Admission",
        "binds": ID + ADM + LEGAL,
        "recipients": _LEGAL_RECIPIENTS + ["FAMILY"],
        "tags": ["voluntary admission", "statutory", "mental health act", "legal status"],
    },
    {
        "doc_id": "DOC-LEG-STAT-INV-APP-KE",
        "name": "Involuntary Admission Form",
        "binds": ID + ADM + LEGAL + RISK,
        "recipients": list(_LEGAL_RECIPIENTS),
        "tags": ["involuntary admission", "statutory", "mental health act", "legal status"],
    },
    {
        "doc_id": "DOC-LEG-STAT-INV-REC-KE",
        "name": "Recommendation for Involuntary Treatment",
        "binds": ID + LEGAL + CLIN + RISK,
        "recipients": list(_LEGAL_RECIPIENTS),
        "tags": ["recommendation", "involuntary treatment", "statutory", "mental health act"],
    },
]
LEGAL_TEMPLATE_IDS = [entry["doc_id"] for entry in _LEGAL_RAW]


# ── DOC-SPEC assembly ──

RULE_DESCRIPTIONS = {
    "DOC-GOV-01": "IF the document is not yet signed THEN it is watermarked DRAFT — CLINICIAN "
    "REVIEW REQUIRED and cannot be released.",
    "DOC-REQ": "IF a required clinician-entered field is empty THEN submission for review is "
    "blocked and the missing fields are listed.",
    "DOC-CI-01": "IF the client is currently admitted THEN admission dates and the current "
    "episode populate the document.",
    "DOC-CI-02": "IF diagnosis disclosure is not authorized or not necessary THEN diagnoses are "
    "excluded from the external document.",
    "DOC-CI-03": "IF current risk is recorded THEN the current risk summary is included and "
    "immediate safety requirements become a required field.",
    "DOC-CI-04": "IF the recipient is an employer THEN only necessary functional information is "
    "included; psychotherapy content and unnecessary diagnoses are excluded.",
    "DOC-CI-05": "IF the recipient is a treating clinician THEN diagnoses, medications, allergies, "
    "investigations, recent assessments and risk are offered per clinical need and "
    "authorization.",
    "DOC-CI-06": "IF the consent this release needs is absent THEN external release is blocked and "
    "the user is prompted to obtain / record authorization.",
    "DOC-CI-07": "Medication-monitoring fields adapt to each selected medication and indication; "
    "investigations come from facility configuration or clinician selection.",
    "DOC-CI-08": "IF a referral destination is selected THEN recommended content and fields adapt "
    "to the receiving discipline.",
}


def _classes_of(binds):
    from .bindings import BINDINGS

    return sorted({BINDINGS[key]["class"] for key in binds}, key=CLASS_ORDER.index)


def _conditional_rules(raw, bound):
    rules = ["DOC-GOV-01", "DOC-REQ"]
    if "ADMISSION" in bound or "ADMINISTRATIVE" in bound:
        rules.append("DOC-CI-01")
    externals = [r for r in raw["recipients"] if RECIPIENT_TYPES[r]["external"]]
    if "DIAGNOSIS" in bound and externals:
        rules.append("DOC-CI-02")
    if "risk_relevant" in raw["flags"]:
        rules.append("DOC-CI-03")
    if "EMPLOYER" in raw["recipients"]:
        rules.append("DOC-CI-04")
    if "TREATING_CLINICIAN" in raw["recipients"] or "RECEIVING_FACILITY" in raw["recipients"]:
        rules.append("DOC-CI-05")
    if any(RECIPIENT_TYPES[r]["consent_type"] for r in externals):
        rules.append("DOC-CI-06")
    if "medication_monitoring" in raw["flags"]:
        rules.append("DOC-CI-07")
    if "referral_destination" in raw["flags"]:
        rules.append("DOC-CI-08")
    return [{"id": rule, "rule": RULE_DESCRIPTIONS[rule]} for rule in rules]


def _user_entered(raw, bound):
    keys = []
    externals = [r for r in raw["recipients"] if RECIPIENT_TYPES[r]["external"]]
    if externals:
        keys += ["recipient_name", "recipient_organization", "purpose"]
        if raw["alternative_bases"]:
            keys += ["legal_basis", "legal_basis_reference"]
        if "DIAGNOSIS" in bound:
            keys.append("diagnosis_disclosure")
        offered = set()
        for rt in externals:
            offered |= set(RECIPIENT_TYPES[rt]["authorizable"]) & set(bound)
        if offered - {"DIAGNOSIS"}:
            keys.append("include_classes")
    for key in raw["fields"]:
        if key not in keys:
            keys.append(key)
    if "referral_destination" in raw["flags"]:
        keys.append("specialty_name")
    if "clinician_comment" not in keys:
        keys.append("clinician_comment")
    return [_field(key, raw) for key in keys]


_REQUIRED_FIELDS = {
    "recipient_organization",
    "purpose",
    "period_from",
    "extension_period",
    "examinations",
    "return_date",
    "plan_schedule",
    "accommodations",
    "limitations",
    "assessment_question",
    "clinician_opinion",
    "recommended_load",
    "plan_details",
    "referral_destination",
    "referral_reason",
    "referral_question",
    "immediate_safety_requirements",
    "support_needed",
    "level_of_care_requested",
    "clinical_question",
    "examination_requested",
    "action_required",
    "reconciliation_notes",
    "instructions",
    "changes",
    "review_findings",
    "progress_summary",
    "mdt_discussion",
    "transfer_reason",
    "risks_explained",
    "follow_up_plan",
    "relapse_plan",
    "aftercare_plan",
    "procedure",
    "source_organization",
    "information_requested",
    "meeting_datetime",
    "update_summary",
    "reintegration_plan",
    "risk_formulation",
    "management_plan",
    "requested_service",
    "justification",
    "report_question",
    "concern_details",
    "incident_datetime",
    "incident_description",
    "records_enclosed",
    "monitoring",
    "deferment_period",
    "diagnosis_disclosure",
}
# Fields that are optional for a given template even though usually required.
_OPTIONAL_PER_TEMPLATE = {
    ("WRK", 4): {"return_date"},
    ("INV", 3): {"clinical_question"},
}


def _field(key, raw):
    spec = USER_FIELDS[key]
    required = key in _REQUIRED_FIELDS and key not in _OPTIONAL_PER_TEMPLATE.get(
        (raw["cat"], raw["nn"]), set()
    )
    if key == "referral_question" and "referral_destination" in raw["flags"]:
        required = False
    if key == "immediate_safety_requirements":
        required = False  # becomes required only when DOC-CI-03 fires
    if key == "specialty_name":
        required = False  # required only for OTHER_SPECIALIST (DOC-CI-08)
    out = {"key": key, "label": spec[0], "type": spec[1], "required": required}
    if len(spec) > 2:
        out["valueset"] = spec[2]
    return out


def _disclosure_rules(raw, bound):
    per_recipient = {}
    for rt in raw["recipients"]:
        profile = RECIPIENT_TYPES[rt]
        default = [c for c in bound if c in profile["default"]]
        authorizable = [c for c in bound if c in profile["authorizable"]]
        bases = [b for b in raw["alternative_bases"] if b in profile.get("alternative_bases", [])]
        if rt in ("TREATING_CLINICIAN", "RECEIVING_FACILITY"):
            bases = [b for b in raw["alternative_bases"] if b == "EMERGENCY"]
        per_recipient[rt] = {
            "label": profile["label"],
            "external": profile["external"],
            "consentType": profile["consent_type"],
            "defaultClasses": default,
            "authorizableClasses": authorizable,
            "excludedClasses": [c for c in bound if c not in default and c not in authorizable],
            "alternativeBases": bases,
        }
    return {
        "recipientTypes": raw["recipients"],
        "defaultRecipient": raw["recipients"][0],
        "perRecipient": per_recipient,
        "neverDisclosed": NEVER_DISCLOSED,
        "sensitiveClasses": [c for c in bound if c in SENSITIVE_CLASSES],
        "releaseBlockedWhen": (
            "External recipient and no current, unexpired YES consent of the required type "
            "(matching the recipient when the consent names one), unless an alternative lawful "
            "basis this template permits is recorded with its reference (DOC-CI-06)."
        ),
    }


def _authorization(raw):
    profile = AUTH_PROFILES[raw["profile"]]
    return {
        "profile": raw["profile"],
        **{action: list(groups) for action, groups in profile.items()},
        "mandatoryIndependentReview": raw["high_risk"],
        "prescribingRestricted": raw["profile"] == "prescribing",
    }


def _outputs(raw):
    if all(not RECIPIENT_TYPES[r]["external"] and r != "PATIENT" for r in raw["recipients"]):
        return list(INTERNAL_OUTPUTS)
    return list(DEFAULT_OUTPUTS) + ["FILE_IN_CHART"]


FILING_AUDIT = {
    "storage": "Client chart — documents.GeneratedDocument, linked to the client and their "
    "EpisodeOfCare",
    "versioning": "Every version kept; a signed version is immutable and a correction is a new "
    "version with a reason (supersedes link)",
    "captured": [
        "documentId",
        "version",
        "author",
        "authorCredentials",
        "reviewer",
        "approver",
        "signer",
        "recipient",
        "purpose",
        "releasedBy",
        "releaseDateTime",
        "legalBasis",
        "consentRecord",
        "contentHash",
    ],
    "auditTrail": "documents.DocumentEvent on every transition (who, what, when, from → to, "
    "reason) plus the platform AuditLogEntry",
    "disclosureLog": "documents.DisclosureRecord on every release (FHIR AuditEvent "
    "'disclosure' semantics, citing the Consent relied on)",
    "retention": "Mental health / substance use retention class (apps.retention)",
}


def _build(raw):
    bound = _classes_of(raw["binds"] + ALWAYS_BOUND)
    doc_id = raw.get("doc_id") or f"DOC-{raw['cat']}-{raw['nn']:02d}"
    return {
        "documentId": doc_id,
        "name": raw["name"],
        "category": raw["cat"],
        "categoryName": CATEGORY_NAMES[raw["cat"]],
        "tags": raw["tags"],
        "trigger": raw["trigger"],
        "autoPopulated": [
            {"key": key, "class": cls, "label": label}
            for key, cls, label in _binding_rows(raw["binds"] + ALWAYS_BOUND)
        ],
        "userEntered": _user_entered(raw, bound),
        "conditionalRules": _conditional_rules(raw, bound),
        "disclosureRules": _disclosure_rules(raw, bound),
        "authorization": _authorization(raw),
        "outputs": _outputs(raw),
        "filingAudit": dict(FILING_AUDIT),
        "highRisk": raw["high_risk"],
        "flags": raw["flags"],
        "contentStatus": "VERIFY" if raw["verify"] else "READY",
        "verifyNote": raw["verify"] or "",
        "boundClasses": bound,
        "source": "",
    }


def _build_legal(entry, served):
    """A statutory form's catalogue entry: the release side is built like any
    other template (recipients, disclosure rules, release roles), the form side
    is the legal module's DOC-SPEC, verbatim."""
    raw = _t(
        "LEG",
        0,
        entry["name"],
        trigger=served["trigger"],
        binds=entry["binds"],
        fields=[],
        recipients=entry["recipients"],
        profile="statutory_legal",
        high_risk=True,
        tags=entry["tags"],
        alternative_bases=["COURT_ORDER", "STATUTORY_DUTY"],
    )
    raw["doc_id"] = entry["doc_id"]
    spec = _build(raw)
    if served["category"] != spec["category"]:
        raise ValueError(f"{entry['doc_id']}: legal module serves category {served['category']}")
    # DOC-REQ / DOC-GOV-01 belong to the legal module's own draft → signed flow.
    # A statutory form is released whole or not at all: no per-class choice.
    spec["userEntered"] = [
        f for f in spec["userEntered"] if f["key"] not in ("include_classes", "diagnosis_disclosure")
    ]
    spec["conditionalRules"] = [
        r for r in spec["conditionalRules"] if r["id"] not in ("DOC-GOV-01", "DOC-REQ")
    ] + [{"id": "LGL", "rule": rule} for rule in served["conditionalRules"]]
    spec["authorization"].update(
        {
            # LGL-DOC-02: who signs is enforced by the legal module, never here.
            "signedIn": LEGAL_MODULE_SOURCE,
            "signingRoles": {
                k: v for k, v in served["authorization"].items() if k in ("sign", "decide")
            },
            "statutory": dict(served["authorization"]),
        }
    )
    spec["disclosureRules"]["statutory"] = list(served["disclosureRules"])
    spec["outputs"] = [o for o in spec["outputs"] if o != "FILE_IN_CHART"]
    spec["filingAudit"] = {
        **spec["filingAudit"],
        "storage": "The signed form: care_pathway.LegalDocument on the episode's LegalStatus. "
        "A release: documents.GeneratedDocument linked to that LegalDocument (no copy of "
        "the form) plus a DisclosureRecord.",
        "statutory": list(served["filingAudit"]),
    }
    spec["source"] = LEGAL_MODULE_SOURCE
    spec["legalSpec"] = served
    return spec


def _legal_templates():
    from apps.care_pathway import legal_config

    served = {t["documentId"]: t for t in legal_config.document_templates()}
    missing = [e["doc_id"] for e in _LEGAL_RAW if e["doc_id"] not in served]
    if missing:
        raise ValueError(f"Legal module does not serve: {', '.join(missing)}")
    return [_build_legal(entry, served[entry["doc_id"]]) for entry in _LEGAL_RAW]


def _binding_rows(keys):
    from .bindings import BINDINGS

    seen = []
    for key in keys:
        if key not in seen:
            seen.append(key)
    return [(key, BINDINGS[key]["class"], BINDINGS[key]["label"]) for key in seen]


SPEC_FIELDS = [
    "documentId",
    "category",
    "trigger",
    "autoPopulated",
    "userEntered",
    "conditionalRules",
    "disclosureRules",
    "authorization",
    "outputs",
    "filingAudit",
]

_TEMPLATES = None


def templates():
    """documentId → full DOC-SPEC template (built once per process)."""
    global _TEMPLATES
    if _TEMPLATES is None:
        _TEMPLATES = {}
        built = {}
        for spec in [_build(raw) for raw in _RAW] + _legal_templates():
            if spec["documentId"] in built:
                raise ValueError(f"Duplicate document ID {spec['documentId']}")
            built[spec["documentId"]] = spec
        _TEMPLATES = built
    return _TEMPLATES


def is_legal(spec):
    return spec.get("source") == LEGAL_MODULE_SOURCE


def get(document_id):
    return templates().get(document_id)


def search(query="", category=""):
    """DOC-UX-02: search by name and tag; a document still lives in exactly one
    category (DOC-UX-01) — tags never create a second template."""
    q = (query or "").strip().lower()
    out = []
    for spec in templates().values():
        if category and spec["category"] != category:
            continue
        if (
            q
            and q not in spec["name"].lower()
            and not any(q in t for t in spec["tags"])
            and q not in spec["documentId"].lower()
        ):
            continue
        out.append(spec)
    return out
