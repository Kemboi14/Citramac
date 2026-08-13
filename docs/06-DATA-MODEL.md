# 06 — Core Data Model

This is the backbone schema. Each clinical module (`07-CLINICAL-MODULES-SPEC.md`) extends this with its own tables, but everything hangs off `Organization`, `Branch`, `User`, and `Patient`.

## 6.1 Identity & access

```
Organization (see 04-MULTI-TENANCY.md)
Branch (see 04-MULTI-TENANCY.md)

Role
  - id, name (Doctor, Nurse, Clinical Psychologist, Cashier, Lab Tech, Pharmacist,
    Org Admin, Super Admin, Records Officer, Supervisor)
  - organization (nullable = platform-level template role)
  - permissions (M2M -> Permission)

Permission
  - codename (e.g. "clinical_encounter.view", "billing.approve_writeoff", "audit.view")

User
  - id (UUID), organization (FK), primary_branch (FK, nullable)
  - staff_id, first_name, last_name, email, phone
  - password (Argon2 hash), is_active, email_verified_at
  - roles (M2M -> Role)
  - branch_access (M2M -> Branch)   # for multi-branch staff
  - mfa_enabled (bool, default True for admin/clinical roles)
  - last_login, last_login_ip
```

## 6.2 Patient / Client registry (Module 1)

```
Patient
  - id (UUID), organization (FK), upi (Unique Personal Identifier from IPRS, nullable until verified)
  - uhid_number (facility-local unique ID, matches mockup "UHID Number" column)
  - first_name, last_name, middle_other_names
  - gender, date_of_birth, marital_status, nationality
  - national_id / passport_number
  - contact_phone, contact_email, address, county
  - next_of_kin (FK -> EmergencyContact)
  - allergy_status (enum: NONE, ACTIVE_ALLERGIES, UNKNOWN) + AllergyRecord (M2M/related)
  - registered_at, registered_by (FK -> User)
  - patient_category (OUTPATIENT | INPATIENT) — matches mockup "Inpatient" grouping
  - consent_data_sharing (bool), consent_captured_at, consent_document (FK -> Attachment)

EmergencyContact
  - patient (FK), name, relationship, phone, address

InsuranceCoverage
  - patient (FK), scheme_type (SHA_PRIMARY | SHA_SHIF | SHA_ECCIF | PRIVATE | CORPORATE | CASH)
  - sha_status (verified bool, member_status, premium_compliant, last_checked_at)
  - policy_number, corporate_account (FK, nullable)

Appointment
  - patient (FK), branch (FK), provider (FK -> User), scheduled_for, appointment_type, status
```

## 6.3 Clinical core (Modules 2–3, plus mental-health adaptations)

```
Encounter                          # umbrella object every clinical touchpoint attaches to
  - patient (FK), branch (FK), opened_by (FK -> User), opened_at, closed_at, encounter_type
  - status (OPEN | IN_PROGRESS | CLOSED)

VitalSigns  (Module 2 — Triage)
  - encounter (FK), systolic_bp, diastolic_bp, heart_rate, respiratory_rate, temperature_c, spo2
  - height_cm, weight_kg, bmi (computed), bsa (computed)
  - esi_acuity_level (1-5, Emergency Severity Index)
  - recorded_by, recorded_at

MentalStatusExam (MSE)             # CCP-adapted "triage" for mental health
  - encounter (FK), appearance, behavior, speech, mood, affect, thought_process,
    thought_content, perception, cognition, insight, judgment, risk_assessment (SI/HI flags)

SoapNote (Module 3 — Clinical Encounter)
  - encounter (FK), subjective, objective, assessment, plan
  - author (FK -> User), signed_at, is_locked (immutable once signed)

DiagnosisCode
  - encounter (FK), icd11_code, icd11_description, is_primary

ClinicalOrder (CPOE)
  - encounter (FK), order_type (LAB | RADIOLOGY | PROCEDURE | REFERRAL), ordered_by, ordered_at, status

Prescription / PrescriptionItem
  - encounter (FK), drug (FK -> NationalDrugIndex), dose, route, frequency, duration
  - allergy_check_passed, interaction_check_passed, pediatric_dose_flag

ReferralPacket (E-Referral)
  - encounter (FK), destination_facility, fhir_bundle_json, sent_at, status
```

## 6.4 CCP / mental-health specific (CAfRIC modules — see 07 §7.14)

```
BiopsychosocialAssessment
  - patient (FK), developmental_history, social_history, psychological_history, family_history
  - author (FK -> User), created_at

PsychotherapySession   (Individual / Family / Group — discriminated by session_type)
  - patient (FK) [or Family FK / Group FK], session_type (INDIVIDUAL | FAMILY | GROUP)
  - therapist (FK -> User), session_date, duration_minutes, modality, session_notes
  - trauma_processing_stage (nullable), goals, progress_rating

SudRehabPlan
  - patient (FK), phase (INTAKE | STABILIZATION | ACTIVE_TREATMENT | AFTERCARE)
  - start_date, milestones (JSONB), case_manager (FK -> User)

UrineDrugScreen
  - patient (FK), sud_rehab_plan (FK), test_date, panel_results (JSONB), performed_by

SupervisionRequest
  - requested_by (FK -> User, junior clinician), supervisor (FK -> User)
  - patient (FK, nullable), topic, status (PENDING | SCHEDULED | COMPLETED), notes

NacadaNdoReport
  - branch (FK), reporting_period, aggregated_stats (JSONB), submitted_at, submitted_by
```

## 6.5 Ancillary modules (Modules 4–13 — abbreviated, expand per 07-CLINICAL-MODULES-SPEC.md)

```
LabOrder / LabSpecimen / LabResult (LOINC-coded)     — Module 4
ImagingOrder / ImagingReport (DICOM reference)        — Module 5
DrugStockItem / StockMovement / DispenseRecord        — Module 6
Ward / Bed / Admission / MedicationAdministration      — Module 7
SurgicalCase / AnesthesiaRecord / PacuRecord            — Module 8
AntenatalVisit / PostnatalVisit / ImmunizationRecord    — Module 9
Invoice / InvoiceLine / Payment / CostCenter             — Module 10
InsuranceClaim / PreAuthorization / Remittance           — Module 11
MortuaryIntake / StorageLocation / ReleaseAuthorization   — Module 12
AuditLogEntry / BackupJob                                  — Module 13
```

## 6.6 Interoperability support tables

```
FhirResourceCache      # locally cached FHIR resources fetched/pushed to HIE
IcdCodeIndex            # local mirror of ICD-11 code set for fast search
LoincCodeIndex          # local mirror of LOINC codes
NationalDrugIndex        # local mirror of national drug registry
ShaTransactionLog         # every SHA API call: request payload, response, status, retries
```

## 6.7 Modeling conventions

- Every model: `organization` FK (except platform-level like `SubscriptionPlan`), `created_at`, `updated_at`, and where relevant `created_by` / `updated_by`.
- Soft-delete (`is_deleted`, `deleted_at`) on clinical records — **never hard-delete** patient data (DHA immutable audit requirement); hard deletes are reserved for GDPR/Data-Protection-Act "right to erasure" requests processed through a dedicated, audited workflow.
- Use `UUIDField` primary keys platform-wide (avoids sequential ID leakage across tenants, simplifies future sharding).
- All monetary fields: `DecimalField(max_digits=14, decimal_places=2)`, currency code stored alongside (`KES` default).
