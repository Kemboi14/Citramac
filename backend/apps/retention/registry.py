"""
The client record, as one unit — every model that belongs to a Patient's
chart, with the ORM path from that model back to the Patient.

This one table drives three things, so they can never disagree about what
"the client record" contains:

- the archive write-guard (apps.retention.guards) — nothing under an
  archived client can be created, changed or deleted until it is restored;
- the retention scan's "last clinical activity" (apps.retention.services) —
  the latest `updated_at` across every row listed here;
- the never-hard-delete Django admin lock (apps.retention.apps.ready).

`tests.RegistryCoverageTests` fails if a model with a foreign key path to
Patient is added without being listed here, so a new clinical table can't
silently fall outside archiving.

Path "" means the model *is* the Patient.
"""

PATIENT_PATHS = {
    "client_registry.Patient": "",
    "client_registry.EmergencyContact": "patient",
    "client_registry.AllergyRecord": "patient",
    "client_registry.InsuranceCoverage": "patient",
    "client_registry.Appointment": "patient",
    "client_registry.Attachment": "patient",
    "client_registry.ConsentRecord": "patient",
    "client_registry.ErasureRequest": "patient",
    "clinical_encounter.Encounter": "patient",
    "clinical_encounter.SoapNote": "encounter__patient",
    "clinical_encounter.DiagnosisCode": "encounter__patient",
    "clinical_encounter.ClinicalOrder": "encounter__patient",
    "clinical_encounter.Prescription": "encounter__patient",
    "clinical_encounter.PrescriptionItem": "prescription__encounter__patient",
    "clinical_encounter.ReferralPacket": "encounter__patient",
    "triage.VitalSigns": "encounter__patient",
    "triage.MentalStatusExam": "encounter__patient",
    "lims.LabOrder": "encounter__patient",
    "lims.LabSpecimen": "lab_order__encounter__patient",
    "lims.LabResult": "lab_order__encounter__patient",
    "pharmacy.DispenseRecord": "prescription_item__prescription__encounter__patient",
    "ipd_ward.Admission": "patient",
    "ipd_ward.MedicationAdministration": "admission__patient",
    "ipd_ward.NursingNote": "admission__patient",
    "billing.Invoice": "patient",
    "billing.InvoiceLine": "invoice__patient",
    "billing.Payment": "invoice__patient",
    "insurance_claims.PreAuthorization": "patient",
    "insurance_claims.InsuranceClaim": "patient",
    "insurance_claims.Remittance": "claim__patient",
    "mhp_program.CareTeamMembership": "patient",
    "mhp_program.BiopsychosocialAssessment": "patient",
    "mhp_program.SubstanceUseEntry": "assessment__patient",
    "mhp_program.ReviewOfSystemEntry": "assessment__patient",
    "mhp_program.PsychotherapySession": "patient",
    "mhp_program.SudRehabPlan": "patient",
    "mhp_program.RehabMilestone": "plan__patient",
    "mhp_program.UrineDrugScreen": "plan__patient",
    "mhp_program.ClinicalReview": "patient",
    "mhp_program.SupervisionRequest": "patient",
}

# A client with any row in one of these is held to the mental health /
# substance use retention period; any row in FINANCIAL_MODELS, to the
# financial one. The period applied is the longest that applies.
MENTAL_HEALTH_MODELS = {label for label in PATIENT_PATHS if label.startswith("mhp_program.")} | {
    "triage.MentalStatusExam"
}

FINANCIAL_MODELS = {
    "billing.Invoice",
    "billing.InvoiceLine",
    "billing.Payment",
    "insurance_claims.PreAuthorization",
    "insurance_claims.InsuranceClaim",
    "insurance_claims.Remittance",
}


# Demographic and administrative parts of the record. They count towards
# the archive clock (anything touched keeps the record active) but not
# towards the *clinical* clock the erasure workflow's statutory-minimum
# check uses — DPIA-CAFRIC-MENTAL-HEALTH-MHP.md §1 times that minimum from
# the last clinical contact, not from registration or a phone-number edit.
ADMINISTRATIVE_MODELS = {
    "client_registry.Patient",
    "client_registry.EmergencyContact",
    "client_registry.InsuranceCoverage",
    "client_registry.Appointment",
    "client_registry.ConsentRecord",
    "client_registry.ErasureRequest",
    "mhp_program.CareTeamMembership",
}


def patient_models():
    """(model class, path) for every registered model."""
    from django.apps import apps

    return [(apps.get_model(label), path) for label, path in PATIENT_PATHS.items()]


def path_for(model):
    return PATIENT_PATHS.get(model._meta.label)
