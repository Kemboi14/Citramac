# Scenario 2: SHIF - Inpatient - Fee for Service - Normal/Special Preauth
A patient is admitted for a service that is billed per item (fee for service) and requires a non-elective preauthorization raised within the same visit. The preauth must reach FINALISED status before billing can proceed. The claim is submitted at discharge.
## Intervention Properties
 | Property | Value
 | Fund | SHIF
 | Access Point | Inpatient (IP)
 | Payment Mechanism | Fee for Service
 | Needs Preauth | Yes (needsPreauth: true)
 | Elective Preauth | No (needsManualPreauthApproval: false)
 | Tariff Type | Overall / KEPH Level
How to identify this scenario: After calling GET /api/v1/patients/benefits/interventions, the intervention has paymentMechanism: "FEE_FOR_SERVICE", needsPreauth: true, and needsManualPreauthApproval: false.
The preauth type (normal, surgical, oncology, renal, imaging, optical) is indicated by the requiresSurgicalPreauth, requiresRenalPreauth, requiresOncologyPreauth, requiresRadiologyPreauth, and requiresOpticalPreauth flags. Normal preauth = all flags are false.
## Complete Flow
## Step-by-Step API Calls
### Phase 1: General API Flow
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 1 | Get access token | Auth | POST /api/v1/tenants/token | client_id, client_secret | access_token
 | 2 | Patient search | Registries | GET /api/v1/patients | identification_number, identification_type | id (beneficiary CR ID) - store as patient_id
 | 3 | SHA eligibility check | eClaims | GET /api/v1/patients/eligibility | identification_number, identification_type | Eligibility status of schemes under SHA
 | 4 | Sub-benefit coverage | eClaims | GET /api/v1/patients/sub-benefits | patient_id | sub_benefit_code list
 | 5 | Intervention coverage | eClaims | GET /api/v1/patients/benefits/interventions | patient_id, sub_benefit_code | intervention_code, needsPreauth, needsManualPreauthApproval, preauth type flags
### Phase 2: Patient Consent
OTP path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 6a | Get patient contacts | Consent | GET /api/v1/patients/contacts | patient_id | Masked contact list with id - confirm contact with patient
 | 7a | Send OTP | Consent | POST /api/v1/claims/otp | patient_id, intervention_codes, contact_id (optional) | OTP sent
 | 8a | Create claim with OTP | eClaims | POST /api/v1/claims/visit | otp, intervention_code, service_type: "INPATIENT" | IP claim created
Biometrics path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 6b | Create authorization | Consent | POST /api/v1/claims/authorize | patient_id, biometric fields, service_type: "INPATIENT" | Authorization PENDING; guid; iframe link
 | 7b | (Patient matches fingerprints via iframe) | - | - | - | Authorization transitions to AUTHORIZED
 | 8b | Create claim with auth_guid | eClaims | POST /api/v1/claims/visit | auth_guid, intervention_code, service_type: "INPATIENT" | IP claim created
### Phase 3: Create Claim
See Phase 2 above - the claim is created as part of the consent step.
### Phase 4: Create & Await Preauth
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 10 | Create preauth | eClaims | POST /api/v1/preauths | consent_token, intervention_code, preauth form fields (normal or special), doctor details, diagnosis, attachments, requested amount | Preauth created
 | 11 | Poll preauth status | eClaims | GET /api/v1/preauths | consent_token | status - repeat until FINALISED
### Phase 5: Add Combined Billing Details
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 12 | Add combined billing details | eClaims | POST /api/v1/claims/lines | consent_token, intervention_code, unit_price, quantity, diagnoses (ICD-11 array), attachments | Billing saved; amount validated against tariff
### Phase 6: Preview & Dispatch
OTP discharge path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 13 | Preview provider claim | eClaims | POST /api/v1/claims/preview | consent_token | Claim preview
 | 14 | Send discharge OTP | Consent | POST /api/v1/claims/otp/discharge | consent_token | OTP sent for discharge
 | 15 | Discharge patient | eClaims | POST /api/v1/claims/discharge | otp (discharge OTP) | Claim submitted to SHA
Biometrics discharge path:
 | # | Action | Service | Endpoint | Key Request Fields | Key Output
 | 13 | Preview provider claim | eClaims | POST /api/v1/claims/preview | consent_token | Claim preview
 | 14 | Create discharge authorization | Consent | POST /api/v1/claims/authorize | patient_id, biometric fields | Authorization PENDING + iframe link
 | 15 | (Patient matches fingerprints via iframe) | - | - | - | Authorization transitions to AUTHORIZED
 | 16 | Discharge patient | eClaims | POST /api/v1/claims/discharge | auth_guid (from Step 14) | Claim submitted to SHA
## Field Flow Between Steps
 | Output Field | Step It Comes From | Used In
 | access_token | Step 1 | Authorization header - all requests
 | patient.id | Step 2 | patient_id in Steps 3-8
 | sub_benefit_code | Step 4 | Step 5
 | intervention_code | Step 5 | Steps 8, 9, 10, 12
 | OTP (OTP path) | Patient receives via SMS | otp field in POST /api/v1/claims/visit and discharge
 | guid (Biometrics path) | Step 6b authorize | auth_guid in POST /api/v1/claims/visit and biometrics discharge
 | consent_token | From claim creation (Step 8) | Steps 10-16
## Choosing the Right Preauth Form
 | Preauth Type | When to Use | Intervention Flag
 | Normal Preauth | General services with no special clinical form | All special flags = false
 | Surgical Preauth | Surgical procedures | requiresSurgicalPreauth: true
 | Oncology Preauth | Cancer treatments | requiresOncologyPreauth: true
 | Renal Preauth | Dialysis and renal services | requiresRenalPreauth: true
 | Imaging Preauth | Radiology / imaging | requiresRadiologyPreauth: true
 | Optical Preauth | Eye care services | requiresOpticalPreauth: true
Each special preauth form collects additional clinical data specific to that service category. The POST /api/v1/preauths endpoint accepts all types via a oneOf schema - submit the form that matches the flag.
## Important Notes
### Billing Requires an Approved Preauth
You cannot add bill items to the claim until the preauth status is FINALISED. Any attempt to call POST /api/v1/claims/lines before the preauth is approved will be rejected.
Poll GET /api/v1/preauths?consent_token=... until the status reaches FINALISED before proceeding to billing.
### Doctor Info Required, But No Approval Step for Non-Elective Preauths
When you call POST /api/v1/preauths for a non-elective preauth, doctor information (doctor name, doctor ID, etc.) is required in the payload. However, the doctor does not need to approve the preauth. The system processes it directly without waiting for doctor confirmation.
Doctor approval (which puts the preauth into PENDING_DOCTOR_APPROVAL status) is only required for elective preauths - see Scenarios 3 and 4.
The POST /api/v1/claims/doctor-consent endpoint is used only as a fallback to resend a consent request if a doctor reports they did not receive it.
### Billing Amount Validated Against Tariff
The unit_price submitted in POST /api/v1/claims/lines is validated against the intervention's Overall/KEPH Level tariff. The billed amount must not exceed the tariff. If it does, the entire combined billing request is rolled back.
## See Also
- Normal Preauth - Full normal preauth guide
- Surgical Preauth - Surgical-specific form fields
- Preauth Doctor Consent - When and how to resend doctor consent
- Understanding Preauth Statuses - Full status lifecycle
- Billing Process Overview
- Inpatient Claim Dispatch
Last modified on September 28, 2026
