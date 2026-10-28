"""
The permission catalogue — every permission the system checks, in plain words.

Each organisation permission below is enforced in code through
`apps.accounts.access.has_permission` (the "Checked by" note names where).
Ticking it on a role in Roles & Permissions is what gives a person that
ability; nothing else does. There is no "delete" permission: clinical,
financial and organisational records are deactivated, archived or corrected,
never removed.

Facility administration (staff, roles, branches, settings, retention, tariffs)
and the audit trail belong to the built-in administrator roles — Org Admin and
Auditor — and Super Admin for the platform. Those roles are fixed and are not
expressed as permissions, so an organisation can never lock its own
administrator out.

`default_roles` is who held the ability before permissions were enforced
(the former settings role lists); migration accounts 0019 granted each
permission to exactly those roles, so nobody gained or lost access when the
switch was made.
"""

SCOPE_ORG = "ORG"
SCOPE_PLATFORM = "PLATFORM"

MODULES = {
    "clinical": "Clinical care",
    "legal": "Mental health law & legal forms",
    "laboratory": "Laboratory",
    "finance": "Billing, claims & payments",
    "documents": "Clinical documents",
    "platform": "Platform team (Softlink Options)",
}

CLINICAL_STAFF = [
    "Psychiatrist", "Doctor", "Nurse", "Ward Nurse", "Clinical Psychologist/Therapist",
    "Therapist", "Clinical Supervisor", "Supervisor",
]
PRESCRIBERS = ["Psychiatrist", "Doctor"]

# (codename, module, label, description, scope, default_roles)
PERMISSIONS = [
    (
        "clinical.care.record",
        "clinical",
        "Record clinical care",
        "Start a triage from the client's record, draft clinical and medical documents "
        "(letters, reports, certificates) for a credentialed clinician to sign, and record "
        "a client's authorisation for a document.",
        SCOPE_ORG,
        CLINICAL_STAFF,
    ),
    (
        "clinical.medication.prescribe",
        "clinical",
        "Prescribe medication",
        "Place medication orders, acknowledge abnormal laboratory results, be named as "
        "the authoriser of a restrictive practice, prepare and sign prescriptions, and "
        "start a medication administration record.",
        SCOPE_ORG,
        PRESCRIBERS,
    ),
    (
        "clinical.cosign",
        "clinical",
        "Co-sign as senior clinician",
        "Act as the senior reviewer: co-sign triage priority downgrades, care-plan and "
        "intervention decisions, restrictive-practice authorisations and duty-to-protect "
        "decisions; appear in the 'senior review' picker. Nobody co-signs their own request.",
        SCOPE_ORG,
        ["Psychiatrist"],
    ),
    (
        "clinical.restricted_content.view",
        "clinical",
        "See restricted therapy & trauma content",
        "Read the restricted parts of the record: trauma history in Intake and the "
        "process notes of psychotherapy sessions. Everyone else sees that the section "
        "exists, not what it says.",
        SCOPE_ORG,
        [
            "Psychiatrist", "Doctor", "Nurse", "Ward Nurse",
            "Clinical Psychologist/Therapist", "Therapist",
        ],
    ),
    (
        "clinical.admitting_officer",
        "legal",
        "Admitting officer",
        "Record the official-use admission decision on statutory admission forms "
        "(involuntary and other legal admissions).",
        SCOPE_ORG,
        [],
    ),
    (
        "clinical.identity_numbers.unmask",
        "legal",
        "View ID numbers unmasked",
        "See National ID and passport numbers in full on legal forms. Everyone else "
        "sees them masked; every unmasked view is written to the audit trail.",
        SCOPE_ORG,
        [],
    ),
    (
        "laboratory.results.unvalidated.view",
        "laboratory",
        "See results before validation",
        "View laboratory results that have not yet passed quality-control validation. "
        "Everyone else sees a result only once it is validated and published.",
        SCOPE_ORG,
        ["Lab Technician", "Auditor"],
    ),
    (
        "finance.manage",
        "finance",
        "Manage billing, claims & payments",
        "Create and change invoices, record payments, request pre-authorisation and "
        "create or submit SHA and other payer claims. Everyone else in the facility "
        "sees a client's billing read-only.",
        SCOPE_ORG,
        ["Billing Clerk", "Cashier/Billing Clerk"],
    ),
    (
        "documents.credentialed",
        "documents",
        "Authorise documents needing a credentialed clinician",
        "Review, approve and sign clinical documents (return-to-work and workplace "
        "letters, academic letters, functional reports and the other clinical letters); "
        "draft high-risk reports and statutory legal forms; release clinical, medical, "
        "nursing and administrative documents.",
        SCOPE_ORG,
        [
            "Psychiatrist", "Doctor", "Clinical Psychologist/Therapist", "Therapist",
            "Clinical Supervisor",
        ],
    ),
    (
        "documents.medical",
        "documents",
        "Authorise medical documents",
        "Review, approve and sign medical documents: medical certificates and sick-off "
        "notes, medical leave recommendations and extensions, fitness-for-duty, "
        "medication reconciliation and change summaries, discharge summaries.",
        SCOPE_ORG,
        PRESCRIBERS,
    ),
    (
        "documents.senior",
        "documents",
        "Approve documents as senior clinician",
        "Review, approve, sign and release high-risk documents (emergency referral and "
        "transfer, critical-result notification, against-advice discharge, risk, court, "
        "safeguarding and capacity reports) and approve statutory legal forms for release.",
        SCOPE_ORG,
        ["Psychiatrist", "Clinical Supervisor"],
    ),
    (
        "documents.nursing",
        "documents",
        "Authorise nursing documents",
        "Prepare, review and sign the medication administration record document.",
        SCOPE_ORG,
        ["Nurse", "Ward Nurse"],
    ),
    (
        "documents.release",
        "documents",
        "Release documents outside the facility",
        "Release a signed document to the client or a third party after its consent and "
        "approval checks pass, and record a client's authorisation for a document.",
        SCOPE_ORG,
        ["Records Officer"],
    ),
    (
        "documents.administrative",
        "documents",
        "Prepare administrative documents",
        "Prepare, sign and release administrative communications (appointment and "
        "attendance confirmations, admission confirmation, welcome letter, follow-up "
        "reminders), draft invoices / statements, and record a client's authorisation for "
        "a document.",
        SCOPE_ORG,
        ["Front Desk", "Records Officer"],
    ),
    (
        "documents.financial",
        "documents",
        "Authorise financial documents",
        "Prepare, approve, sign and release the invoice / pro-forma / statement of "
        "services document.",
        SCOPE_ORG,
        ["Billing Clerk", "Cashier/Billing Clerk"],
    ),
]

# The platform team's own console. Only Super Admin can open it today, so these
# record what each platform-team role is for; they grant nothing on their own.
PLATFORM_AREAS = [
    ("organizations", "organisations"),
    ("branches", "branches"),
    ("subscriptions", "subscriptions"),
    ("roles", "role templates"),
]
for _area, _words in PLATFORM_AREAS:
    PERMISSIONS += [
        (
            f"platform.{_area}.view",
            "platform",
            f"View {_words}",
            f"See every organisation's {_words} in the platform console.",
            SCOPE_PLATFORM,
            [],
        ),
        (
            f"platform.{_area}.create",
            "platform",
            f"Create {_words}",
            f"Add new {_words} from the platform console.",
            SCOPE_PLATFORM,
            [],
        ),
        (
            f"platform.{_area}.edit",
            "platform",
            f"Edit {_words}",
            f"Change the details of existing {_words}.",
            SCOPE_PLATFORM,
            [],
        ),
        (
            f"platform.{_area}.deactivate",
            "platform",
            f"Deactivate or archive {_words}",
            f"Deactivate (and reactivate) {_words}. Nothing is ever deleted — deactivated "
            "items and their history stay in the record.",
            SCOPE_PLATFORM,
            [],
        ),
    ]
PERMISSIONS.append(
    (
        "platform.audit.view",
        "platform",
        "View the cross-organisation audit trail",
        "Read the audit trail across every organisation from the platform console.",
        SCOPE_PLATFORM,
        [],
    )
)

CODENAMES = {p[0] for p in PERMISSIONS}

# Document-catalogue authorisation groups → the permission that grants each.
DOCUMENT_GROUP_PERMISSIONS = {
    "CLINICAL_STAFF": "clinical.care.record",
    "PRESCRIBERS": "clinical.medication.prescribe",
    "CREDENTIALED": "documents.credentialed",
    "MEDICAL": "documents.medical",
    "SENIOR": "documents.senior",
    "NURSING": "documents.nursing",
    "RELEASE_OFFICERS": "documents.release",
    "ADMIN_STAFF": "documents.administrative",
    "BILLING": "documents.financial",
}
