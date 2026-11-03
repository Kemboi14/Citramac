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
administrator out. Code recognises them by their `key` (ROLE_KEY_*), never by
name.

`default_roles` is who held the ability before permissions were enforced
(the former settings role lists); migration accounts 0016 granted each
permission to exactly those roles, so nobody gained or lost access when the
switch was made.
"""

SCOPE_ORG = "ORG"
SCOPE_PLATFORM = "PLATFORM"

MODULES = {
    "clinical": "Clinical care",
    "records": "Client records & identity",
    "legal": "Mental health law & legal forms",
    "laboratory": "Laboratory",
    "finance": "Billing, claims & payments",
    "documents": "Clinical documents",
    "reports": "Statutory reports",
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
        "(letters, reports, certificates) for a credentialed clinician to sign, record "
        "a client's authorisation for a document, and record a psychiatric review's outcome.",
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
        "records.identity.merge",
        "records",
        "Merge a temporary record into an identified client",
        "When an unidentified or unknown client is identified as someone already "
        "registered, merge the temporary record into theirs so the person keeps one "
        "history. Everything recorded under the temporary number moves to the client, "
        "the reason is recorded, and an Org Admin can reverse it. Org Admin can always "
        "merge.",
        SCOPE_ORG,
        ["Front Desk", "Records Officer"] + CLINICAL_STAFF,
    ),
    (
        "clinical.risk_alerts.receive",
        "clinical",
        "Receive risk alerts",
        "Be notified straight away when a Mental Status Exam flags suicidal or "
        "homicidal ideation, so a senior clinician reviews the client.",
        SCOPE_ORG,
        ["Supervisor", "Clinical Supervisor"],
    ),
    (
        "reports.nacada.send",
        "reports",
        "Send the NACADA NDO report",
        "Email a compiled NACADA National Drug Observatory report to the organisation's "
        "NACADA reporting address, or a test copy to your own email. The report holds "
        "counts only, with small numbers withheld. Every send asks for confirmation and "
        "is recorded in the audit log. Org Admin can always send.",
        SCOPE_ORG,
        [],
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
    ("roles", "platform-team roles"),
]
for _area, _words in PLATFORM_AREAS:
    PERMISSIONS += [
        (
            f"platform.{_area}.view",
            "platform",
            f"View {_words}",
            (
                {
                    "roles": "See the platform team's roles in the platform console.",
                    "organizations": "See every organisation in the platform console.",
                }.get(_area, f"See every organisation's {_words} in the platform console.")
            ),
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


# ─── Roles ──────────────────────────────────────────────────────────────────
#
# Two separate catalogues, never mixed:
#
# - PLATFORM_ROLES: Softlink Options' own team. Held only by platform accounts
#   (no organisation), carry only platform permissions, and are managed on the
#   Super Admin console's Platform Roles & Team screen.
# - ORGANISATION_ROLES: the standard roles every organisation starts with.
#   Each organisation gets its OWN copy of each one (apps.accounts.roles), which
#   its Org Admin may rename and whose permissions it may change. The rows with
#   organization=None are only the starting definitions; nobody is given them.
#   An organisation may add its own custom roles as well.
#
# `key` is how code recognises a built-in role — never its name, which an
# organisation may change. `locked` roles keep their name and their access is
# fixed in code (the administrator tiers). `legacy` roles are kept for the staff
# who already hold them but are not given to new organisations: each duplicates
# another standard role.

ROLE_KEY_SUPER_ADMIN = "super_admin"
ROLE_KEY_ORG_ADMIN = "org_admin"
ROLE_KEY_AUDITOR = "auditor"

# (key, name, description, locked, legacy)
PLATFORM_ROLES = [
    (
        ROLE_KEY_SUPER_ADMIN,
        "Super Admin",
        "Runs the platform: organisations, subscriptions, platform settings and the "
        "platform team. Comes with a Super Admin account, not given as a role.",
        True,
        False,
    ),
    (
        "support_agent",
        "Support Agent",
        "Helps organisations with support tickets: views organisations and branches, "
        "but cannot change billing or roles.",
        False,
        False,
    ),
    (
        "billing_admin",
        "Billing Admin",
        "Manages subscriptions and plans. Can view organisations and branches but not "
        "change them.",
        False,
        False,
    ),
    (
        "mfl_verifier",
        "MFL Verifier",
        "Checks pending organisations against the DHA Master Facility List and approves "
        "them. Has no access to billing or roles.",
        False,
        False,
    ),
    (
        "platform_auditor",
        "Platform Auditor",
        "Reads the audit trail across every organisation. Changes nothing.",
        False,
        False,
    ),
]

ORGANISATION_ROLES = [
    (
        ROLE_KEY_ORG_ADMIN,
        "Org Admin",
        "Administers the organisation: staff and their roles, branches, settings, "
        "tariffs, retention and the audit trail. Always covers every branch.",
        True,
        False,
    ),
    (
        ROLE_KEY_AUDITOR,
        "Auditor",
        "Independent oversight: reads the audit trail and signs off compliance "
        "requests. Changes no clinical record.",
        True,
        False,
    ),
    (
        "psychiatrist",
        "Psychiatrist",
        "Consultant psychiatrist: assesses and diagnoses, prescribes, co-signs as the "
        "senior clinician and approves high-risk documents.",
        False,
        False,
    ),
    (
        "doctor",
        "Doctor",
        "Medical officer: assesses clients, prescribes and authorises medical documents.",
        False,
        False,
    ),
    (
        "clinical_psychologist",
        "Clinical Psychologist/Therapist",
        "Psychological assessment and psychotherapy: individual, family and group "
        "sessions and their restricted notes.",
        False,
        False,
    ),
    (
        "nurse",
        "Nurse",
        "Nursing care: triage, vital signs, medication administration and nursing "
        "documents.",
        False,
        False,
    ),
    (
        "ward_nurse",
        "Ward Nurse",
        "Inpatient nursing on the wards: observations, medication administration and "
        "nursing documents.",
        False,
        False,
    ),
    (
        "clinical_supervisor",
        "Clinical Supervisor",
        "Clinical supervision: approves credentialed and senior documents and receives "
        "the risk alerts raised in Mental Status Exams.",
        False,
        False,
    ),
    (
        "front_desk",
        "Front Desk",
        "Registration, appointments and check-in, and administrative letters.",
        False,
        False,
    ),
    (
        "records_officer",
        "Records Officer",
        "Health records: merging temporary records, releasing signed documents and "
        "administrative documents.",
        False,
        False,
    ),
    (
        "cashier",
        "Cashier/Billing Clerk",
        "Invoices, payments, SHA and other payer claims, and financial documents.",
        False,
        False,
    ),
    (
        "lab_technician",
        "Lab Technician",
        "Laboratory work, including seeing results before they are validated.",
        False,
        False,
    ),
    (
        "pharmacist",
        "Pharmacist",
        "Pharmacy and dispensing. Has no permissions until an Org Admin gives it some.",
        False,
        False,
    ),
    (
        "radiologist",
        "Radiologist",
        "Imaging. Has no permissions until an Org Admin gives it some.",
        False,
        False,
    ),
    (
        "therapist",
        "Therapist",
        "Same as Clinical Psychologist/Therapist. Kept for staff who already hold it.",
        False,
        True,
    ),
    (
        "supervisor",
        "Supervisor",
        "Receives the risk alerts raised in Mental Status Exams. Kept for staff who "
        "already hold it; new organisations use Clinical Supervisor.",
        False,
        True,
    ),
    (
        "billing_clerk",
        "Billing Clerk",
        "Same as Cashier/Billing Clerk. Kept for staff who already hold it.",
        False,
        True,
    ),
]

LOCKED_ROLE_KEYS = {r[0] for r in PLATFORM_ROLES + ORGANISATION_ROLES if r[3]}
# A custom role can't take these names: they would look like an administrator
# role while granting nothing of the kind.
RESERVED_ROLE_NAMES = {r[1].lower() for r in PLATFORM_ROLES + ORGANISATION_ROLES if r[3]}

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
