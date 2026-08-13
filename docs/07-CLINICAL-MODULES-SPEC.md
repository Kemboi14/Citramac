# 07 — Clinical & Administrative Module Specification

Every module below must be implemented as its own Django app (see repo layout in `02-TECH-STACK-AND-ARCHITECTURE.md`) and its own frontend module folder mirroring the mockup screens. Modules 1–13 are the DHA-mandated baseline (any general facility tenant); §7.14 is the CAfRIC/mental-health specific extension enabled per `04-MULTI-TENANCY.md` §4.4.

## 7.1 Module 1 — Patient Registration, Scheduling & Demographics (Client Registry)
- IPRS/national client registry lookup for identity verification and UPI assignment (prevents duplicate records).
- Full demographics, geographic location, emergency contacts, next of kin.
- Insurance/coverage assessment — verify active SHA status or private insurance before services render.
- Electronic consent capture for data sharing across the national health exchange.
- Appointment scheduling calendar (clinical, diagnostic, follow-up).
- **UI**: replicate the reference table exactly — First Name, Last Name, Middle/Other Names, UHID Number, Gender, Date Of Birth, Age (computed), DOA, Doctor's Name, Allergy Status (badge), Nationality, Marital Status — grouped by category row (e.g. "Inpatient").

## 7.2 Module 2 — Triage and Acuity Assessment
- Vital signs capture: systolic/diastolic BP, heart rate, respiratory rate, temperature, SpO2.
- Automated calculators: BMI and BSA from height/weight.
- Acuity stratification via Emergency Severity Index (ESI); flag unstable/critical patients on clinician dashboards.
- For CCP/mental-health tenants, this module is paired with the Mental Status Exam (§7.14).

## 7.3 Module 3 — Clinical Encounter & Consultation (EHR)
- S.O.A.P. structured documentation (Subjective/Objective/Assessment/Plan).
- Computerized Physician Order Entry (CPOE) — digital orders to lab/radiology/procedures.
- E-Prescribing with real-time drug-allergy alerts, drug-drug interaction checks, pediatric dosage calculators.
- Diagnostic coding — mandatory ICD-11 mapping on every finalized diagnosis (search-and-select UI, no free text allowed as the primary code).
- E-Referral generation — auto-package history, active meds, and results into a FHIR summary for secure transmission.

## 7.4 Module 4 — Laboratory Information Management System (LIMS)
- Specimen accessioning with auto-generated barcodes at collection.
- Analyzer interfacing to auto-transmit results, eliminating manual transcription.
- Quality control/validation queues — senior lab scientist review & approval gate before results publish to clinicians.
- LOINC mapping on all lab procedures/results.

## 7.5 Module 5 — Radiology Information System (RIS) & PACS Integration
- Imaging order management (X-ray, ultrasound, CT, MRI) routed to radiology.
- DICOM/PACS viewer embedded in the clinical interface.
- Structured radiology reporting templates with sign-off/publish to the patient record.

## 7.6 Module 6 — Pharmacy and Inventory Management
- E-prescription fulfillment pulled directly into the dispensing queue.
- FEFO (First-Expired, First-Out) batch tracking.
- Multi-store management: bulk store → sub-store → ward pharmacy → outpatient dispensing.
- National Drug Index mapping for standardized reporting.

## 7.7 Module 7 — Inpatient (IPD) & Ward Management
- ADT (Admission, Discharge, Transfer) with ward/bed allocation.
- Electronic MAR (Medication Administration Record) — digital checklist ensuring correct dose/patient/time.
- Nursing notes, shift reports, vital sign monitoring sheets.
- Discharge planning: auto-compiled summaries, take-home prescriptions, follow-up scheduling.

## 7.8 Module 8 — Theatre, Surgery, and Anesthesia Management
- Surgical scheduling, OR assignment, surgical team allocation.
- Pre-op clearances, anesthesia assessments, surgical safety checklists.
- Intra-op documentation: surgical notes, anesthesia monitoring, device/consumable tracking.
- PACU tracking of recovery indicators and discharge readiness.

## 7.9 Module 9 — Maternal, Child Health (MCH) & Reproductive Health
- ANC/PNC tracking: pregnancy progress, lab screenings, risk factors, postpartum recovery.
- KEPI immunization tracking with automated SMS reminders.
- Growth chart recording (weight-for-age, height-for-age).

## 7.10 Module 10 — Billing, Invoicing, and Financial Management
- Multi-scheme billing engine: cash, mobile money (M-Pesa), card, corporate accounts, private insurance, SHA.
- Consolidated invoicing merging pharmacy, lab, bed occupancy, procedures, doctor fees.
- Cost-center accounting per department.
- **POS validation gate**: clinical staff cannot order a lab test, X-ray, or dispense a drug until billing validates the transaction (upfront cash, active corporate pre-auth, or verified SHA coverage) — implement as a hard backend check in `ClinicalOrder`/`Prescription` creation, not just a UI warning.

## 7.11 Module 11 — Insurance & Corporate Claims Management
- Pre-authorization and eligibility tracking for corporate/insurer approvals.
- Electronic claims processing (e-claims) to third-party insurers and the **SHA Claims Gateway** (see `08-DHA-SHA-INTEGRATION.md`).
- Remittance/reconciliation matching insurer payments against submitted claims.

## 7.12 Module 12 — Mortuary / Pathology Management
- Body intake registration with verified cause-of-death certificates and next-of-kin contacts.
- Cold room occupancy and storage location tracking.
- Release/clearance workflow validating financial clearance, next-of-kin ID, and legal authorization before release.

## 7.13 Module 13 — System Administration, Security, and Auditing
- RBAC by job role (Doctor, Nurse, Cashier, Admin, etc.) — see `09-SECURITY-COMPLIANCE.md`.
- Immutable audit trail of every view/edit/delete on any patient record.
- Automated backup and disaster recovery / failover management.

## 7.14 CAfRIC-specific: Mental Health, Trauma & Rehabilitation Modules

These **replace or supplement** modules 2, 3, 8, 9, 12 for `MENTAL_HEALTH_CCP`-type tenants (module bundle logic in `04-MULTI-TENANCY.md` §4.4).

### 7.14.1 Comprehensive Psychiatric & Biopsychosocial Assessment
- Structured intake form: developmental history, social history, psychological history, family history, presenting problem, risk factors.
- Attaches to `Patient` and feeds the initial treatment plan.

### 7.14.2 Mental Status Exam (MSE) — replaces vitals-only triage
- Appearance, behavior, speech, mood, affect, thought process, thought content, perception, cognition, insight, judgment.
- Suicide/homicide risk-assessment flags that escalate to a supervisor alert when positive.

### 7.14.3 Trauma Processing & Psychotherapy Trackers
- **Individual Psychotherapy**, **Family Therapy**, **Group Psychotherapy** — each a `PsychotherapySession` record type (see `06-DATA-MODEL.md` §6.4) logging modality, session notes, trauma-processing stage, goals, and progress rating over time, so a longitudinal trauma-care timeline can be rendered per patient.

### 7.14.4 Substance Use Disorder (SUD) Rehab Workflows
- Multi-phase rehab plan (Intake → Stabilization → Active Treatment → Aftercare) with milestone tracking.
- Periodic urine drug screening results logged against the plan, with panel results stored as structured JSONB for trend charts.

### 7.14.5 Clinical Review & Supervision
- **Clinical Review**: peer/senior review workflow on complex or high-risk cases before finalizing a treatment plan.
- **Supervision Requests**: junior clinicians request supervisor time on a specific case; tracked to completion — mirrors the mockup's "Supervision Requests" nav item.

### 7.14.6 CCP Team & Reporting
- **CCP Team**: roster/management view of the clinical psychology/counseling team (their caseloads, specialties, supervision relationships).
- **NACADA NDO Report**: periodic aggregated reporting output required for Kenya's National Authority for the Campaign Against Alcohol and Drug Abuse (NACADA) National Drug Observatory — auto-compiled from `SudRehabPlan`/`UrineDrugScreen` data, exportable and (phase 3) API-submittable.

### 7.14.7 Elevated privacy & consent
- Psychiatric/SUD records require a **stricter RBAC tier** than general medical records — even within the same facility, only assigned therapists/supervisors/the patient's care team can view full session notes; general clinical/admin staff see only that an active care episode exists (per Data Protection Act "need to know" principle). Enforce via row-level `CareTeamMembership` checks in addition to standard role checks — see `09-SECURITY-COMPLIANCE.md` §9.3.

## 7.15 Module build priority

Follow the phase ordering in `11-ROADMAP-AND-PHASES.md`; do not build Modules 8/9/12 (theatre, MCH, mortuary) before Modules 1–3, 10, 13 and the CCP core (§7.14.1–7.14.3) are stable, since CAfRIC (the reference tenant) needs the mental-health path first.
