"""
Which tenant tables are isolated per branch, and how each reaches its branch.

Applied at startup (TenancyConfig.ready) as `Model.branch_scope_path`, which
TenantScopedQuerySet uses to narrow every query to the branches a request may
see (apps.tenancy.context.get_branch_scope). A row is visible when any of its
paths lands on a visible branch, or when none of them reaches a branch at all
(records from before branches were stamped).

Branch isolation covers the episode and everything recorded inside it — the
clinical spine (CLAUDE.md §4) — plus appointments, wards, stores and the
finance records hanging off them. A client's own registration (Patient and its
identifiers, contacts, allergies, consents) stays organization-wide so one
person is one record across branches. Patient-level clinical records with no
episode link (safety plans, outcome scores, alerts and the like) are not yet
branch-scoped — an open decision, see the 2026-10-26 CLAUDE.md amendment.

`STAMPED` models take the request's working branch on create when no branch
was given (apps.tenancy.models.TenantScopedModel.save).
"""

BRANCH_SCOPED = {
    # Episode of care and what hangs off it
    "care_pathway.EpisodeOfCare": ("branch",),
    "care_pathway.EpisodeStatusHistory": ("episode__branch",),
    "care_pathway.EpisodeOutcome": ("episode__branch",),
    "care_pathway.TriageEncounter": ("episode__branch",),
    "care_pathway.TriageAssessment": ("triage_encounter__episode__branch",),
    "care_pathway.TriageRecheck": ("triage_encounter__episode__branch",),
    "care_pathway.CareTask": ("triage_encounter__episode__branch",),
    "care_pathway.IntakeAssessment": ("episode__branch",),
    "care_pathway.MedicationHistoryEntry": ("episode__branch",),
    "care_pathway.CarePlan": ("episode__branch",),
    "care_pathway.CarePlanVersion": ("care_plan__episode__branch",),
    "care_pathway.CarePlanActivity": ("care_plan__episode__branch",),
    "care_pathway.CarePlanTask": ("activity__care_plan__episode__branch",),
    "care_pathway.ChargeItem": ("episode__branch",),
    "care_pathway.DischargeSummary": ("episode__branch",),
    "care_pathway.ProgressNote": ("episode__branch",),
    "care_pathway.PsychotherapyNote": ("episode__branch",),
    "care_pathway.LegalStatus": ("episode__branch",),
    "care_pathway.LegalForm": ("admission__episode__branch",),
    "care_pathway.GroupSession": ("appointment__branch",),
    "care_pathway.GroupSessionEntry": ("episode__branch",),
    "documents.GeneratedDocument": ("episode__branch",),
    "dha_interop.ShrConsent": ("branch",),
    # Appointments and encounters
    "client_registry.Appointment": ("branch",),
    "clinical_encounter.Encounter": ("branch",),
    "clinical_encounter.SoapNote": ("encounter__branch",),
    "clinical_encounter.DiagnosisCode": ("encounter__branch",),
    "clinical_encounter.ClinicalOrder": ("encounter__branch",),
    "clinical_encounter.Prescription": ("encounter__branch",),
    "clinical_encounter.ReferralPacket": ("encounter__branch",),
    "triage.VitalSigns": ("encounter__branch",),
    "triage.MentalStatusExam": ("encounter__branch",),
    "lims.LabOrder": ("encounter__branch",),
    "lims.LabSpecimen": ("lab_order__encounter__branch",),
    "lims.LabResult": ("lab_order__encounter__branch",),
    # Inpatient
    "ipd_ward.Ward": ("branch",),
    "ipd_ward.Admission": ("episode__branch", "encounter__branch"),
    "ipd_ward.MedicationAdministration": (
        "admission__episode__branch",
        "admission__encounter__branch",
    ),
    "ipd_ward.NursingNote": ("admission__episode__branch", "admission__encounter__branch"),
    # Finance — billing, claims, SHA
    "billing.CostCenter": ("branch",),
    "billing.Invoice": ("encounter__branch",),
    "billing.InvoiceLine": ("invoice__encounter__branch", "charge_item__episode__branch"),
    "billing.Payment": ("invoice__encounter__branch",),
    "insurance_claims.ShaEligibilityCheck": ("branch",),
    "insurance_claims.ShaVisit": ("branch",),
    "insurance_claims.InsuranceClaim": ("sha_visit__branch", "encounter__branch"),
    "insurance_claims.ClaimLine": ("claim__sha_visit__branch", "claim__encounter__branch"),
    "insurance_claims.PreAuthorization": ("encounter__branch",),
    # Pharmacy stores
    "pharmacy.Store": ("branch",),
}

STAMPED = {
    "care_pathway.EpisodeOfCare",
    "client_registry.Appointment",
    "clinical_encounter.Encounter",
}


def apply_branch_scope():
    from django.apps import apps

    for label, paths in BRANCH_SCOPED.items():
        model = apps.get_model(label)
        model.branch_scope_path = paths
        model.stamps_working_branch = label in STAMPED
